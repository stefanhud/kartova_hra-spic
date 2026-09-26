// Multi-player simulation test: real Socket.IO server + bot clients with fast timers.
//
//   npm test            (from server/)
//
// Checks, after every state change on the server:
//   - money is conserved (chips + pot only change on join / rebuy / leave)
//   - no card is dealt twice, chips are never negative
//   - a live round always has a pending timer, so it can never stall
// and from every client's point of view that hidden cards stay hidden.
import http from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as connect, Socket as ClientSocket } from 'socket.io-client';
import { GameManager, Timings } from '../src/game/GameManager';
import type { ClientView, GameState } from '../src/game/GameState';

const FAST: Timings = {
  turn: 120, offlineTurn: 40, blindCall: 15, noSwap: 15, survivorDelay: 15, showdown: 30, reconnectGrace: 300,
};

let failures = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
    if (failures > 20) {
      console.error('Too many failures, aborting.');
      process.exit(1);
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (n: number) => Math.floor(Math.random() * n);
let tokenSeq = 0;
const newToken = () => `testtoken_${process.pid}_${++tokenSeq}_${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// Server with invariant checks
// ---------------------------------------------------------------------------

interface Harness {
  url: string;
  gm: GameManager;
  state: () => GameState;
  close: () => Promise<void>;
  rounds: () => number;
}

// How often each rule/event came up across all tables (printed at the end).
const coverage: Record<string, number> = {};
const COVERAGE_PATTERNS: [string, RegExp][] = [
  ['raise', /raised to/], ['fold', /folded|— fold/], ['all-in', /all-in/], ['timeout', /ran out of time/],
  ['banker look', /looked at their cards/], ['blind banker call', /blind banker/], ['bicykel fold', /Bicykel/],
  ["banker's option", /Banker's option/], ['banker takes talon', /takes the talon/], ['swap', /swapped/],
  ['pass', /passes\./], ['auto-pass', /can't improve/], ['win', /wins €/], ['tie / pot stays', /pot stays|Pot stays/],
  ['escalation miss', /needed more than/], ['survivor proves hand', /prove a hand/], ['disconnect', /lost connection/],
  ['reconnect', /is back/], ['removed offline', /was removed/], ['rebuy', /rebought/], ['late join', /next hand/],
];

async function startServer(timings: Timings = FAST): Promise<Harness> {
  const httpServer = http.createServer();
  const io = new Server(httpServer, { pingInterval: 2000, pingTimeout: 2000 });
  const gm = new GameManager(io, timings);
  io.on('connection', s => gm.handleConnection(s));
  await new Promise<void>(r => httpServer.listen(0, r));
  const port = (httpServer.address() as AddressInfo).port;

  const anyGm = gm as any;
  const state = (): GameState => anyGm.state;
  const money = () => state().players.reduce((a, p) => a + p.chips, 0) + state().pot;
  let moneyChanging = false;
  let showdowns = 0;
  let lastPhase = 'WAITING';
  let lastLogId = 0;

  // Methods that legitimately add or remove money from the table.
  for (const m of ['handleJoin', 'handleRebuy', 'removePlayer', 'resetTable']) {
    const orig = anyGm[m].bind(gm);
    anyGm[m] = (...args: unknown[]) => {
      moneyChanging = true;
      return orig(...args);
    };
  }

  const origRun = anyGm.run.bind(gm);
  anyGm.run = (fn: () => void) => {
    const before = money();
    moneyChanging = false;
    origRun(fn);
    const s = state();
    if (!moneyChanging) check(money() === before, `money changed ${before} -> ${money()} in phase ${s.phase}`);

    for (const p of s.players) {
      check(Number.isInteger(p.chips) && p.chips >= 0, `bad chips for ${p.name}: ${p.chips}`);
      check(p.seatIndex >= 0 && p.seatIndex < 6, `bad seat ${p.seatIndex}`);
    }
    check(new Set(s.players.map(p => p.seatIndex)).size === s.players.length, 'two players share a seat');

    const cards = [...s.players.flatMap(p => p.hand), ...s.talon].map(c => c.suit + c.rank);
    check(new Set(cards).size === cards.length, `duplicate card dealt: ${cards.join(',')}`);

    const live = s.phase !== 'WAITING';
    if (live) check(anyGm.flowTimer !== null, `round can stall: no pending timer in ${s.phase}`);
    if (s.turnIndex >= 0 && s.phase !== 'WAITING' && s.phase !== 'SHOWDOWN') {
      const p = s.players.find(x => x.seatIndex === s.turnIndex);
      check(p && !p.isFolded, `turn given to empty/folded seat ${s.turnIndex} in ${s.phase}`);
    }
    for (const entry of s.log) {
      if (entry.id <= lastLogId) continue;
      lastLogId = entry.id;
      for (const [k, re] of COVERAGE_PATTERNS) if (re.test(entry.text)) coverage[k] = (coverage[k] ?? 0) + 1;
    }
    if (s.phase === 'SHOWDOWN' && lastPhase !== 'SHOWDOWN') showdowns++;
    lastPhase = s.phase;
  };

  return {
    url: `http://localhost:${port}`,
    gm,
    state,
    rounds: () => showdowns,
    close: () => new Promise<void>(r => {
      io.close();
      httpServer.close(() => r());
    }),
  };
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

class Bot {
  socket!: ClientSocket;
  view: ClientView | null = null;
  token = newToken();
  errors: string[] = [];
  private pending: ReturnType<typeof setTimeout> | null = null;
  private lastNonce = -1;

  constructor(public url: string, public name: string, public auto = true) {}

  connect(): Promise<void> {
    this.socket = connect(this.url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token: this.token } });
    this.socket.on('gameState', (v: ClientView) => this.onState(v));
    this.socket.on('actionError', (m: string) => this.errors.push(m));
    return new Promise(r => this.socket.once('connect', () => r()));
  }

  disconnect() {
    if (this.pending) clearTimeout(this.pending);
    this.socket.disconnect();
  }

  me() {
    return this.view?.players.find(p => p.id === this.view!.you);
  }

  emit(ev: string, ...args: unknown[]) {
    this.socket.emit(ev, ...args);
  }

  private onState(v: ClientView) {
    this.view = v;
    this.checkPrivacy(v);
    if (!this.auto) return;
    const me = this.me();
    // The blind banker sometimes peeks at their cards while others are betting.
    if (me && (v.phase === 'BETTING_1' || v.phase === 'BETTING_2') && me.seatIndex === v.dealerIndex
      && !me.hasLooked && Math.random() < 0.08) this.emit('bankerLook');
    if (!me || v.turnIndex !== me.seatIndex || v.turnNonce === this.lastNonce) return;
    if (v.turnDeadline === 0) return; // no decision (blind call / auto-pass in progress)
    this.lastNonce = v.turnNonce;
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => this.act(v), rand(25));
  }

  private checkPrivacy(v: ClientView) {
    const showdown = v.phase === 'SHOWDOWN';
    for (const p of v.players) {
      const hidden = p.hand.every(c => c.suit === ('X' as string));
      if (p.id === v.you) {
        const blind = p.seatIndex === v.dealerIndex && !p.hasLooked && !p.isFolded
          && ['BETTING_1', 'BETTING_2', 'DEALER_SPECIAL'].includes(v.phase);
        if (blind && p.hand.length) check(hidden && !p.score, `${this.name}: blind banker can see own cards`);
      } else if (p.hand.length && !p.isFaceUp && !(showdown && !p.isFolded)) {
        check(hidden && !p.score, `${this.name} can see ${p.name}'s hidden cards`);
      }
    }
  }

  private act(v: ClientView) {
    const me = this.me();
    if (!me) return;
    const r = Math.random();
    if (v.phase === 'BETTING_1' || v.phase === 'BETTING_2') {
      if (r < 0.08) return; // let the clock run out
      if (me.seatIndex === v.dealerIndex && !me.hasLooked && r < 0.2) this.emit('bankerLook');
      if (r < 0.3) this.emit('playerAction', 'FOLD');
      else if (r < 0.75) this.emit('playerAction', 'CALL');
      else this.emit('playerAction', 'RAISE', 1 + rand(3));
    } else if (v.phase === 'TALON_SWAP') {
      if (r < 0.08) return;
      if (v.swapOptions.length && r < 0.7) {
        const o = v.swapOptions[rand(v.swapOptions.length)];
        this.emit('swapCard', o.h, o.t);
      } else if (r < 0.8) {
        this.emit('swapCard', rand(3), rand(4)); // may be rejected, that's fine
        setTimeout(() => this.emit('passTurn'), 5);
      } else this.emit('passTurn');
    } else if (v.phase === 'DEALER_SPECIAL') {
      if (r < 0.1) return;
      this.emit('dealerSpecial', r < 0.6 ? 'TAKE' : 'PASS');
    }
  }
}

async function waitFor(pred: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(5);
  }
  check(false, `timed out waiting for: ${what}`);
  return false;
}

async function seatBots(h: Harness, n: number, auto = true) {
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const b = new Bot(h.url, `Bot${i}`, auto);
    await b.connect();
    b.emit('joinGame', b.name, i, 20 + rand(80));
    bots.push(b);
  }
  await waitFor(() => h.state().players.length === n, 1000, `${n} players seated`);
  return bots;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioFirstPlayerFolds() {
  console.log('• 4 players, the first to act folds (used to loop forever)');
  const h = await startServer({ ...FAST, turn: 5000 });
  const bots = await seatBots(h, 4, false);
  bots[0].emit('startGame');
  await waitFor(() => h.state().phase === 'BETTING_1', 500, 'deal');

  let folded = false;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && h.state().phase === 'BETTING_1') {
    const s = h.state();
    const bot = bots.find(b => b.me()?.seatIndex === s.turnIndex);
    if (bot && s.turnDeadline > 0 && bot.view?.turnNonce === s.turnNonce) {
      const nonce = s.turnNonce;
      if (!folded && s.turnIndex !== s.dealerIndex) {
        folded = true;
        bot.emit('playerAction', 'FOLD');
      } else bot.emit('playerAction', 'CALL');
      await waitFor(() => h.state().turnNonce !== nonce || h.state().phase !== 'BETTING_1', 500, 'turn to advance');
    }
    await sleep(5);
  }
  check(folded, 'someone folded');
  check(h.state().phase !== 'BETTING_1', `betting round 1 finished (phase is ${h.state().phase})`);
  bots.forEach(b => b.disconnect());
  await h.close();
}

async function scenarioReconnectKeepsSeat() {
  console.log('• a player reconnecting keeps seat, chips and cards');
  const h = await startServer({ ...FAST, turn: 5000, reconnectGrace: 5000 });
  const bots = await seatBots(h, 3, false);
  bots[0].emit('startGame');
  await waitFor(() => h.state().phase === 'BETTING_1', 500, 'deal');

  const victim = bots.find(b => b.me()!.seatIndex !== h.state().dealerIndex)!;
  const before = h.state().players.find(p => p.name === victim.name)!;
  const snapshot = { id: before.id, seat: before.seatIndex, chips: before.chips, hand: JSON.stringify(before.hand) };
  victim.disconnect();
  await waitFor(() => h.state().players.find(p => p.id === snapshot.id)?.connected === false, 500, 'disconnect noticed');
  await victim.connect();
  await waitFor(() => victim.me()?.connected === true, 500, 'reconnected');

  const after = h.state().players.find(p => p.id === snapshot.id);
  check(after, 'player still seated after reconnect');
  check(after?.seatIndex === snapshot.seat && after?.chips === snapshot.chips, 'same seat and chips');
  check(JSON.stringify(after?.hand) === snapshot.hand, 'same cards');
  check(!after?.isFolded, 'not folded by a short disconnect');
  bots.forEach(b => b.disconnect());
  await h.close();
}

async function scenarioOfflinePlayerIsRemoved() {
  console.log('• a player who never comes back is folded and removed, the round goes on');
  const h = await startServer({ ...FAST, turn: 60, offlineTurn: 20, reconnectGrace: 150 });
  const bots = await seatBots(h, 4, true);
  bots[0].emit('startGame');
  await waitFor(() => h.state().phase === 'BETTING_1', 500, 'deal');
  bots[2].disconnect();
  await waitFor(() => h.state().players.length === 3, 1500, 'offline player removed');
  await waitFor(() => h.rounds() >= 1, 4000, 'round finished without them');
  bots.forEach(b => b.disconnect());
  await h.close();
}

async function scenarioRejectsBadInput() {
  console.log('• malformed or out-of-turn messages are ignored');
  const h = await startServer({ ...FAST, turn: 5000, blindCall: 300 });
  const spy = new Bot(h.url, 'Spy', false);
  await spy.connect();
  spy.emit('joinGame', 'Bad', 9, 50);
  spy.emit('joinGame', 'Bad', -1, 50);
  spy.emit('joinGame', 'Bad', 1.5, 50);
  spy.emit('joinGame', '', 2, 50);
  spy.emit('startGame'); // spectators can't deal
  await sleep(50);
  check(h.state().players.length === 0, 'invalid seats / empty names rejected');

  spy.emit('joinGame', 'x'.repeat(200), 2, 'lots');
  await waitFor(() => h.state().players.length === 1, 300, 'valid join');
  const p = h.state().players[0];
  check(p.name.length <= 16 && p.chips === 50, `name clamped and NaN buy-in defaulted (${p.name.length}, ${p.chips})`);

  const bots = await seatBots(h, 2, false);
  bots[0].emit('startGame');
  await waitFor(() => h.state().phase === 'BETTING_1', 500, 'deal');
  const s = h.state();
  const onTurn = [spy, ...bots].find(b => b.me()?.seatIndex === s.turnIndex)!;
  const potBefore = s.pot;
  onTurn.emit('passTurn');                 // not a betting action
  onTurn.emit('swapCard', 0, 0);           // no talon yet
  onTurn.emit('playerAction', 'RAISE', 50); // raise step is 1–3
  onTurn.emit('playerAction', 'RAISE', -2);
  await sleep(50);
  check(h.state().turnNonce === s.turnNonce && h.state().pot === potBefore, 'out-of-phase / invalid actions ignored');

  // The blind banker can't double-act during their automatic call.
  const banker = [spy, ...bots].find(b => b.me()?.seatIndex === s.dealerIndex)!;
  for (let i = 0; i < 6 && h.state().phase === 'BETTING_1'; i++) {
    const st = h.state();
    if (st.turnIndex === st.dealerIndex) {
      const pot = st.pot;
      banker.emit('playerAction', 'CALL');
      banker.emit('playerAction', 'RAISE', 3);
      await sleep(30);
      check(h.state().pot === pot, 'blind banker cannot act manually');
      break;
    }
    const b = [spy, ...bots].find(x => x.me()?.seatIndex === st.turnIndex);
    b?.emit('playerAction', 'CALL');
    await sleep(30);
  }
  [spy, ...bots].forEach(b => b.disconnect());
  await h.close();
}

async function scenarioChaos(players: number, targetRounds: number) {
  console.log(`• chaos: ${players} bots, ${targetRounds} hands with random leaves, disconnects and rebuys`);
  const h = await startServer();
  let bots = await seatBots(h, players, true);
  let spare = 0;
  const end = Date.now() + 40000;

  while (h.rounds() < targetRounds && Date.now() < end) {
    const s = h.state();
    if (s.phase === 'WAITING') {
      // Busted bots rebuy, and somebody deals.
      for (const b of bots) if (b.me()?.chips === 0) b.emit('rebuy', 30);
      bots[rand(bots.length)]?.emit('startGame');
    }

    const r = Math.random();
    if (r < 0.01 && bots.length > 2) {
      // Someone leaves for good.
      const b = bots.splice(rand(bots.length), 1)[0];
      if (Math.random() < 0.5) b.emit('leaveGame');
      setTimeout(() => b.disconnect(), 10);
    } else if (r < 0.02 && bots.length > 0) {
      // Connection blip: drop and come back with the same token.
      const b = bots[rand(bots.length)];
      b.disconnect();
      setTimeout(() => b.connect(), rand(120));
    } else if (r < 0.03 && bots.length < 6) {
      // Someone new sits down, possibly mid-round.
      const free = [0, 1, 2, 3, 4, 5].filter(i => !h.state().players.some(p => p.seatIndex === i));
      if (free.length) {
        const b = new Bot(h.url, `New${spare++}`);
        await b.connect();
        b.emit('joinGame', b.name, free[rand(free.length)], 5 + rand(96));
        bots.push(b);
      }
    }
    await sleep(10);
  }

  check(h.rounds() >= targetRounds, `played ${h.rounds()}/${targetRounds} hands in time`);
  bots.forEach(b => b.disconnect());
  bots = [];
  await h.close();
}

(async () => {
  const started = Date.now();
  await scenarioFirstPlayerFolds();
  await scenarioReconnectKeepsSeat();
  await scenarioOfflinePlayerIsRemoved();
  await scenarioRejectsBadInput();
  await scenarioChaos(2, 40);
  await scenarioChaos(4, 60);
  await scenarioChaos(6, 80);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\nCoverage:', COVERAGE_PATTERNS.map(([k]) => `${k} ${coverage[k] ?? 0}`).join(' · '));
  const missing = COVERAGE_PATTERNS.map(([k]) => k).filter(k => !coverage[k]);
  if (missing.length) console.log(`(not hit this run: ${missing.join(', ')})`);
  if (failures) {
    console.error(`\n${failures} check(s) failed (${secs}s).`);
    process.exit(1);
  }
  console.log(`\nAll simulation checks passed (${secs}s).`);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
