// server/src/game/GameManager.ts
import { randomBytes } from 'crypto';
import { Server, Socket } from 'socket.io';
import { Card, HandType } from './types';
import { ClientView, GameState, Player, RoundResult, SwapOption, createInitialState } from './GameState';
import { Deck } from './deck';
import { HandEvaluator } from './HandEvaluator';
import { euro } from './money';

// Money is in euro cents.
export const ANTE = 50;
export const SEATS = 6;
export const RAISE_STEPS = [50, 100, 200]; // A raise adds €0.50, €1 or €2 on top of the current bet
export const MAX_RAISES = 2;               // One raise and one re-raise per betting round
export const MIN_BUY_IN = 500;
export const MAX_BUY_IN = 5000;
export const DEFAULT_BUY_IN = 2000;
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
  reconnectGrace: 300000,
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
    on('dealerChoice', (player, action) => this.handleDealerChoice(socket, player, action));

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
      bought: 0,
      hand: [],
      isFolded: inRound,
      sittingOut: inRound,
      bet: 0,
      handBets: 0,
      // Joining while a pot is carried over costs what the players who built it paid.
      debt: this.state.carryTotal,
      score: 0,
      connected: true,
    };
    player.bought = player.chips;
    this.state.players.push(player);
    this.tokenPlayer.set(token, player.id);
    this.playerToken.set(player.id, token);
    const owes = player.debt > 0 ? ` Owes ${euro(player.debt)} to join the carried-over pot.` : '';
    this.log(`${name} sat down at seat ${seatIndex + 1} with ${euro(player.chips)}.${inRound ? ' Playing from the next hand.' : ''}${owes}`);
  }

  private handleRebuy(socket: Socket, player: Player | undefined, rawAmount: unknown) {
    if (!player || player.chips > 0) return;
    const dealtIn = this.isInRound() && this.state.phase !== 'DEALER_CHOICE' && !player.sittingOut;
    if (dealtIn) return this.error(socket, 'You can rebuy after this hand.');
    player.chips = this.clampBuyIn(rawAmount);
    player.bought += player.chips;
    this.log(`${player.name} rebought for ${euro(player.chips)}.`);
  }

  // Buy-ins are whole 50-cent steps between the table limits.
  private clampBuyIn(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_BUY_IN;
    return Math.max(MIN_BUY_IN, Math.min(MAX_BUY_IN, Math.round(n / 50) * 50));
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
    // Their result for the evening stays on record for settling up.
    if (player.chips !== player.bought) s.departed.push({ name: player.name, balance: player.chips - player.bought });

    const verb = reason === 'timeout' ? 'was removed after losing connection' : 'left the table';
    this.log(`${player.name} ${verb}${wasActive ? ' and folds' : ''}.`);

    if (s.players.length === 0) {
      this.resetTable();
      return;
    }
    if (!wasActive) return;

    // Never leave the round waiting on someone who is gone.
    if (s.phase === 'DEALER_CHOICE') {
      if (wasTurn) this.passDeal(player.seatIndex);
    } else if (s.phase === 'BETTING_1' || s.phase === 'BETTING_2') {
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
    this.log('Table is empty — pot and scores cleared.');
  }

  // ---------------------------------------------------------------------------
  // STARTING A ROUND
  // ---------------------------------------------------------------------------

  // Can be dealt into the next hand.
  private isEligible(p: Player) {
    return p.connected && !p.benched;
  }

  private handleStart(socket: Socket, requester: Player | undefined) {
    const s = this.state;
    if (s.phase !== 'WAITING' || !requester) return;

    let eligible = s.players.filter(p => this.isEligible(p));
    if (eligible.length < 2 && s.players.some(p => p.benched)) {
      // Too few players left to ever win the pot: benched players come back in (still owing).
      for (const p of s.players) p.benched = false;
      this.log('Too few players — everyone who skipped is back in.');
      eligible = s.players.filter(p => this.isEligible(p));
    }
    if (eligible.length < 2) return this.error(socket, 'Need at least 2 players to deal.');

    // Banker rotates every round; random pick only on the very first round.
    let candidate: Player | undefined;
    if (this.firstRound) {
      candidate = eligible[Math.floor(Math.random() * eligible.length)];
      this.firstRound = false;
    } else {
      candidate = this.findNextSeat(s.dealerIndex, p => this.isEligible(p));
    }
    if (candidate) this.offerDeal(candidate);
  }

  // The next banker deals, unless they owe money to the carried-over pot: then they
  // choose between paying it and dealing, or skipping until the pot is won.
  private offerDeal(candidate: Player) {
    const s = this.state;
    if (candidate.debt === 0) {
      this.dealHand(candidate);
      return;
    }

    const others = s.players.filter(p => p !== candidate && this.isEligible(p));
    if (others.length < 2) {
      // Skipping would leave nobody to play against, so they have to deal.
      const paid = this.payDebt(candidate);
      this.log(`${candidate.name} must deal (too few players to skip) and pays ${euro(paid)} owed.`);
      this.dealHand(candidate);
      return;
    }

    s.phase = 'DEALER_CHOICE';
    s.result = null;
    s.dealerIndex = candidate.seatIndex;
    this.armTurnTimer(candidate);
    this.log(`${candidate.name} is next to deal but owes ${euro(candidate.debt)} — pay and deal, or skip?`);
  }

  private handleDealerChoice(socket: Socket, player: Player | undefined, action: unknown) {
    const s = this.state;
    if (!player || s.phase !== 'DEALER_CHOICE' || s.turnIndex !== player.seatIndex) return;
    if (action === 'PAY') {
      const paid = this.payDebt(player);
      this.log(`${player.name} pays ${euro(paid)} owed and deals.`);
      this.dealHand(player);
    } else if (action === 'SKIP') {
      this.skipDeal(player, 'skips dealing');
    }
  }

  private skipDeal(player: Player, how: string) {
    player.benched = true;
    this.log(`${player.name} ${how} and sits out until the pot is won.`);
    this.passDeal(player.seatIndex);
  }

  // The deal passes to the next player who owes nothing (or, failing that, the next player).
  private passDeal(fromSeat: number) {
    const s = this.state;
    const eligible = s.players.filter(p => this.isEligible(p));
    if (eligible.length < 2) {
      s.phase = 'WAITING';
      this.noTurn();
      this.log('Not enough players to deal.');
      return;
    }
    const next = this.findNextSeat(fromSeat, p => this.isEligible(p) && p.debt === 0)
      ?? this.findNextSeat(fromSeat, p => this.isEligible(p));
    if (next) this.offerDeal(next);
  }

  // Take the missing money from the player's wallet so their chips cover `needed`.
  private topUp(p: Player, needed: number) {
    const missing = needed - p.chips;
    if (missing <= 0) return;
    p.chips += missing;
    p.bought += missing;
    this.log(`${p.name} tops up ${euro(missing)}.`);
  }

  private payDebt(p: Player) {
    const paid = p.debt;
    this.topUp(p, paid);
    p.chips -= paid;
    this.state.pot += paid;
    p.debt = 0;
    return paid;
  }

  private dealHand(dealer: Player) {
    const s = this.state;
    const eligible = s.players.filter(p => this.isEligible(p));
    if (eligible.length < 2 || !eligible.includes(dealer)) {
      s.phase = 'WAITING';
      this.noTurn();
      this.log('Not enough players to deal.');
      return;
    }

    this.deck.reset();
    s.roundId++;
    s.result = null;
    s.gameWinner = null;
    s.talon = [];
    s.minScoreToBeat = 0;
    s.swappedPlayers = [];
    s.dealerIndex = dealer.seatIndex;

    for (const p of s.players) {
      p.bet = 0;
      p.handBets = 0;
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

      this.topUp(p, ANTE);
      p.chips -= ANTE;
      s.pot += ANTE;

      const c1 = this.deck.draw();
      const c2 = this.deck.draw();
      if (c1 && c2) p.hand.push(c1, c2);
      p.score = HandEvaluator.evaluate(p.hand).score;
    }

    this.log(`New hand — ${dealer.name} is the banker. Everyone antes ${euro(ANTE)}.`);
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

    // Only the first player (left of the banker) and the last one (right of the banker)
    // may raise; the players in between call or fold, and the banker always calls.
    const order: Player[] = [];
    for (let i = 1; i < SEATS; i++) {
      const p = this.playerAt((s.dealerIndex + i) % SEATS);
      if (p && !p.isFolded) order.push(p);
    }
    s.raiserSeats = order.length ? [...new Set([order[0].seatIndex, order[order.length - 1].seatIndex])] : [];
    s.raisesThisRound = 0;
    s.lastRaiserId = null;

    this.promptNextBettor(s.dealerIndex);
  }

  // Debt from a carried-over pot is settled at your first decision of the hand.
  private debtDue(p: Player) {
    return this.state.phase === 'BETTING_1' && p.debt > 0 && !p.isFolded && p.seatIndex !== this.state.dealerIndex;
  }

  private canRaise(p: Player) {
    const s = this.state;
    return p.seatIndex !== s.dealerIndex && s.raiserSeats.includes(p.seatIndex)
      && s.raisesThisRound < MAX_RAISES && s.lastRaiserId !== p.id;
  }

  // A player still owes a decision if they haven't acted since the last raise or
  // haven't matched the current bet. Nobody is ever all-in: short stacks top up.
  private needsToAct(p: Player) {
    return !p.isFolded && (!p.hasActed || p.bet < this.state.currentBet);
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

    if (next.seatIndex === s.dealerIndex) {
      // The banker always calls, after a short pause so everyone sees it happen.
      s.turnNonce++;
      s.turnDeadline = 0;
      s.turnDuration = 0;
      const nonce = s.turnNonce;
      this.setFlowTimer(() => {
        if (s.turnNonce !== nonce) return;
        this.applyCall(next, { banker: true });
      }, this.timings.blindCall);
      return;
    }

    this.armTurnTimer(next);
  }

  // Fewer than two players left in the hand during a betting round.
  private resolveShortHanded() {
    const s = this.state;
    const active = this.activePlayers();
    if (active.length === 0) {
      this.endGame();
      return;
    }
    const survivor = active[0];
    // A survivor who still owes a debt has to pay it (or fold) to see the third card.
    if (this.debtDue(survivor) && this.needsToAct(survivor)) {
      this.armTurnTimer(survivor);
      return;
    }
    // Everyone else folded: the survivor still has to prove a Flush or Trojica — with
    // the third card, or at the talon — otherwise the pot stays.
    if (s.phase === 'BETTING_2' && (survivor.score ?? 0) > 0) {
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
    if (player.seatIndex === s.dealerIndex) return; // the banker calls automatically

    const due = this.debtDue(player) ? player.debt : 0;

    if (rawAction === 'FOLD') {
      this.fold(player, due ? `folded (still owes ${euro(due)})` : 'folded');
      return;
    }

    if (rawAction === 'CALL') {
      this.topUp(player, due + (s.currentBet - player.bet));
      const paidDebt = due ? this.payDebt(player) : 0;
      this.applyCall(player, { paidDebt });
      return;
    }

    if (rawAction === 'RAISE') {
      const step = Number(rawAmount);
      if (!RAISE_STEPS.includes(step)) return;
      if (!this.canRaise(player)) {
        return this.error(socket, 'Only the first and last player may raise — one raise and one re-raise per round.');
      }
      const raiseTo = s.currentBet + step;
      const cost = raiseTo - player.bet;
      this.topUp(player, cost + due);

      const paidDebt = due ? this.payDebt(player) : 0;
      player.chips -= cost;
      player.bet = raiseTo;
      player.handBets += cost;
      s.pot += cost;
      s.currentBet = raiseTo;
      s.raisesThisRound++;
      s.lastRaiserId = player.id;
      player.hasActed = true;
      player.lastAction = `Raise ${euro(raiseTo)}`;
      // Everyone else has to respond to the raise.
      for (const p of s.players) if (p !== player && !p.isFolded) p.hasActed = false;
      const verb = s.raisesThisRound > 1 ? 're-raised' : 'raised';
      this.log(`${player.name} ${verb} to ${euro(raiseTo)}${paidDebt ? ` (+ ${euro(paidDebt)} owed)` : ''}.`);
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

  private applyCall(player: Player, opts: { banker?: boolean; timedOut?: boolean; paidDebt?: number } = {}) {
    const s = this.state;
    const owed = s.currentBet - player.bet;
    this.topUp(player, owed); // the banker (or anyone short) takes it from the wallet
    const pay = owed;
    player.chips -= pay;
    player.bet += pay;
    player.handBets += pay;
    s.pot += pay;
    player.hasActed = true;

    player.lastAction = owed === 0 ? 'Check' : `Call ${euro(pay)}`;

    const who = opts.banker ? `${player.name} (banker)` : player.name;
    const prefix = opts.timedOut ? `${player.name} ran out of time — ` : `${who} `;
    const verb = owed === 0 ? 'checks' : `calls ${euro(pay)}`;
    const debt = opts.paidDebt ? ` and pays ${euro(opts.paidDebt)} owed` : '';
    this.log(`${prefix}${verb}${debt}.`);
    this.promptNextBettor(player.seatIndex);
  }

  private handleBankerLook(player: Player | undefined) {
    const s = this.state;
    if (!player || player.seatIndex !== s.dealerIndex) return;
    if (s.phase !== 'BETTING_1' && s.phase !== 'BETTING_2') return;
    if (player.hasLooked || player.isFolded) return;

    // The banker peeks: they see their hand but still call everything, and they
    // forfeit the privilege of taking a strong talon.
    player.hasLooked = true;
    this.log(`${player.name} (banker) looked at their cards — talon privilege forfeited.`);
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

    // Turn order (closest to the banker's left first): decides "the first Špic".
    const dealerSeat = s.dealerIndex;
    activePlayers.sort((a, b) => {
      const distA = (a.seatIndex - (dealerSeat + 1) + SEATS) % SEATS;
      const distB = (b.seatIndex - (dealerSeat + 1) + SEATS) % SEATS;
      return distA - distB;
    });

    if (activePlayers.length === 0) {
      // Everyone folded (Bicykels) -> nobody wins.
      voidReason = 'Nobody is left in the hand';
    } else if (activePlayers.length === 1) {
      // One survivor must hold a Flush/Trojica to take the pot.
      const survivor = activePlayers[0];
      const res = HandEvaluator.evaluate(survivor.hand);
      if (res.score > 0) {
        winners = [survivor];
        byFold = true;
      } else {
        voidReason = `${survivor.name} has no Flush or Trojica`;
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
          winners.push(p);
        }
      }
      // Two Špics are a tie — except right after a Špic tie, when the first Špic wins.
      if (winners.length > 1 && bestScore === 31 && s.spicTie) winners = [winners[0]];
    }

    // --- ESCALATION RULE (progressive pot) ---
    // After a tie, the next winner must beat the tied score (after a Špic tie, a Špic is enough).
    let thresholdMiss: { name: string; score: number } | null = null;
    if (winners.length === 1 && s.potThreshold > 0) {
      const winnerScore = HandEvaluator.evaluate(winners[0].hand).score;
      const qualifies = winnerScore > s.potThreshold || (s.spicTie && winnerScore === 31);
      if (!qualifies) {
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
      s.spicTie = false;
      s.carryTotal = 0;
      // A won pot wipes every debt and brings benched players back.
      for (const p of s.players) {
        p.debt = 0;
        p.benched = false;
      }
      this.log(`${winner.name} wins ${euro(pot)}${byFold ? ' — everyone else folded' : ` with ${desc}`}.`);
      result = {
        winnerIds: [winner.id],
        amount: pot,
        headline: `${winner.name} wins ${euro(pot)}`,
        detail: byFold ? 'Everyone else folded' : desc,
      };
    } else {
      // Tie or void: the pot stays for the next round.
      if (winners.length > 1) {
        const tiedScore = HandEvaluator.evaluate(winners[0].hand).score;
        s.potThreshold = Math.max(s.potThreshold, tiedScore);
        if (tiedScore === 31) s.spicTie = true;
      }
      this.chargeOutsiders(activePlayers);

      const nextRule = s.spicTie ? ' The first Špic takes it.' : s.potThreshold > 0 ? ` Next winner needs more than ${s.potThreshold}.` : '';
      this.log(`${winners.length > 1 ? 'Tie' : 'No winner'} — the ${euro(pot)} pot stays.${nextRule}`);

      const needs = s.spicTie ? 'the first Špic takes it' : `next winner must beat ${s.potThreshold}`;
      let detail: string;
      if (thresholdMiss) {
        detail = `${thresholdMiss.name} had ${thresholdMiss.score} but needed more than ${s.potThreshold}`;
      } else {
        const why = winners.length > 1
          ? `${winners.map(w => w.name).join(' & ')} tied on ${HandEvaluator.evaluate(winners[0].hand).description}`
          : voidReason || 'Nobody qualified';
        detail = s.potThreshold > 0 ? `${why} · ${needs}` : why;
      }
      result = {
        winnerIds: [],
        amount: pot,
        headline: winners.length > 1 ? `Tie — ${euro(pot)} stays` : `Pot of ${euro(pot)} stays`,
        detail,
      };
    }
    s.result = result;

    this.setFlowTimer(() => this.resetToWaiting(), this.timings.showdown);
  }

  // The pot stays: everyone who didn't play this hand to the end owes what the
  // finishers paid (beyond the ante), minus what they already put in themselves.
  private chargeOutsiders(finishers: Player[]) {
    const s = this.state;
    const full = finishers.reduce((max, p) => Math.max(max, p.handBets), 0);
    if (full === 0) return;
    s.carryTotal += full;
    const owing: string[] = [];
    for (const p of s.players) {
      if (finishers.includes(p)) continue;
      const add = Math.max(0, full - p.handBets);
      if (add === 0) continue;
      p.debt += add;
      owing.push(`${p.name} ${euro(p.debt)}`);
    }
    if (owing.length) this.log(`To play on for this pot: ${owing.join(', ')}.`);
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
      p.handBets = 0;
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

    if (s.phase === 'DEALER_CHOICE') {
      this.skipDeal(player, 'ran out of time — skips dealing');
    } else if (s.phase === 'BETTING_1' || s.phase === 'BETTING_2') {
      const owed = s.currentBet - player.bet;
      // Never spend money automatically: a free check is fine, anything else folds.
      if (player.seatIndex === s.dealerIndex) this.applyCall(player, { banker: true, timedOut: true });
      else if (owed === 0 && !this.debtDue(player)) this.applyCall(player, { timedOut: true });
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
    const betting = s.phase === 'BETTING_1' || s.phase === 'BETTING_2';
    const canRaise = !!viewer && betting && s.turnIndex === viewer.seatIndex && this.canRaise(viewer);

    return {
      ...s,
      players,
      you: viewerId ?? null,
      serverNow: Date.now(),
      swapOptions,
      canRaise,
      config: {
        ante: ANTE,
        raiseSteps: RAISE_STEPS,
        maxRaises: MAX_RAISES,
        minBuyIn: MIN_BUY_IN,
        maxBuyIn: MAX_BUY_IN,
        defaultBuyIn: DEFAULT_BUY_IN,
        seats: SEATS,
      },
    };
  }
}
