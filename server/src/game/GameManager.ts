// server/src/game/GameManager.ts
import { Server, Socket } from 'socket.io';
import { GameState, INITIAL_STATE, Player } from './GameState';
import { Deck } from './deck';
import { HandEvaluator } from './HandEvaluator';

const TURN_MS = 15000; // ms a player has to act before an auto-action fires

export class GameManager {
  private state: GameState;
  private deck: Deck;
  private io: Server;
  private firstRound = true; // Random dealer on the very first round, then rotate
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(io: Server) {
    this.io = io;
    this.deck = new Deck();
    this.state = JSON.parse(JSON.stringify(INITIAL_STATE));
  }

  // --- TURN TIMER ---
  // Arm a 10s deadline for the current decision turn; auto-acts if the player stalls.
  private armTurnTimer() {
    this.clearTurnTimer();
    const seat = this.state.turnIndex;
    this.state.turnNonce++;               // client uses this to (re)start its countdown bar
    this.state.turnDeadline = Date.now() + TURN_MS;
    this.turnTimer = setTimeout(() => this.autoAct(seat), TURN_MS);
  }

  private clearTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.state.turnDeadline = 0;
  }

  private autoAct(seat: number) {
    const player = this.state.players.find(p => p.seatIndex === seat);
    if (!player || player.isFolded) return;
    if (this.state.turnIndex !== seat) return; // turn already moved on

    if (this.state.phase.startsWith('BETTING')) {
      const callAmount = this.state.currentBet - player.bet;
      if (player.seatIndex === this.state.dealerIndex || callAmount === 0) {
        // Banker can't fold, and a free check is never worse than folding.
        this.broadcast(`${player.name} timed out — ${callAmount === 0 ? 'check' : 'call'}.`);
        this.performCall(player);
      } else {
        this.broadcast(`${player.name} timed out — fold.`);
        player.isFolded = true;
        this.nextTurn();
      }
    } else if (this.state.phase === 'TALON_SWAP') {
      this.broadcast(`${player.name} timed out — pass.`);
      this.handlePass(player.id);
    } else if (this.state.phase === 'DEALER_SPECIAL') {
      this.broadcast(`${player.name} timed out — reveal hand.`);
      this.handleDealerSpecial(player.id, 'PASS');
    }
  }

  public handleConnection(socket: Socket) {
    socket.emit('gameState', this.sanitizeFor(socket.id));

    socket.on('joinGame', (name: string, seatIndex: number, buyIn?: number) => {
      this.addPlayer(socket.id, name, seatIndex, buyIn);
    });

    socket.on('leaveGame', () => {
      this.removePlayer(socket.id);
    });

    socket.on('startGame', () => {
      if (this.state.phase === 'WAITING') {
        this.startGame();
      }
    });

    socket.on('playerAction', (action: string, amount?: number) => {
      this.handlePlayerAction(socket.id, action, amount);
    });

    socket.on('swapCard', (handIndex: number, talonIndex: number) => {
      this.handleSwap(socket.id, handIndex, talonIndex);
    });

    socket.on('passTurn', () => {
      this.handlePass(socket.id);
    });

    socket.on('disconnect', () => {
      this.removePlayer(socket.id);
    });

    socket.on('dealerSpecial', (action: 'TAKE' | 'PASS') => {
      this.handleDealerSpecial(socket.id, action);
    });

    socket.on('bankerLook', () => {
      this.handleBankerLook(socket.id);
    });
  }

  private handleBankerLook(playerId: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seatIndex !== this.state.dealerIndex) return;
    if (!this.state.phase.startsWith('BETTING')) return;
    if (player.hasLooked || player.isFolded) return;

    // The Banker peeks: they now see their hand and must bet actively (no more blind
    // auto-call), but they forfeit the privilege of swapping their hand for the talon.
    player.hasLooked = true;
    this.broadcast(`${player.name} (Banker) looked at their cards — talon privilege forfeited.`);
  }

  // --- CORE ACTION LOGIC ---

  private handlePlayerAction(playerId: string, action: string, amount: number = 0) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seatIndex !== this.state.turnIndex) return;

    if (action === 'FOLD') {
      // Banker's Burden: the dealer can never fold, they must call.
      if (player.seatIndex === this.state.dealerIndex) {
        this.io.to(playerId).emit('actionError', "As the Banker you cannot fold — you must call.");
        return;
      }
      player.isFolded = true;
      this.broadcast(`${player.name} folded.`);
      this.nextTurn();
      return;
    }

    if (action === 'CALL') {
      this.performCall(player);
      return;
    }

    if (action === 'RAISE') {
      const raiseAmount = amount;
      const totalToPay = raiseAmount - player.bet;

      if (player.chips >= totalToPay && raiseAmount > this.state.currentBet) {
        player.chips -= totalToPay;
        player.bet = raiseAmount;
        this.state.pot += totalToPay;
        this.state.currentBet = raiseAmount;
        this.state.lastRaiserIndex = player.seatIndex;
        this.broadcast(`${player.name} raised to ${raiseAmount}.`);
        this.nextTurn();
      }
      return;
    }
  }

  private performCall(player: Player) {
      const callAmount = this.state.currentBet - player.bet;
      const actualPay = Math.min(player.chips, callAmount);

      player.chips -= actualPay;
      player.bet += actualPay;
      this.state.pot += actualPay;

      this.broadcast(`${player.name} called/checked.`);
      this.nextTurn();
  }

  private handleSwap(playerId: string, handIndex: number, talonIndex: number) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seatIndex !== this.state.turnIndex) return;
    if (this.state.swappedPlayers.includes(playerId)) return;

    const tempHand = [...player.hand];
    if (!this.state.talon[talonIndex]) return;

    // Simulate Swap
    tempHand[handIndex] = this.state.talon[talonIndex];
    const newResult = HandEvaluator.evaluate(tempHand);

    // Rule: a swap must produce a scoring hand that strictly beats the current best.
    // Equal scores are NOT allowed, and a non-scoring result (0) is never an improvement.
    if (newResult.score <= this.state.minScoreToBeat) {
      const need = this.state.minScoreToBeat > 0
        ? `beat ${this.state.minScoreToBeat}`
        : `make a Flush or Trojica`;
      this.io.to(playerId).emit('actionError',
        `Swap blocked: that hand scores ${newResult.score} — you must ${need}.`);
      return;
    }

    // Commit Swap
    const cardFromHand = player.hand[handIndex];
    player.hand[handIndex] = this.state.talon[talonIndex];
    this.state.talon[talonIndex] = cardFromHand;

    // Update Score and Bar
    const finalResult = HandEvaluator.evaluate(player.hand);
    if (finalResult.score > this.state.minScoreToBeat) {
        this.state.minScoreToBeat = finalResult.score;
    }

    // Update player score for UI bubble
    if (player.score !== undefined) player.score = finalResult.score;

    this.state.swappedPlayers.push(playerId);

    // 👇👇👇 AUTO-FOLD IS BACK 👇👇👇
    if (finalResult.type === 'BICYKEL') {
        player.isFolded = true;
        player.specialStatus = 'BICYKEL';
        this.broadcast(`${player.name} swapped into a Bicykel! Auto-folding.`);
    } else {
        player.specialStatus = undefined;
    }
    // 👆👆👆

    this.broadcast(`${player.name} swapped. Score: ${finalResult.score}`);
    this.nextTurn();
  }

  private handlePass(playerId: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seatIndex !== this.state.turnIndex) return;

    this.state.swappedPlayers.push(playerId);
    this.broadcast(`${player.name} passed.`);
    this.nextTurn();
  }

  // Can this player reach a hand that beats the current bar with a single swap?
  private canImproveViaSwap(player: Player): boolean {
    if (!this.state.talon.length) return false;
    for (let h = 0; h < player.hand.length; h++) {
      for (let t = 0; t < this.state.talon.length; t++) {
        const temp = [...player.hand];
        temp[h] = this.state.talon[t];
        if (HandEvaluator.evaluate(temp).score > this.state.minScoreToBeat) return true;
      }
    }
    return false;
  }

  // Called when the turn arrives at a player during TALON_SWAP.
  // If they have no way to end with a hand beating the bar, show them a short
  // "nothing to swap" notice and auto-pass to the next player.
  private beginSwapTurn() {
    const player = this.state.players.find(p => p.seatIndex === this.state.turnIndex);
    if (!player) return;

    const current = HandEvaluator.evaluate(player.hand).score;
    const stuck = current <= this.state.minScoreToBeat && !this.canImproveViaSwap(player);

    if (stuck) {
      this.io.to(player.id).emit('noSwap');
      this.broadcast(`${player.name} can't improve — passing.`);
      setTimeout(() => {
        if (this.state.phase === 'TALON_SWAP'
          && this.state.turnIndex === player.seatIndex
          && !this.state.swappedPlayers.includes(player.id)) {
          this.handlePass(player.id);
        }
      }, 1700);
    } else {
      this.armTurnTimer();
      this.broadcast(`Turn: Seat ${this.state.turnIndex + 1}`);
    }
  }

  private handleDealerSpecial(playerId: string, action: 'TAKE' | 'PASS') {
      const player = this.state.players.find(p => p.id === playerId);
      if (!player || player.seatIndex !== this.state.dealerIndex) return;
      if (this.state.phase !== 'DEALER_SPECIAL') return;

      if (action === 'TAKE') {
          const best = HandEvaluator.getBestSubset(this.state.talon);

          if (best) {
              const oldHand = [...player.hand];
              const newHand: any[] = [];

              best.indices.forEach((talonIdx, i) => {
                  newHand.push(this.state.talon[talonIdx]);
                  this.state.talon[talonIdx] = oldHand[i];
              });

              player.hand = newHand;
              this.state.minScoreToBeat = best.result.score; // Set Bar
              player.isFaceUp = true; // Reveal
              if (player.score !== undefined) player.score = best.result.score; // Update Bubble

              this.broadcast(`Dealer took the special hand from Table! (${best.result.description})`);

              this.state.swappedPlayers.push(player.id);
              this.revealDealerAndStartGame(true); // true = skip bicykel check (it's a good hand)
          }
      } else {
          this.broadcast("Dealer declined special option. Revealing hand...");
          this.revealDealerAndStartGame(false); // false = check for bicykel
      }
  }

  private revealDealerAndStartGame(skipBicykelCheck: boolean) {
      this.state.phase = 'TALON_SWAP';

      const dealer = this.state.players.find(p => p.seatIndex === this.state.dealerIndex);
      if (dealer && !skipBicykelCheck) {
          const res = HandEvaluator.evaluate(dealer.hand);
          // 👇👇👇 AUTO-FOLD DEALER IF BICYKEL 👇👇👇
          if (res.type === 'BICYKEL') {
              dealer.isFolded = true;
              dealer.specialStatus = 'BICYKEL';
              dealer.isFaceUp = true;
              this.broadcast("Dealer has Bicykel! Auto-folding.");
          }
          // 👆👆👆
      }

      // Folding the dealer (or earlier Bicykel folds) may have left nobody active.
      // Resolve the round now instead of stalling on a turn no one can take.
      if (this.getActivePlayerCount() === 0) {
          this.endGame();
          return;
      }

      const firstSeat = this.getNextActiveSeat(this.state.dealerIndex);
      this.state.turnIndex = firstSeat;
      this.beginSwapTurn();
  }

  private nextTurn() {

    const activeCount = this.getActivePlayerCount();

    if (activeCount < 2) {
      if (this.state.phase === 'TALON_SWAP') {
          // If we are already in Talon phase and played our swap, end it.
          this.endGame();
          return;
      }

      // If in Betting/Dealing, check survivor status
      const survivor = this.state.players.find(p => !p.isFolded);
      if (survivor && survivor.score && survivor.score > 0) {
          this.endGame(); // Win!
          return;
      }

      // Survivor has 0 points -> FORCE ADVANCE TO NEXT PHASE
      this.advancePhase();
      return;
    }

    let nextSeat = this.getNextActiveSeat(this.state.turnIndex);

    if (this.state.phase.startsWith('BETTING') && nextSeat === this.state.lastRaiserIndex) {
       this.advancePhase();
       return;
    }

    if (this.state.phase === 'TALON_SWAP') {
      const activePlayers = this.state.players.filter(p => !p.isFolded);
      const allActed = activePlayers.every(p => this.state.swappedPlayers.includes(p.id));
      if (allActed) {
        this.endGame();
        return;
      }
    }

    this.state.turnIndex = nextSeat;

    // Auto-Call for Dealer while still playing Blind.
    // If the Banker chose to look, they act manually instead (Call/Raise, never Fold).
    if (this.state.phase.startsWith('BETTING') && this.state.turnIndex === this.state.dealerIndex) {
        const dealer = this.state.players.find(p => p.seatIndex === this.state.dealerIndex);
        if (dealer && !dealer.isFolded && !dealer.hasLooked) {
             this.clearTurnTimer(); // blind dealer isn't on a decision clock
             this.broadcast("Dealer (Blind) Auto-Calls.");
             setTimeout(() => {
                 this.performCall(dealer);
             }, 1000);
             return;
        }
    }

    if (this.state.phase === 'TALON_SWAP') {
      this.beginSwapTurn(); // may auto-pass a player who can't improve
      return;
    }

    this.armTurnTimer();
    this.broadcast(`Turn: Seat ${nextSeat + 1}`);
  }

  private advancePhase() {
    if (this.state.phase === 'BETTING_1') {
      this.dealThirdCard();
    } else if (this.state.phase === 'BETTING_2') {
      this.startTalonPhase();
    }
  }

  private dealThirdCard() {
    this.state.phase = 'BETTING_2';

    this.state.players.forEach(p => {
      p.bet = 0;
      if (!p.isFolded) {
        const c3 = this.deck.draw();
        if (c3) p.hand.push(c3);

        // Update bubble score
        const res = HandEvaluator.evaluate(p.hand);
        p.score = res.score;

        // 👇👇👇 AUTO-FOLD PLAYER IF BICYKEL 👇👇👇
        if (p.seatIndex !== this.state.dealerIndex) {
            if (res.type === 'BICYKEL') {
                p.isFolded = true;
                p.specialStatus = 'BICYKEL';
                this.broadcast(`${p.name} has Bicykel! Auto-folding.`);
            } else {
                p.specialStatus = undefined;
            }
        }
        // 👆👆👆
      }
    });



    // 👇👇👇 NEW SURVIVOR LOGIC 👇👇👇
    const activeCount = this.getActivePlayerCount();

    if (activeCount < 2) {
       if (activeCount === 1) {
           // We have 1 Survivor. Check if they have a winning hand ALREADY.
           const survivor = this.state.players.find(p => !p.isFolded);

           if (survivor && survivor.score && survivor.score > 0) {
               // They already have a Flush/Triple -> They win immediately.
               this.endGame();
               return;
           }

           // If they have 0 points (Partial hand), they MUST play the Talon phase to prove it.
           // Fall through to normal game flow...
       } else {
           // 0 players left (Everyone has Bicykel) -> Tie immediately.
           this.endGame();
           return;
       }
    }
    // 👆👆👆 END NEW LOGIC 👆👆👆

    this.state.currentBet = 0;

    if (activeCount === 1) {
        this.broadcast("Opponent folded. Survivor enters Talon Phase to prove hand...");
        setTimeout(() => this.startTalonPhase(), 1000);
        return;
    }

    const firstPlayer = this.getNextActiveSeat(this.state.dealerIndex);
    this.state.turnIndex = firstPlayer;
    this.state.lastRaiserIndex = firstPlayer;

    if (this.state.turnIndex === this.state.dealerIndex) {
         setTimeout(() => this.nextTurn(), 500);
    } else {
         this.armTurnTimer();
    }
    this.broadcast("3rd Card Dealt! Second betting round begins.");
  }

  private startTalonPhase() {
    this.state.minScoreToBeat = 0;
    this.state.swappedPlayers = [];
    this.broadcast("Betting complete. Dealing Talon...");

    this.state.talon = [];
    for (let i = 0; i < 4; i++) {
      const c = this.deck.draw();
      if (c) this.state.talon.push(c);
    }


    const dealer = this.state.players.find(p => p.seatIndex === this.state.dealerIndex);
    const bestTalonHand = HandEvaluator.getBestSubset(this.state.talon);
    const isSpecial = bestTalonHand && (
        bestTalonHand.result.type === 'TROJICA' ||
        bestTalonHand.result.type === 'ZLATY_SPIC' ||
        bestTalonHand.result.isFlush
    );

    // The blind-risk privilege only survives if the Banker never looked at their hand.
    if (isSpecial && dealer && !dealer.isFolded && !dealer.hasLooked) {
        this.state.phase = 'DEALER_SPECIAL';
        this.state.turnIndex = this.state.dealerIndex;
        this.armTurnTimer();
        this.broadcast(`Dealer Option: Table has ${bestTalonHand?.result.description}!`);
    } else {
        this.revealDealerAndStartGame(false);
    }
  }

  private endGame() {
    this.clearTurnTimer();
    this.state.phase = 'SHOWDOWN';

    let winners: Player[] = [];
    let winnerName = "";

    const activePlayers = this.state.players.filter(p => !p.isFolded);

    // Sort by Turn Order (Closest to Dealer's Left) to resolve 31 vs 31 ties
    const dealerSeat = this.state.dealerIndex;
    activePlayers.sort((a, b) => {
        const distA = (a.seatIndex - (dealerSeat + 1) + 6) % 6;
        const distB = (b.seatIndex - (dealerSeat + 1) + 6) % 6;
        return distA - distB;
    });

    // CASE 1: Everyone Folded (Bicykels) -> TIE
    if (activePlayers.length === 0) {
        winners = [];
    }
    // CASE 2: One Survivor -> Must have Flush/Triple to win Pot
    else if (activePlayers.length === 1) {
       const survivor = activePlayers[0];
       const res = HandEvaluator.evaluate(survivor.hand);

       // "Partial" hands (Score 0) cannot take the pot.
       // HandEvaluator now ensures !isFlush means score=0.
       if (res.score > 0) {
           winners = [survivor];
           winnerName = `${survivor.name} (Opponent folded)`;
       } else {
           // Survivor has Partial Hand (2 suited). Tie.
           winners = [];
           this.broadcast(`Opponent folded, but ${survivor.name} has no Flush/Triple. Pot stays!`);
       }
    }
    // CASE 3: Showdown
    else {
       let bestScore = -1;
       let bestTieBreak = -1; // Trojica rank: KKK beats QQQ despite both being 30.5

       for (const p of activePlayers) {
           const result = HandEvaluator.evaluate(p.hand);
           // Bubble Update (just in case)
           p.score = result.score;
           const tieBreak = result.tieBreak ?? 0;

           if (result.score > bestScore || (result.score === bestScore && tieBreak > bestTieBreak)) {
               bestScore = result.score;
               bestTieBreak = tieBreak;
               winners = [p];
           } else if (result.score === bestScore && tieBreak === bestTieBreak) {
               // PRIORITY RULE FOR 31 (Špic): earliest in turn order wins
               if (bestScore === 31) {
                   console.log(`${p.name} has Špic (31) but was beaten by priority!`);
                   continue;
               }
               winners.push(p);
           }
       }
       winnerName = winners.length === 1 ? winners[0].name : "Tie";
    }

    // --- ESCALATION RULE (Progressive Pot) ---
    // After a tie, the next winner must EXCEED the tied score to take the pot.
    if (winners.length === 1 && this.state.potThreshold > 0) {
        const winnerScore = HandEvaluator.evaluate(winners[0].hand).score;
        if (winnerScore <= this.state.potThreshold) {
            this.broadcast(`${winners[0].name} won the round with ${winnerScore}, but needed more than ${this.state.potThreshold}. Pot stays!`);
            winners = [];
        }
    }

    // --- PAYOUT LOGIC ---
    if (winners.length === 1) {
      // SINGLE WINNER TAKES ALL
      const winner = winners[0];
      winner.chips += this.state.pot;
      this.state.gameWinner = winner.id;
      this.broadcast(`Game Over! Winner: ${winnerName} wins €${this.state.pot}`);

      this.state.pot = 0; // <--- RESET ONLY IF SOMEONE WON
      this.state.potThreshold = 0;
    } else {
      // TIE (Splitting or Keeping)
      // In Bar Spic, the pot stays for the next round
      if (winners.length > 1) {
          // The tied score becomes the bar to beat next round
          const tiedScore = HandEvaluator.evaluate(winners[0].hand).score;
          this.state.potThreshold = Math.max(this.state.potThreshold, tiedScore);
      }
      const thresholdMsg = this.state.potThreshold > 0 ? ` Next winner needs more than ${this.state.potThreshold}.` : '';
      this.broadcast(`Game Tie/Void! Pot of €${this.state.pot} stays for next round.${thresholdMsg}`);

      // DO NOT RESET this.state.pot = 0 here!
      // It will carry over to the next startGame()
    }

    // ... (Rotation and Reset Logic) ...

    setTimeout(() => {
        this.broadcast("Ready for next round.");
        this.state.phase = 'WAITING';
        this.state.gameWinner = null;
        this.state.talon = [];
        this.state.minScoreToBeat = 0;

        // Reset player states but KEEP chips and pot
        this.state.players.forEach(p => {
            p.hand = [];
            p.bet = 0;
            p.isFolded = false;
            p.specialStatus = undefined;
            p.isFaceUp = false;
            p.score = 0;
            p.hasLooked = false;
        });
        this.io.emit('gameState', this.state);
    }, 5000);
  }

  // --- HELPERS ---

  private getNextOccupiedSeat(currentSeat: number): number {
      let next = currentSeat;
      for (let i = 0; i < 6; i++) {
        next = (next + 1) % 6;
        if (this.state.players.find(p => p.seatIndex === next)) return next;
      }
      return currentSeat;
  }

  private getNextActiveSeat(currentSeat: number): number {
    let next = currentSeat;
    for (let i = 0; i < 6; i++) {
      next = (next + 1) % 6;
      const player = this.state.players.find(p => p.seatIndex === next);
      if (player && !player.isFolded) return next;
    }
    return currentSeat;
  }

  // server/src/game/GameManager.ts

  private addPlayer(id: string, name: string, seatIndex: number, buyIn?: number) {
    // 1. Check if seat is already taken
    if (this.state.players.find(p => p.seatIndex === seatIndex)) return;

    // Clamp the chosen buy-in to the allowed €5–€100 range (default 50).
    const chips = Math.max(5, Math.min(100, Math.round(buyIn ?? 50)));

    const inRound = this.state.phase !== 'WAITING' && this.state.phase !== 'SHOWDOWN';

    // 2. Check if THIS player is already sitting somewhere else
    const existingPlayer = this.state.players.find(p => p.id === id);

    if (existingPlayer) {
        // Moving seats mid-round would corrupt turn order
        if (inRound) return;
        const oldSeat = existingPlayer.seatIndex;
        existingPlayer.seatIndex = seatIndex;
        this.broadcast(`${existingPlayer.name} moved from Seat ${oldSeat + 1} to Seat ${seatIndex + 1}.`);
    } else {
        // NEW Player sitting down. If a round is in progress, they sit out (folded) until the next deal.
        const newPlayer: Player = {
            id,
            name,
            seatIndex,
            chips,
            hand: [],
            isFolded: inRound,
            bet: 0,
            score: 0
        };
        this.state.players.push(newPlayer);
        this.broadcast(`Player ${name} sat at seat ${seatIndex + 1} with €${chips}.${inRound ? ' (Waiting for next round)' : ''}`);
    }
  }
  private removePlayer(id: string) {
    const player = this.state.players.find(p => p.id === id);
    if (!player) return;

    const inRound = this.state.phase !== 'WAITING' && this.state.phase !== 'SHOWDOWN';
    const wasTheirTurn = this.state.turnIndex === player.seatIndex;
    const wasDealerSpecial = this.state.phase === 'DEALER_SPECIAL' && player.seatIndex === this.state.dealerIndex;

    if (inRound && !player.isFolded) {
        player.isFolded = true;
        this.broadcast(`${player.name} disconnected and folds.`);
    }

    this.state.players = this.state.players.filter(p => p.id !== id);
    this.broadcast(`${player.name} left the table.`);

    // Don't leave the game stuck waiting for someone who's gone
    if (inRound) {
        if (wasDealerSpecial) {
            this.revealDealerAndStartGame(false);
        } else if (wasTheirTurn) {
            this.nextTurn();
        }
    }
  }
  private getActivePlayerCount() {
    return this.state.players.filter(p => !p.isFolded).length;
  }
  private broadcast(logMessage?: string) {
    if (logMessage) {
      this.state.log.push(logMessage);
      if (this.state.log.length > 20) this.state.log.shift();
    }
    this.state.deckRemaining = this.deck.remaining;
    // Each client gets a view with opponents' hidden cards masked (prevents peeking via dev tools)
    for (const [id, socket] of this.io.sockets.sockets) {
      socket.emit('gameState', this.sanitizeFor(id));
    }
  }

  public sanitizeFor(viewerId: string): GameState {
    const showdown = this.state.phase === 'SHOWDOWN';
    return {
      ...this.state,
      players: this.state.players.map(p => {
        // Folded hands stay hidden even at showdown
        const visible = p.id === viewerId || p.isFaceUp || (showdown && !p.isFolded);
        if (visible) return p;
        return { ...p, hand: p.hand.map(() => ({ suit: 'X', rank: 'X', value: 0 } as any)), score: 0 };
      })
    };
  }

  private startGame() {
    if (this.state.players.length < 2) return;

    this.deck.reset();
    this.state.phase = 'BETTING_1';
    this.state.gameWinner = null;
    const ANTE = 5;

    // Banker rotates every round; random pick only on the very first round
    if (this.firstRound) {
        const activeSeats = this.state.players.map(p => p.seatIndex);
        this.state.dealerIndex = activeSeats[Math.floor(Math.random() * activeSeats.length)];
        this.firstRound = false;
    } else {
        this.state.dealerIndex = this.getNextOccupiedSeat(this.state.dealerIndex);
    }

    this.state.players.forEach(p => {
      const ante = Math.min(p.chips, ANTE); // Can't go negative
      p.chips -= ante;
      this.state.pot += ante;
      p.bet = 0;
      p.isFolded = false;
      p.specialStatus = undefined;
      p.hand = [];
      p.score = 0;
      p.isFaceUp = false;
      p.hasLooked = false;

      const c1 = this.deck.draw();
      const c2 = this.deck.draw();
      if (c1 && c2) p.hand.push(c1, c2);

      const res = HandEvaluator.evaluate(p.hand);
      p.score = res.score;
    });

    this.state.currentBet = 0;

    const firstPlayer = this.getNextActiveSeat(this.state.dealerIndex);
    this.state.turnIndex = firstPlayer;
    this.state.lastRaiserIndex = firstPlayer;

    if (this.state.turnIndex === this.state.dealerIndex) {
         setTimeout(() => this.nextTurn(), 500);
    } else {
         this.armTurnTimer();
    }
    this.broadcast(`Game Started! Dealer is Seat ${this.state.dealerIndex + 1}.`);
  }
}
