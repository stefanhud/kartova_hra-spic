// Shared test harness: a real Socket.IO game server with invariant checks, plus bot clients.
//
// After every state change on the server it checks that:
//   - money is conserved (chips + pot only change on join / rebuy / leave)
//   - no card is dealt twice, chips and debts are never negative
//   - a live round always has a pending timer, so it can never stall
//   - only the first/last player raises, at most one raise + one re-raise per round
//   - a won pot clears every debt
// and, from every client's point of view, that hidden cards stay hidden.
import http from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as connect, Socket as ClientSocket } from 'socket.io-client';
import { GameManager, Timings } from '../src/game/GameManager';
import type { ClientView, GameState } from '../src/game/GameState';
import type { Card } from '../src/game/types';

export const FAST: Timings = {
  turn: 120, offlineTurn: 40, blindCall: 15, noSwap: 15, survivorDelay: 15, showdown: 30, reconnectGrace: 300,
};

let failures = 0;
export function check(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
    if (failures > 20) {
      console.error('Too many failures, aborting.');
      process.exit(1);
    }
  }
}
export const failureCount = () => failures;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const rand = (n: number) => Math.floor(Math.random() * n);
let tokenSeq = 0;
const newToken = () => `testtoken_${process.pid}_${++tokenSeq}_${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// Server with invariant checks
// ---------------------------------------------------------------------------

export interface Harness {
  url: string;
  gm: GameManager;
  state: () => GameState;
  close: () => Promise<void>;
  rounds: () => number;
}

// How often each rule/event came up across all tables (printed at the end).
export const coverage: Record<string, number> = {};
type Entry = { key: string; p?: Record<string, any> };
const is = (...keys: string[]) => (e: Entry) => keys.includes(e.key);
export const COVERAGE_PATTERNS: [string, (e: Entry) => boolean][] = [
  ['raise', is('raised')], ['re-raise', is('reraised')], ['fold', is('folded', 'foldTimeout')],
  ['timeout', e => !!e.p?.timedOut || /Timeout$/.test(e.key)], ['banker look', is('looked')],
  ['banker call', e => is('checks', 'calls')(e) && !!e.p?.banker],
  ['bicykel fold', is('bicykel', 'bankerBicykel', 'swapBicykel')], ["banker's option", is('bankerOption')],
  ['banker takes talon', is('takesTalon')], ['swap', is('swapped')], ['pass', is('passes')],
  ['auto-pass', is('cantImprove')], ['win', is('wins', 'winsFold')], ['pot stays', is('potStays')],
  ['escalation miss', is('neededMore')], ['survivor proves hand', is('proveHand')], ['debt charged', is('owing')],
  ['debt paid', e => is('checks', 'calls', 'raised', 'reraised')(e) && (e.p?.debt ?? 0) > 0],
  ['dealer pays', is('paysAndDeals')], ['dealer skips', is('skipsDeal', 'skipsDealTimeout')],
  ['disconnect', is('lostConn')], ['reconnect', is('back')], ['removed offline', is('removed')],
  ['top-up', is('topUp')], ['late join', e => e.key === 'satDown' && !!e.p?.late],
];

export async function startServer(timings: Timings = FAST): Promise<Harness> {
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
  for (const m of ['handleJoin', 'handleRebuy', 'removePlayer', 'resetTable', 'topUp']) {
    const orig = anyGm[m].bind(gm);
    anyGm[m] = (...args: unknown[]) => {
      moneyChanging = true;
      return orig(...args);
    };
  }

  const origRun = anyGm.run.bind(gm);
  anyGm.run = (fn: () => void) => {
    const before = money();
    const b = state();
    const betBefore = { phase: b.phase, roundId: b.roundId, currentBet: b.currentBet };
    moneyChanging = false;
    origRun(fn);
    const s = state();
    if (!moneyChanging) check(money() === before, `money changed ${before} -> ${money()} in phase ${s.phase}`);

    for (const p of s.players) {
      check(Number.isInteger(p.chips) && p.chips >= 0, `bad chips for ${p.name}: ${p.chips}`);
      check(Number.isInteger(p.debt) && p.debt >= 0, `bad debt for ${p.name}: ${p.debt}`);
      check(p.handBets >= 0, `bad handBets for ${p.name}: ${p.handBets}`);
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

    // Raise rules
    check(s.raisesThisRound <= 2, `more than one raise + re-raise (${s.raisesThisRound})`);
    if (s.phase === betBefore.phase && s.roundId === betBefore.roundId && s.currentBet > betBefore.currentBet) {
      const raiser = s.players.find(p => p.id === s.lastRaiserId);
      check(raiser && s.raiserSeats.includes(raiser.seatIndex), `raise by a player who may not raise (${raiser?.name})`);
      check(raiser && raiser.seatIndex !== s.dealerIndex, 'the banker raised');
    }
    // Zero-sum: every euro someone is up, someone else is down (or it's in the pot).
    const balances = s.players.reduce((a, p) => a + p.chips - p.bought, 0) + s.departed.reduce((a, d) => a + d.balance, 0);
    check(balances + s.pot === 0, `balances don't add up: players/departed ${balances} + pot ${s.pot}`);
    check(s.players.every(p => p.chips >= 0 && p.bought >= p.chips - 1e9), 'bad wallet');

    // A won pot wipes every debt.
    if (s.phase === 'SHOWDOWN' && s.gameWinner) {
      check(s.players.every(p => p.debt === 0 && !p.benched) && s.carryTotal === 0, 'debts left after the pot was won');
    }

    for (const entry of s.log) {
      if (entry.id <= lastLogId) continue;
      lastLogId = entry.id;
      for (const [k, re] of COVERAGE_PATTERNS) if (re(entry)) coverage[k] = (coverage[k] ?? 0) + 1;
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

// Make the next deal(s) come out in a fixed order: `codes` like 'HA', 'S10', 'D7' in draw order.
export function stackDeck(h: Harness, codes: string[]) {
  const deck = (h.gm as any).deck;
  deck.reset = function () {
    this.cards = codes.map(parseCard).reverse(); // draw() pops from the end
  };
}

export function unstackDeck(h: Harness) {
  delete (h.gm as any).deck.reset;
}

function parseCard(code: string): Card {
  const suit = code[0] as Card['suit'];
  const rank = code.slice(1) as Card['rank'];
  const value = rank === 'A' ? 11 : ['K', 'Q', 'J', '10'].includes(rank) ? 10 : Number(rank);
  return { suit, rank, value };
}

// Make `seat` the banker of the next deal.
export function presetBanker(h: Harness, seat: number) {
  (h.gm as any).firstRound = false;
  h.state().dealerIndex = (seat + 5) % 6;
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

export class Bot {
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
    if (v.turnDeadline === 0) return; // no decision (banker call / auto-pass in progress)
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
    if (v.phase === 'DEALER_CHOICE') {
      if (r < 0.1) return; // let the clock run out (= skip)
      this.emit('dealerChoice', r < 0.6 ? 'PAY' : 'SKIP');
    } else if (v.phase === 'BETTING_1' || v.phase === 'BETTING_2') {
      if (r < 0.08) return; // let the clock run out
      const steps = v.config.raiseSteps;
      if (r < 0.25) this.emit('playerAction', 'FOLD');
      else if (r < 0.65) this.emit('playerAction', 'CALL');
      else if (r < 0.7) this.emit('playerAction', 'RAISE', steps[rand(steps.length)]); // may be refused
      else if (v.canRaise) this.emit('playerAction', 'RAISE', steps[rand(steps.length)]);
      else this.emit('playerAction', 'CALL');
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

export async function waitFor(pred: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(5);
  }
  check(false, `timed out waiting for: ${what}`);
  return false;
}

// Seats bot i at seat i.
export async function seatBots(h: Harness, n: number, auto = true, buyIn?: number) {
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const b = new Bot(h.url, `Bot${i}`, auto);
    await b.connect();
    b.emit('joinGame', b.name, i, buyIn ?? 500 + rand(4500));
    bots.push(b);
    await waitFor(() => h.state().players.length === i + 1, 1000, `${b.name} seated`);
  }
  return bots;
}

export function printCoverage() {
  console.log('\nCoverage:', COVERAGE_PATTERNS.map(([k]) => `${k} ${coverage[k] ?? 0}`).join(' · '));
  const missing = COVERAGE_PATTERNS.map(([k]) => k).filter(k => !coverage[k]);
  if (missing.length) console.log(`(not hit this run: ${missing.join(', ')})`);
}
