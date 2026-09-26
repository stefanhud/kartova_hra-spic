// server/src/game/GameManager.ts
import { randomBytes } from 'crypto';
import { Server, Socket } from 'socket.io';
import { Card, HandType } from './types';
import { ClientView, GameState, Player, RoundResult, SwapOption, createInitialState } from './GameState';
import { Deck } from './deck';
import { HandEvaluator } from './HandEvaluator';

export const ANTE = 5;
export const SEATS = 6;
export const MAX_RAISE = 3;      // A raise adds €1–€3 on top of the current bet
export const MIN_BUY_IN = 5;
export const MAX_BUY_IN = 100;
const MAX_NAME = 16;
const LOG_SIZE = 30;

export interface Timings {
  turn: number;            // Decision clock for a connected player
  offlineTurn: number;     // Decision clock for a disconnected player (they auto-act sooner)
  blindCall: number;       // Pause before the blind banker's automatic call
  noSwap: number;          // "Nothing to swap" notice before the automatic pass
  survivorDelay: number;   // Pause before a lone survivor goes to the talon
  showdown: number;        // How long the showdown stays on screen
  reconnectGrace: number;  // How long a disconnected player keeps their seat
}

export const DEFAULT_TIMINGS: Timings = {
  turn: 15000,
  offlineTurn: 5000,
  blindCall: 1000,
  noSwap: 1700,
  survivorDelay: 1000,
  showdown: 6000,
  reconnectGrace: 120000,
};

const HIDDEN_CARD = { suit: 'X', rank: 'X', value: 0 } as unknown as Card;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

type Timer = ReturnType<typeof setTimeout>;

export class GameManager {
  private state: GameState = createInitialState();
  private deck = new Deck();
  private firstRound = true;       // Random banker on the very first round, then rotate
  private timings: Timings;
  private logSeq = 1;

  // Exactly one pending "flow" timer at a time (turn clock, blind call, auto-pass,
  // phase delay or showdown reset). Scheduling a new one always cancels the old one,
  // so a stale callback can never advance a round that has already moved on.
  private flowTimer: Timer | null = null;
  private emitScheduled = false;

  // Sessions: a secret token (kept in the browser) identifies a player across reconnects.
  private socketToken = new Map<string, string>();   // socket id -> token
  private tokenSocket = new Map<string, string>();   // token -> live socket id
  private tokenPlayer = new Map<string, string>();   // token -> player id
  private playerToken = new Map<string, string>();   // player id -> token
  private removalTimers = new Map<string, Timer>();  // player id -> grace-period timer

  constructor(private io: Server, timings: Partial<Timings> = {}) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  // ---------------------------------------------------------------------------
  // CONNECTIONS
  // ---------------------------------------------------------------------------

  public handleConnection(socket: Socket) {
    const auth = (socket.handshake.auth ?? {}) as { token?: unknown; adopt?: unknown };
    const token = typeof auth.token === 'string' && TOKEN_RE.test(auth.token) ? auth.token : `anon_${socket.id}`;
    const liveSocketId = this.tokenSocket.get(token);
    const liveSocket = liveSocketId ? this.io.sockets.sockets.get(liveSocketId) : undefined;

    if (liveSocket && liveSocketId !== socket.id) {
      if (auth.adopt === true) {
        // A new tab tried to reuse the last session while it is still open elsewhere:
        // tell it to start its own session instead of kicking the other tab.
        socket.emit('tokenInUse');
        socket.disconnect(true);
        return;
      }
      // Same browser tab reconnecting (e.g. the phone switched networks before the
      // server noticed the old connection died): the newest connection wins.
      this.socketToken.delete(liveSocket.id);
      liveSocket.emit('sessionReplaced');
      liveSocket.disconnect(true);
    }

    this.socketToken.set(socket.id, token);
    this.tokenSocket.set(token, socket.id);

    const returning = this.playerByToken(token);
    if (returning) {
      this.cancelRemoval(returning.id);
      if (!returning.connected) {
        returning.connected = true;
        this.log(`${returning.name} is back.`);
      }
    }
    this.scheduleEmit();

    const on = (event: string, handler: (player: Player | undefined, ...args: unknown[]) => void) => {
      socket.on(event, (...args: unknown[]) => {
        if (this.socketToken.get(socket.id) !== token) return; // replaced session
        this.run(() => handler(this.playerByToken(token), ...args));
      });
    };

    on('joinGame', (player, name, seatIndex, buyIn) => this.handleJoin(socket, token, player, name, seatIndex, buyIn));
    on('leaveGame', player => player && this.removePlayer(player.id, 'left'));
    on('rebuy', (player, amount) => this.handleRebuy(socket, player, amount));
    on('startGame', player => this.handleStart(socket, player));
    on('playerAction', (player, action, amount) => this.handlePlayerAction(socket, player, action, amount));
    on('bankerLook', player => this.handleBankerLook(player));
    on('swapCard', (player, handIndex, talonIndex) => this.handleSwap(socket, player, handIndex, talonIndex));
    on('passTurn', player => this.handlePass(player));
    on('dealerSpecial', (player, action) => this.handleDealerSpecial(player, action));

    socket.on('disconnect', () => {
      if (this.socketToken.get(socket.id) !== token) return; // already replaced by a newer connection
      this.socketToken.delete(socket.id);
      if (this.tokenSocket.get(token) === socket.id) this.tokenSocket.delete(token);
      this.run(() => this.handleDisconnect(token));
    });
  }

  private handleDisconnect(token: string) {
    const player = this.playerByToken(token);
    if (!player) return;
    player.connected = false;
    this.log(`${player.name} lost connection.`);

    // Their turn now runs on the short offline clock.
    const s = this.state;
    if (this.isInRound() && s.turnIndex === player.seatIndex && s.turnDeadline - Date.now() > this.timings.offlineTurn) {
      this.armTurnTimer(player);
    }

    this.cancelRemoval(player.id);
    this.removalTimers.set(player.id, setTimeout(() => {
      this.removalTimers.delete(player.id);
      this.run(() => this.removePlayer(player.id, 'timeout'));
    }, this.timings.reconnectGrace));
  }

  private cancelRemoval(playerId: string) {
    const t = this.removalTimers.get(playerId);
    if (t) clearTimeout(t);
    this.removalTimers.delete(playerId);
  }

  // ---------------------------------------------------------------------------
  // SEATING
  // ---------------------------------------------------------------------------

  private handleJoin(socket: Socket, token: string, existing: Player | undefined, rawName: unknown, rawSeat: unknown, rawBuyIn: unknown) {
    const seatIndex = Number(rawSeat);
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= SEATS) return;
    if (this.playerAt(seatIndex)) return this.error(socket, 'That seat is taken.');

    if (existing) {
      // Moving seats mid-round would corrupt the turn order.
      if (this.isInRound()) return this.error(socket, 'You can change seats between hands.');
      const oldSeat = existing.seatIndex;
      existing.seatIndex = seatIndex;
      this.log(`${existing.name} moved from seat ${oldSeat + 1} to seat ${seatIndex + 1}.`);
      return;
    }

    const name = typeof rawName === 'string'
      ? rawName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME)
      : '';
    if (!name) return this.error(socket, 'Enter a name first.');

    const inRound = this.isInRound();
    const player: Player = {
      id: randomBytes(8).toString('hex'),
      name,
      seatIndex,
      chips: this.clampBuyIn(rawBuyIn),
      hand: [],
      isFolded: inRound,
      sittingOut: inRound,
      bet: 0,
      score: 0,
      connected: true,
    };
    this.state.players.push(player);
    this.tokenPlayer.set(token, player.id);
    this.playerToken.set(player.id, token);
    this.log(`${name} sat down at seat ${seatIndex + 1} with €${player.chips}.${inRound ? ' Playing from the next hand.' : ''}`);
  }

  private handleRebuy(socket: Socket, player: Player | undefined, rawAmount: unknown) {
    if (!player || player.chips > 0) return;
    if (this.isInRound() && !player.sittingOut) return this.error(socket, 'You can rebuy after this hand.');
    player.chips = this.clampBuyIn(rawAmount);
    this.log(`${player.name} rebought for €${player.chips}.`);
  }

  private clampBuyIn(raw: unknown): number {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(MIN_BUY_IN, Math.min(MAX_BUY_IN, Math.round(n))) : 50;
  }

  private removePlayer(playerId: string, reason: 'left' | 'timeout') {
    const s = this.state;
    const player = s.players.find(p => p.id === playerId);
    if (!player) return;

    const inRound = this.isInRound();
    const wasTurn = inRound && s.turnIndex === player.seatIndex;
    const wasActive = inRound && !player.isFolded;

    this.cancelRemoval(playerId);
    const token = this.playerToken.get(playerId);
    if (token) this.tokenPlayer.delete(token);
    this.playerToken.delete(playerId);
    s.players = s.players.filter(p => p.id !== playerId);

    const verb = reason === 'timeout' ? 'was removed after losing connection' : 'left the table';
    this.log(`${player.name} ${verb}${wasActive ? ' and folds' : ''}.`);

    if (s.players.length === 0) {
      this.resetTable();
      return;
    }
    if (!wasActive) return;

    // Never leave the round waiting on someone who is gone.
    if (s.phase === 'BETTING_1' || s.phase === 'BETTING_2') {
      if (wasTurn) this.promptNextBettor(player.seatIndex);
      else if (this.activePlayers().length < 2) this.resolveShortHanded();
    } else if (s.phase === 'DEALER_SPECIAL') {
      if (player.seatIndex === s.dealerIndex) this.revealDealerAndStartSwaps(false);
    } else if (s.phase === 'TALON_SWAP') {
      if (wasTurn) this.afterSwapAction(player.seatIndex);
      else if (this.activePlayers().length === 0) this.endGame();
    }
  }

  // Everyone left: start from a clean table (the old pot belonged to people who are gone).
  private resetTable() {
    this.clearFlowTimer();
    const log = this.state.log;
    const roundId = this.state.roundId;
    this.state = createInitialState();
    this.state.log = log;
    this.state.roundId = roundId;
    this.firstRound = true;
    this.log('Table is empty — pot cleared.');
  }

  // ---------------------------------------------------------------------------
  // STARTING A ROUND
  // ---------------------------------------------------------------------------

  private handleStart(socket: Socket, requester: Player | undefined) {
    const s = this.state;
    if (s.phase !== 'WAITING' || !requester) return;

    const eligible = s.players.filter(p => p.connected && p.chips > 0);
    if (eligible.length < 2) return this.error(socket, 'Need at least 2 players with chips to deal.');

    this.deck.reset();
    s.roundId++;
    s.result = null;
    s.gameWinner = null;
    s.talon = [];
    s.minScoreToBeat = 0;
    s.swappedPlayers = [];

    // Banker rotates every round; random pick only on the very first round.
    if (this.firstRound) {
      s.dealerIndex = eligible[Math.floor(Math.random() * eligible.length)].seatIndex;
      this.firstRound = false;
    } else {
      const next = this.findNextSeat(s.dealerIndex, p => eligible.includes(p));
      if (next) s.dealerIndex = next.seatIndex;
    }

    for (const p of s.players) {
      p.bet = 0;
      p.hand = [];
      p.score = 0;
      p.specialStatus = undefined;
      p.isFaceUp = false;
      p.hasLooked = false;
      p.hasActed = false;
      p.lastAction = undefined;

      if (!eligible.includes(p)) {
        p.isFolded = true;
        p.sittingOut = true;
        continue;
      }
      p.isFolded = false;
      p.sittingOut = false;

      const ante = Math.min(p.chips, ANTE); // Can't go negative
      p.chips -= ante;
      s.pot += ante;

      const c1 = this.deck.draw();
      const c2 = this.deck.draw();
      if (c1 && c2) p.hand.push(c1, c2);
      p.score = HandEvaluator.evaluate(p.hand).score;
    }

    const banker = this.playerAt(s.dealerIndex);
    this.log(`New hand — ${banker?.name ?? 'Seat ' + (s.dealerIndex + 1)} is the banker. Everyone antes €${ANTE}.`);
    this.startBettingRound('BETTING_1');
  }

  // ---------------------------------------------------------------------------
  // BETTING
  // ---------------------------------------------------------------------------

  private startBettingRound(phase: 'BETTING_1' | 'BETTING_2') {
    const s = this.state;
    s.phase = phase;
    s.currentBet = 0;
    for (const p of s.players) {
      p.bet = 0;
      p.hasActed = false;
      if (!p.isFolded) p.lastAction = undefined;
    }
    this.promptNextBettor(s.dealerIndex);
  }

  // A player still owes a decision if they haven't acted since the last raise or
  // haven't matched the current bet. Players with no chips left are all-in and skipped.
  private needsToAct(p: Player) {
    return !p.isFolded && p.chips > 0 && (!p.hasActed || p.bet < this.state.currentBet);
  }

  private promptNextBettor(fromSeat: number) {
    const s = this.state;
    if (this.activePlayers().length < 2) {
      this.resolveShortHanded();
      return;
    }

    const next = this.findNextSeat(fromSeat, p => this.needsToAct(p));
    if (!next) {
      this.advancePhase();
      return;
    }

    s.turnIndex = next.seatIndex;

    if (this.isBlindBanker(next)) {
      // The blind banker always calls, after a short pause so everyone sees it happen.
      s.turnNonce++;
      s.turnDeadline = 0;
      s.turnDuration = 0;
      const nonce = s.turnNonce;
      this.setFlowTimer(() => {
        if (s.turnNonce !== nonce) return;
        this.applyCall(next, true);
      }, this.timings.blindCall);
      return;
    }

    this.armTurnTimer(next);
  }

  // Fewer than two players left in the hand during a betting round.
  private resolveShortHanded() {
    const active = this.activePlayers();
    if (active.length === 0) {
      this.endGame();
      return;
    }
    // A survivor who already holds a scoring hand wins now; otherwise they have to
    // prove a hand (third card / talon) first.
    if ((active[0].score ?? 0) > 0) {
      this.endGame();
      return;
    }
    this.advancePhase();
  }

  private advancePhase() {
    this.noTurn();
    if (this.state.phase === 'BETTING_1') this.dealThirdCard();
    else if (this.state.phase === 'BETTING_2') this.startTalonPhase();
  }

  private handlePlayerAction(socket: Socket, player: Player | undefined, rawAction: unknown, rawAmount: unknown) {
    const s = this.state;
    if (!player || (s.phase !== 'BETTING_1' && s.phase !== 'BETTING_2')) return;
    if (s.turnIndex !== player.seatIndex || !this.needsToAct(player)) return;
    if (this.isBlindBanker(player)) return; // blind banker calls automatically

    if (rawAction === 'FOLD') {
      // Banker's burden: the banker can never fold.
      if (player.seatIndex === s.dealerIndex) return this.error(socket, 'As the banker you cannot fold — you must call.');
      this.fold(player, 'folded');
      return;
    }

    if (rawAction === 'CALL') {
      this.applyCall(player, false);
      return;
    }

    if (rawAction === 'RAISE') {
      const step = Number(rawAmount);
      if (!Number.isInteger(step) || step < 1 || step > MAX_RAISE) return;
      const raiseTo = s.currentBet + step;
      const cost = raiseTo - player.bet;
      if (cost > player.chips) return this.error(socket, `You need €${cost} to raise to €${raiseTo}.`);

      player.chips -= cost;
      player.bet = raiseTo;
      s.pot += cost;
      s.currentBet = raiseTo;
      player.hasActed = true;
      player.lastAction = player.chips === 0 ? `All-in €${raiseTo}` : `Raise €${raiseTo}`;
      // Everyone else has to respond to the raise.
      for (const p of s.players) if (p !== player && !p.isFolded) p.hasActed = false;
      this.log(`${player.name} raised to €${raiseTo}.`);
      this.promptNextBettor(player.seatIndex);
    }
  }

  private fold(player: Player, how: string) {
    player.isFolded = true;
    player.hasActed = true;
    player.lastAction = 'Fold';
    this.log(`${player.name} ${how}.`);
    this.promptNextBettor(player.seatIndex);
  }

  private applyCall(player: Player, blind: boolean, timedOut = false) {
    const s = this.state;
    const owed = s.currentBet - player.bet;
    const pay = Math.min(player.chips, owed);
    player.chips -= pay;
    player.bet += pay;
    s.pot += pay;
    player.hasActed = true;

    let label: string;
    if (owed === 0) label = 'Check';
    else if (player.chips === 0) label = pay < owed ? `All-in €${player.bet}` : 'All-in';
    else label = `Call €${pay}`;
    player.lastAction = label;

    const who = blind ? `${player.name} (blind banker)` : player.name;
    const prefix = timedOut ? `${player.name} ran out of time — ` : `${who} `;
    const verb = owed === 0 ? 'checks' : pay < owed || player.chips === 0 ? `goes all-in (€${pay})` : `calls €${pay}`;
    this.log(`${prefix}${verb}.`);
    this.promptNextBettor(player.seatIndex);
  }

  private handleBankerLook(player: Player | undefined) {
    const s = this.state;
    if (!player || player.seatIndex !== s.dealerIndex) return;
    if (s.phase !== 'BETTING_1' && s.phase !== 'BETTING_2') return;
    if (player.hasLooked || player.isFolded) return;

    // The banker peeks: they see their hand and bet like everyone else (never fold),
    // but they forfeit the privilege of taking a strong talon.
    player.hasLooked = true;
    this.log(`${player.name} (banker) looked at their cards — talon privilege forfeited.`);

    // If their blind auto-call was about to fire, give them a real decision instead.
    if (s.turnIndex === player.seatIndex && s.turnDeadline === 0 && this.needsToAct(player)) {
      this.armTurnTimer(player);
    }
  }

  private dealThirdCard() {
    const s = this.state;
    s.phase = 'BETTING_2';
    s.currentBet = 0;

    for (const p of s.players) {
      p.bet = 0;
      if (p.isFolded) continue;
      const c3 = this.deck.draw();
      if (c3) p.hand.push(c3);
      const res = HandEvaluator.evaluate(p.hand);
      p.score = res.score;

      // Auto-fold a Bicykel (dead hand). The banker's hand stays hidden until the talon.
      if (p.seatIndex !== s.dealerIndex) {
        if (res.type === HandType.BICYKEL) {
          p.isFolded = true;
          p.specialStatus = 'BICYKEL';
          p.lastAction = 'Bicykel';
          this.log(`${p.name} has a Bicykel — auto-fold.`);
        } else {
          p.specialStatus = undefined;
        }
      }
    }

    const active = this.activePlayers();
    if (active.length === 0) {
      this.endGame();
      return;
    }
    if (active.length === 1) {
      const survivor = active[0];
      // Already holds a Flush/Trojica -> wins immediately.
      if ((survivor.score ?? 0) > 0) {
        this.endGame();
        return;
      }
      // Otherwise they must prove a hand in the talon phase.
      this.log(`Everyone else is out — ${survivor.name} goes to the talon to prove a hand.`);
      this.setFlowTimer(() => this.startTalonPhase(), this.timings.survivorDelay);
      return;
    }

    this.log('Third card dealt — second betting round.');
    this.startBettingRound('BETTING_2');
  }

  // ---------------------------------------------------------------------------
  // TALON
  // ---------------------------------------------------------------------------

  private startTalonPhase() {
    const s = this.state;
    this.noTurn();
    s.minScoreToBeat = 0;
    s.swappedPlayers = [];
    s.currentBet = 0;
    for (const p of s.players) {
      p.bet = 0;
      if (!p.isFolded) p.lastAction = undefined;
    }

    s.talon = [];
    for (let i = 0; i < 4; i++) {
      const c = this.deck.draw();
      if (c) s.talon.push(c);
    }
    this.log('Betting closed — the talon is on the table.');

    const dealer = this.playerAt(s.dealerIndex);
    const best = HandEvaluator.getBestSubset(s.talon);
    const isSpecial = !!best && (
      best.result.type === HandType.TROJICA ||
      best.result.type === HandType.ZLATY_SPIC ||
      !!best.result.isFlush
    );

    // The blind-risk privilege only survives if the banker never looked at their hand.
    if (isSpecial && dealer && !dealer.isFolded && !dealer.hasLooked) {
      s.phase = 'DEALER_SPECIAL';
      s.turnIndex = dealer.seatIndex;
      this.armTurnTimer(dealer);
      this.log(`Banker's option: the talon holds ${best!.result.description}!`);
    } else {
      this.revealDealerAndStartSwaps(false);
    }
  }

  private handleDealerSpecial(player: Player | undefined, action: unknown) {
    const s = this.state;
    if (!player || s.phase !== 'DEALER_SPECIAL' || player.seatIndex !== s.dealerIndex) return;
    if (action !== 'TAKE' && action !== 'PASS') return;

    const best = action === 'TAKE' ? HandEvaluator.getBestSubset(s.talon) : null;
    if (!best) {
      this.log(`${player.name} keeps their own hand.`);
      this.revealDealerAndStartSwaps(false);
      return;
    }

    // The banker swaps their whole hand for the best three talon cards.
    const oldHand = [...player.hand];
    const newHand: Card[] = [];
    best.indices.forEach((talonIdx, i) => {
      newHand.push(s.talon[talonIdx]);
      s.talon[talonIdx] = oldHand[i];
    });
    player.hand = newHand;
    player.isFaceUp = true;
    player.score = best.result.score;
    player.lastAction = 'Took talon';
    s.minScoreToBeat = best.result.score; // sets the bar
    s.swappedPlayers.push(player.id);
    this.log(`${player.name} takes the talon hand — ${best.result.description}!`);
    this.revealDealerAndStartSwaps(true); // a talon special is never a Bicykel
  }

  private revealDealerAndStartSwaps(skipBicykelCheck: boolean) {
    const s = this.state;
    s.phase = 'TALON_SWAP';

    const dealer = this.playerAt(s.dealerIndex);
    if (dealer && !dealer.isFolded && !skipBicykelCheck) {
      if (HandEvaluator.evaluate(dealer.hand).type === HandType.BICYKEL) {
        dealer.isFolded = true;
        dealer.specialStatus = 'BICYKEL';
        dealer.isFaceUp = true;
        dealer.lastAction = 'Bicykel';
        this.log(`${dealer.name} (banker) has a Bicykel — auto-fold.`);
      }
    }

    // Folding the banker (or earlier Bicykel folds) may have left nobody in the hand.
    if (this.activePlayers().length === 0) {
      this.endGame();
      return;
    }
    this.promptNextSwapper(s.dealerIndex);
  }

  private promptNextSwapper(fromSeat: number) {
    const s = this.state;
    const next = this.findNextSeat(fromSeat, p => !p.isFolded && !s.swappedPlayers.includes(p.id));
    if (!next) {
      this.endGame();
      return;
    }
    this.beginSwapTurn(next);
  }

  private afterSwapAction(fromSeat: number) {
    if (this.activePlayers().length < 2) {
      this.endGame();
      return;
    }
    this.promptNextSwapper(fromSeat);
  }

  // If the player cannot end up beating the bar, show them a short "nothing to swap"
  // notice and pass automatically.
  private beginSwapTurn(player: Player) {
    const s = this.state;
    s.turnIndex = player.seatIndex;

    const current = HandEvaluator.evaluate(player.hand).score;
    const stuck = current <= s.minScoreToBeat && this.swapOptionsFor(player).length === 0;
    if (!stuck) {
      this.armTurnTimer(player);
      return;
    }

    s.turnNonce++;
    s.turnDeadline = 0;
    s.turnDuration = 0;
    const nonce = s.turnNonce;
    this.emitToPlayer(player, 'noSwap');
    this.log(`${player.name} can't improve — passes.`);
    this.setFlowTimer(() => {
      if (s.turnNonce !== nonce || s.phase !== 'TALON_SWAP') return;
      this.doPass(player, true);
    }, this.timings.noSwap);
  }

  private swapOptionsFor(player: Player): SwapOption[] {
    const s = this.state;
    const options: SwapOption[] = [];
    for (let h = 0; h < player.hand.length; h++) {
      for (let t = 0; t < s.talon.length; t++) {
        const temp = [...player.hand];
        temp[h] = s.talon[t];
        const score = HandEvaluator.evaluate(temp).score;
        if (score > s.minScoreToBeat) options.push({ h, t, score });
      }
    }
    return options;
  }

  private canSwapNow(player: Player | undefined): player is Player {
    const s = this.state;
    return !!player && s.phase === 'TALON_SWAP' && s.turnIndex === player.seatIndex
      && !player.isFolded && !s.swappedPlayers.includes(player.id);
  }

  private handleSwap(socket: Socket, player: Player | undefined, rawHand: unknown, rawTalon: unknown) {
    if (!this.canSwapNow(player)) return;
    const s = this.state;
    const handIndex = Number(rawHand);
    const talonIndex = Number(rawTalon);
    if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= player.hand.length) return;
    if (!Number.isInteger(talonIndex) || talonIndex < 0 || talonIndex >= s.talon.length) return;

    const temp = [...player.hand];
    temp[handIndex] = s.talon[talonIndex];
    const preview = HandEvaluator.evaluate(temp);

    // A swap must produce a scoring hand that strictly beats the current bar.
    if (preview.score <= s.minScoreToBeat) {
      const need = s.minScoreToBeat > 0 ? `beat ${s.minScoreToBeat}` : 'make a Flush or Trojica';
      return this.error(socket, `That swap only makes ${preview.score} — you must ${need}.`);
    }

    const fromHand = player.hand[handIndex];
    player.hand[handIndex] = s.talon[talonIndex];
    s.talon[talonIndex] = fromHand;

    const result = HandEvaluator.evaluate(player.hand);
    if (result.score > s.minScoreToBeat) s.minScoreToBeat = result.score;
    player.score = result.score;
    player.lastAction = 'Swap';
    s.swappedPlayers.push(player.id);

    if (result.type === HandType.BICYKEL) {
      player.isFolded = true;
      player.specialStatus = 'BICYKEL';
      this.log(`${player.name} swapped into a Bicykel — auto-fold.`);
    } else {
      player.specialStatus = undefined;
      this.log(`${player.name} swapped — new bar is ${result.score}.`);
    }
    this.afterSwapAction(player.seatIndex);
  }

  private handlePass(player: Player | undefined) {
    if (!this.canSwapNow(player)) return;
    this.doPass(player, false);
  }

  private doPass(player: Player, auto: boolean) {
    const s = this.state;
    if (s.swappedPlayers.includes(player.id)) return;
    s.swappedPlayers.push(player.id);
    player.lastAction = 'Pass';
    if (!auto) this.log(`${player.name} passes.`);
    this.afterSwapAction(player.seatIndex);
  }

  // ---------------------------------------------------------------------------
  // SHOWDOWN
  // ---------------------------------------------------------------------------

  private endGame() {
    const s = this.state;
    this.noTurn();
    s.phase = 'SHOWDOWN';

    let winners: Player[] = [];
    let byFold = false;
    let voidReason = '';

    const activePlayers = s.players.filter(p => !p.isFolded);

    // Sort by turn order (closest to the banker's left first) to resolve 31 vs 31 ties.
    const dealerSeat = s.dealerIndex;
    activePlayers.sort((a, b) => {
      const distA = (a.seatIndex - (dealerSeat + 1) + SEATS) % SEATS;
      const distB = (b.seatIndex - (dealerSeat + 1) + SEATS) % SEATS;
      return distA - distB;
    });

    if (activePlayers.length === 0) {
      // Everyone folded (Bicykels) -> nobody wins.
      voidReason = 'Nobody is left in the hand.';
    } else if (activePlayers.length === 1) {
      // One survivor must hold a Flush/Triple to take the pot.
      const survivor = activePlayers[0];
      const res = HandEvaluator.evaluate(survivor.hand);
      if (res.score > 0) {
        winners = [survivor];
        byFold = true;
      } else {
        voidReason = `${survivor.name} has no Flush or Trojica.`;
        this.log(`Everyone else folded, but ${survivor.name} has no Flush/Trojica. Pot stays!`);
      }
    } else {
      let bestScore = -1;
      let bestTieBreak = -1; // Trojica rank: KKK beats QQQ despite both being 30.5
      for (const p of activePlayers) {
        const result = HandEvaluator.evaluate(p.hand);
        p.score = result.score;
        const tieBreak = result.tieBreak ?? 0;
        if (result.score > bestScore || (result.score === bestScore && tieBreak > bestTieBreak)) {
          bestScore = result.score;
          bestTieBreak = tieBreak;
          winners = [p];
        } else if (result.score === bestScore && tieBreak === bestTieBreak) {
          // Priority rule for 31 (Špic): the earliest in turn order wins.
          if (bestScore === 31) continue;
          winners.push(p);
        }
      }
    }

    // --- ESCALATION RULE (progressive pot) ---
    // After a tie, the next winner must EXCEED the tied score to take the pot.
    let thresholdMiss: { name: string; score: number } | null = null;
    if (winners.length === 1 && s.potThreshold > 0) {
      const winnerScore = HandEvaluator.evaluate(winners[0].hand).score;
      if (winnerScore <= s.potThreshold) {
        thresholdMiss = { name: winners[0].name, score: winnerScore };
        this.log(`${winners[0].name} won the hand with ${winnerScore}, but needed more than ${s.potThreshold}. Pot stays!`);
        winners = [];
      }
    }

    const pot = s.pot;
    let result: RoundResult;

    if (winners.length === 1) {
      const winner = winners[0];
      const desc = HandEvaluator.evaluate(winner.hand).description;
      winner.chips += pot;
      s.gameWinner = winner.id;
      s.pot = 0;
      s.potThreshold = 0;
      this.log(`${winner.name} wins €${pot}${byFold ? ' — everyone else folded' : ` with ${desc}`}.`);
      result = {
        winnerIds: [winner.id],
        amount: pot,
        headline: `${winner.name} wins €${pot}`,
        detail: byFold ? 'Everyone else folded' : desc,
      };
    } else {
      // Tie or void: the pot stays for the next round.
      if (winners.length > 1) {
        const tiedScore = HandEvaluator.evaluate(winners[0].hand).score;
        s.potThreshold = Math.max(s.potThreshold, tiedScore);
      }
      const next = s.potThreshold > 0 ? ` Next winner needs more than ${s.potThreshold}.` : '';
      this.log(`${winners.length > 1 ? 'Tie' : 'No winner'} — the €${pot} pot stays.${next}`);

      let detail: string;
      if (thresholdMiss) {
        detail = `${thresholdMiss.name} had ${thresholdMiss.score} but needed more than ${s.potThreshold}`;
      } else {
        const why = winners.length > 1
          ? `${winners.map(w => w.name).join(' & ')} tied on ${HandEvaluator.evaluate(winners[0].hand).description}`
          : voidReason || 'Nobody qualified';
        detail = s.potThreshold > 0 ? `${why} · next winner must beat ${s.potThreshold}` : why;
      }
      result = {
        winnerIds: [],
        amount: pot,
        headline: winners.length > 1 ? `Tie — €${pot} stays` : `Pot of €${pot} stays`,
        detail,
      };
    }
    s.result = result;

    this.setFlowTimer(() => this.resetToWaiting(), this.timings.showdown);
  }

  private resetToWaiting() {
    const s = this.state;
    s.phase = 'WAITING';
    s.gameWinner = null;
    s.talon = [];
    s.minScoreToBeat = 0;
    s.swappedPlayers = [];
    s.currentBet = 0;
    this.noTurn();

    // Reset player states but keep chips and pot.
    for (const p of s.players) {
      p.hand = [];
      p.bet = 0;
      p.isFolded = false;
      p.sittingOut = false;
      p.specialStatus = undefined;
      p.isFaceUp = false;
      p.score = 0;
      p.hasLooked = false;
      p.hasActed = false;
      p.lastAction = undefined;
    }
    this.log('Ready for the next hand.');
  }

  // ---------------------------------------------------------------------------
  // TIMERS
  // ---------------------------------------------------------------------------

  private setFlowTimer(fn: () => void, ms: number) {
    this.clearFlowTimer();
    this.flowTimer = setTimeout(() => {
      this.flowTimer = null;
      this.run(fn);
    }, ms);
  }

  private clearFlowTimer() {
    if (this.flowTimer) clearTimeout(this.flowTimer);
    this.flowTimer = null;
  }

  private noTurn() {
    this.clearFlowTimer();
    this.state.turnIndex = -1;
    this.state.turnDeadline = 0;
    this.state.turnDuration = 0;
  }

  // Start the decision clock for `player`; auto-acts if they stall.
  private armTurnTimer(player: Player) {
    const s = this.state;
    const ms = player.connected ? this.timings.turn : this.timings.offlineTurn;
    s.turnIndex = player.seatIndex;
    s.turnNonce++;
    s.turnDeadline = Date.now() + ms;
    s.turnDuration = ms;
    const nonce = s.turnNonce;
    this.setFlowTimer(() => this.autoAct(nonce), ms);
  }

  private autoAct(nonce: number) {
    const s = this.state;
    if (s.turnNonce !== nonce) return; // turn already moved on
    const player = this.playerAt(s.turnIndex);
    if (!player || player.isFolded) return;

    if (s.phase === 'BETTING_1' || s.phase === 'BETTING_2') {
      const owed = s.currentBet - player.bet;
      // Banker can't fold, and a free check is never worse than folding.
      if (player.seatIndex === s.dealerIndex || owed === 0) this.applyCall(player, false, true);
      else this.fold(player, 'ran out of time — fold');
    } else if (s.phase === 'TALON_SWAP') {
      this.log(`${player.name} ran out of time — pass.`);
      this.doPass(player, true);
    } else if (s.phase === 'DEALER_SPECIAL') {
      this.log(`${player.name} ran out of time — keeps their own hand.`);
      this.revealDealerAndStartSwaps(false);
    }
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private isInRound() {
    return this.state.phase !== 'WAITING' && this.state.phase !== 'SHOWDOWN';
  }

  private isBlindBanker(p: Player) {
    const phase = this.state.phase;
    return p.seatIndex === this.state.dealerIndex && !p.hasLooked && !p.isFolded
      && (phase === 'BETTING_1' || phase === 'BETTING_2' || phase === 'DEALER_SPECIAL');
  }

  private playerAt(seat: number) {
    return this.state.players.find(p => p.seatIndex === seat);
  }

  private playerByToken(token: string) {
    const id = this.tokenPlayer.get(token);
    return id ? this.state.players.find(p => p.id === id) : undefined;
  }

  private activePlayers() {
    return this.state.players.filter(p => !p.isFolded);
  }

  // First player clockwise after `fromSeat` (wrapping round to `fromSeat` itself) matching `pred`.
  private findNextSeat(fromSeat: number, pred: (p: Player) => boolean): Player | undefined {
    for (let i = 1; i <= SEATS; i++) {
      const p = this.playerAt((fromSeat + i) % SEATS);
      if (p && pred(p)) return p;
    }
    return undefined;
  }

  private log(text: string) {
    this.state.log.push({ id: ++this.logSeq, text });
    if (this.state.log.length > LOG_SIZE) this.state.log.shift();
  }

  private error(socket: Socket, message: string) {
    socket.emit('actionError', message);
  }

  private emitToPlayer(player: Player, event: string) {
    const token = this.playerToken.get(player.id);
    const socketId = token ? this.tokenSocket.get(token) : undefined;
    if (socketId) this.io.to(socketId).emit(event);
  }

  // Run a state mutation safely and push the new state to everyone once per tick.
  private run(fn: () => void) {
    try {
      fn();
    } catch (err) {
      console.error('Game error:', err);
    }
    this.scheduleEmit();
  }

  private scheduleEmit() {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    setImmediate(() => {
      this.emitScheduled = false;
      this.state.deckRemaining = this.deck.remaining;
      let spectatorView: ClientView | null = null;
      for (const [id, socket] of this.io.sockets.sockets) {
        const token = this.socketToken.get(id);
        const seated = token ? this.tokenPlayer.has(token) : false;
        if (seated) socket.emit('gameState', this.viewFor(token));
        else socket.emit('gameState', spectatorView ??= this.viewFor(undefined));
      }
    });
  }

  // Each client gets a view with hidden cards masked (prevents peeking via dev tools).
  public viewFor(token: string | undefined): ClientView {
    const s = this.state;
    const viewerId = token ? this.tokenPlayer.get(token) : undefined;
    const showdown = s.phase === 'SHOWDOWN';
    const viewer = viewerId ? s.players.find(p => p.id === viewerId) : undefined;

    const players = s.players.map(p => {
      const own = p.id === viewerId;
      // The blind banker doesn't get to see their own cards until they look or the talon is played.
      const visible = (own && !this.isBlindBanker(p)) || p.isFaceUp || (showdown && !p.isFolded);
      if (!visible) return { ...p, hand: p.hand.map(() => HIDDEN_CARD), score: 0 };
      return { ...p, handDesc: p.hand.length ? HandEvaluator.evaluate(p.hand).description : undefined };
    });

    const swapOptions = viewer && this.canSwapNow(viewer) && s.turnDeadline > 0 ? this.swapOptionsFor(viewer) : [];

    return {
      ...s,
      players,
      you: viewerId ?? null,
      serverNow: Date.now(),
      swapOptions,
      config: { ante: ANTE, maxRaise: MAX_RAISE, minBuyIn: MIN_BUY_IN, maxBuyIn: MAX_BUY_IN, seats: SEATS },
    };
  }
}
