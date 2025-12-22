// server/src/game/GameManager.ts
import { Server, Socket } from 'socket.io';
import { GameState, INITIAL_STATE, Player } from './GameState';
import { Deck } from './deck'; 
import { HandEvaluator } from './HandEvaluator';

export class GameManager {
  private state: GameState;
  private deck: Deck;
  private io: Server;
  private updatePlayerScore(player: Player) {
      if (player.hand.length === 0) {
          player.score = 0;
          return;
      }
      const res = HandEvaluator.evaluate(player.hand);
      player.score = res.score;
  }

  constructor(io: Server) {
    this.io = io;
    this.deck = new Deck();
    this.state = JSON.parse(JSON.stringify(INITIAL_STATE));
  }

  public handleConnection(socket: Socket) {
    socket.emit('gameState', this.state);

    socket.on('joinGame', (name: string, seatIndex: number) => {
      this.addPlayer(socket.id, name, seatIndex);
    });

    socket.on('startGame', () => {
      // Only start if waiting
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
    // 👇👇👇 ADD THIS SECTION 👇👇👇
    socket.on('dealerSpecial', (action: 'TAKE' | 'PASS') => {
      this.handleDealerSpecial(socket.id, action);
    });
    // 👆👆👆 END OF ADDITION 👆👆👆
  }

  // --- CORE ACTION LOGIC ---

  private handlePlayerAction(playerId: string, action: string, amount: number = 0) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seatIndex !== this.state.turnIndex) return; 

    if (action === 'FOLD') {
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

  // Extracted logic so Auto-Call can use it
  private performCall(player: Player) {
      const callAmount = this.state.currentBet - player.bet;
      // Dealer might not have enough chips, but in this simplified version we assume they do or go all-in
      const actualPay = Math.min(player.chips, callAmount);
      
      player.chips -= actualPay;
      player.bet += actualPay;
      this.state.pot += actualPay;
      
      this.broadcast(`${player.name} called/checked.`);
      this.nextTurn();
  }

  // server/src/game/GameManager.ts

  private handleSwap(playerId: string, handIndex: number, talonIndex: number) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seatIndex !== this.state.turnIndex) return;
    if (this.state.swappedPlayers.includes(playerId)) return; 

    const tempHand = [...player.hand];
    if (!this.state.talon[talonIndex]) return;

    // Simulate Swap to see the potential result
    tempHand[handIndex] = this.state.talon[talonIndex];
    const newResult = HandEvaluator.evaluate(tempHand);

    // --- RULE LOGIC ---

    // CASE 1: FIRST ACTION (Opening the Round)
    // If minScoreToBeat is 0, no one has successfully played yet (Dealer passed or didn't set a bar).
    // The first player acts as the "Standard Setter". They can ONLY swap if they form a valid hand.
    if (this.state.minScoreToBeat === 0) {
        // A valid hand is either a Flush (3 cards of same suit) or a Triple (Trojica/Zlaty Spic)
        // Note: 'isFlush' is strictly true only if count is 3.
        const isValidHand = newResult.isFlush || newResult.type === 'TROJICA' || newResult.type === 'ZLATY_SPIC';
        
        if (!isValidHand) {
            console.log(`Swap rejected: First player must form Flush (min 24) or Triple. Got score ${newResult.score} (Not valid).`);
            return; 
        }
    } 
    // CASE 2: SUBSEQUENT ACTIONS (Defending)
    // The "Standard" is set. Player must match (Tie) or Beat the current high score.
    else {
        // We use < (strictly less) to REJECT.
        // This allows TIES (e.g. 24 vs 24) to be ACCEPTED.
        if (newResult.score < this.state.minScoreToBeat) {
            console.log(`Swap rejected. New: ${newResult.score} < To Beat: ${this.state.minScoreToBeat}`);
            return; 
        }
    }

    // --- COMMIT SWAP ---
    
    const cardFromHand = player.hand[handIndex];
    player.hand[handIndex] = this.state.talon[talonIndex];
    this.state.talon[talonIndex] = cardFromHand;

    // Recalculate definitive result
    const finalResult = HandEvaluator.evaluate(player.hand);

    // 👇👇👇 MAKE SURE THIS IS HERE 👇👇👇
    // This updates the player.score property so the bubble updates!
    this.updatePlayerScore(player);
    // 👆👆👆 THIS IS CRITICAL
    
    // Update the "Bar" only if we raised it. 
    // If we just tied it, the bar remains the same for the next person.
    if (finalResult.score > this.state.minScoreToBeat) {
        this.state.minScoreToBeat = finalResult.score;
    }
    
    this.state.swappedPlayers.push(playerId);
    
    // Auto-fold Check for Bicykel
    if (finalResult.type === 'BICYKEL') {
        player.isFolded = true;
        player.specialStatus = 'BICYKEL';
        this.broadcast(`${player.name} swapped into a Bicykel! Auto-folding.`);
    } else {
        player.specialStatus = undefined;
    }

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

  private handleDealerSpecial(playerId: string, action: 'TAKE' | 'PASS') {
      const player = this.state.players.find(p => p.id === playerId);
      if (!player || player.seatIndex !== this.state.dealerIndex) return;
      if (this.state.phase !== 'DEALER_SPECIAL') return;

      if (action === 'TAKE') {
          // Find the best 3 cards from Talon
          const best = HandEvaluator.getBestSubset(this.state.talon);
          
          if (best) {
              // 1. Swap dealer hand with these 3 cards
              // Old dealer hand goes to "discard" (or conceptually replaces the talon cards, but simpler to just overwrite)
              // To keep talon size 4, we put dealer's old hand into the slots we took from.
              
              const oldHand = [...player.hand]; // Dealer's old blind hand
              const newHand: any[] = [];
              
              // Move best talon cards to hand
              best.indices.forEach((talonIdx, i) => {
                  newHand.push(this.state.talon[talonIdx]);
                  // Put old hand card back into Talon (Swap)
                  this.state.talon[talonIdx] = oldHand[i]; 
              });
              
              player.hand = newHand;
              this.updatePlayerScore(player); 
              this.state.minScoreToBeat = best.result.score;
              player.isFaceUp = true;
              this.broadcast(`Dealer took the special hand from Table! (${best.result.description})`);
              
              // Dealer is now "happy" and played.
              // We reveal them (happens automatically in Talon phase visuals)
              // And move turn to next player.
              this.state.swappedPlayers.push(player.id); // Mark dealer as having acted
              this.revealDealerAndStartGame(true); // true = skip bicykel check (assuming taken hand is good)
          }
      } else {
          // Dealer Passes (Reveals own cards)
          this.broadcast("Dealer declined special option. Revealing hand...");
          this.revealDealerAndStartGame(false); // false = check for bicykel
      }
  }

  private revealDealerAndStartGame(skipBicykelCheck: boolean) {
      this.state.phase = 'TALON_SWAP';
      
      const dealer = this.state.players.find(p => p.seatIndex === this.state.dealerIndex);
      if (dealer && !skipBicykelCheck) {
          // Check if the blind hand was actually garbage
          const res = HandEvaluator.evaluate(dealer.hand);
          if (res.type === 'BICYKEL') {
              dealer.isFolded = true;
              dealer.specialStatus = 'BICYKEL';
              this.broadcast("Dealer revealed a Bicykel! Auto-folding.");
          }
      }

      // Start rotation from Left of Dealer
      const firstSeat = this.getNextActiveSeat(this.state.dealerIndex);
      this.state.turnIndex = firstSeat;
      this.broadcast(`Turn: Seat ${firstSeat + 1}`);
  }
  // --- TURN MANAGEMENT ---

  private nextTurn() {
    // 1. Check for Game Over (Last Man Standing)
    if (this.getActivePlayerCount() < 2) {
      this.endGame();
      return;
    }

    let nextSeat = this.getNextActiveSeat(this.state.turnIndex);

    // 2. Check for End of Betting Round
    if (this.state.phase.startsWith('BETTING') && nextSeat === this.state.lastRaiserIndex) {
       this.advancePhase();
       return;
    }

    // 3. Check for End of Talon Phase
    if (this.state.phase === 'TALON_SWAP') {
      const activePlayers = this.state.players.filter(p => !p.isFolded);
      const allActed = activePlayers.every(p => this.state.swappedPlayers.includes(p.id));
      if (allActed) {
        this.endGame();
        return;
      }
    }

    // 4. Update Turn
    this.state.turnIndex = nextSeat;
    
    // --- DEALER AUTO-CALL LOGIC ---
    // If it is now the Dealer's turn during Betting, they must CALL immediately.
    if (this.state.phase.startsWith('BETTING') && this.state.turnIndex === this.state.dealerIndex) {
        const dealer = this.state.players.find(p => p.seatIndex === this.state.dealerIndex);
        if (dealer && !dealer.isFolded) {
             this.broadcast("Dealer (Blind) Auto-Calls.");
             // Delay slightly for visual pacing
             setTimeout(() => {
                 this.performCall(dealer);
             }, 1000);
             return; 
        }
    }
    // -----------------------------

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
        this.updatePlayerScore(p);

        // BICYKEL CHECK (Except Dealer)
        // Dealer is blind, so we don't fold them yet
        if (p.seatIndex !== this.state.dealerIndex) {
            const result = HandEvaluator.evaluate(p.hand);
            if (result.type === 'BICYKEL') { 
                p.isFolded = true;
                p.specialStatus = 'BICYKEL';
                this.broadcast(`${p.name} has Bicykel! Auto-folding.`);
            } else {
                p.specialStatus = undefined;
            }
        }
      }
    });

    if (this.getActivePlayerCount() < 2) {
       this.endGame();
       return;
    }

    this.state.currentBet = 0;
    
    // Reset turn logic: Start left of Dealer
    const firstPlayer = this.getNextActiveSeat(this.state.dealerIndex);
    this.state.turnIndex = firstPlayer;
    this.state.lastRaiserIndex = firstPlayer; 
    // Note: If firstPlayer IS the dealer (e.g. 2 players), Auto-Call will trigger in nextTurn()

    this.broadcast("3rd Card Dealt! Second betting round begins.");
    
    // If the person who starts IS the dealer (only 2 players), trigger auto-call manually or ensure nextTurn handles it.
    // Ideally, we just call nextTurn-like check. 
    // For simplicity, let the client trigger or the loop handle it. 
    // Actually, we need to trigger the check if the FIRST player is the dealer.
    if (this.state.turnIndex === this.state.dealerIndex) {
         setTimeout(() => this.nextTurn(), 500); // Hack to trigger the auto-call check
    }
  }

  // ... inside GameManager class ...

  private startTalonPhase() {
    this.state.minScoreToBeat = 0;
    this.state.swappedPlayers = [];
    this.broadcast("Betting complete. Dealing Talon...");

    this.state.talon = [];
    for (let i = 0; i < 4; i++) {
      const c = this.deck.draw();
      if (c) this.state.talon.push(c);
    }

    // CHECK FOR DEALER SPECIAL OPTION
    // 1. Get best 3 cards
    const bestTalonHand = HandEvaluator.getBestSubset(this.state.talon);
    
    // 2. STRICT RULE: Only offer if it's a TROJICA (Triple) OR a FLUSH (3 same suits)
    // We ignore score. It must be a "Combo".
    // Note: ZLATY_SPIC is also good.
    const isSpecial = bestTalonHand && (
        bestTalonHand.result.type === 'TROJICA' || 
        bestTalonHand.result.type === 'ZLATY_SPIC' || 
        bestTalonHand.result.isFlush // <--- This ensures 3 cards of same suit
    );

    if (isSpecial) {
        this.state.phase = 'DEALER_SPECIAL';
        this.state.turnIndex = this.state.dealerIndex; 
        this.broadcast(`Dealer Option: Table has ${bestTalonHand?.result.description}! Pick or Reveal?`);
    } else {
        // No special combo, Dealer plays normally
        this.revealDealerAndStartGame(false);
    }
  }

  // ... rest of file ...

  private endGame() {
    this.state.phase = 'SHOWDOWN';
    
    let winners: Player[] = [];
    let winnerName = "";
    
    // 1. Get active players
    let activePlayers = this.state.players.filter(p => !p.isFolded);

    // 2. SORT BY TURN ORDER (Critical for "First Špic Wins" rule)
    // Order starts at Dealer + 1, and wraps around to Dealer (who is last).
    const dealerSeat = this.state.dealerIndex;
    activePlayers.sort((a, b) => {
        // Calculate distance from the "First Player" (Dealer + 1)
        const distA = (a.seatIndex - (dealerSeat + 1) + 6) % 6;
        const distB = (b.seatIndex - (dealerSeat + 1) + 6) % 6;
        return distA - distB; // Ascending distance = Turn Order
    });

    if (activePlayers.length === 0) {
        winners = []; // All folded -> Tie
    } 
    else if (activePlayers.length === 1) {
       // Survivor logic (Must have Flush/Triple to win pot)
       const survivor = activePlayers[0];
       const res = HandEvaluator.evaluate(survivor.hand);
       const hasValidHand = res.isFlush || res.type === 'TROJICA' || res.type === 'ZLATY_SPIC';

       if (hasValidHand) {
           winners = [survivor];
           winnerName = `${survivor.name} (Opponent folded)`;
       } else {
           winners = [];
           this.broadcast(`Opponent folded, but ${survivor.name} has no Flush/Triple. Pot stays!`);
       }
    } 
    else {
       // SHOWDOWN with multiple players
       let bestScore = -1;
       
       for (const p of activePlayers) {
           // Ensure score is fresh
           const result = HandEvaluator.evaluate(p.hand);
           p.score = result.score; // Force update score just in case

           if (result.score > bestScore) {
               // New High Score found
               bestScore = result.score;
               winners = [p];
           } else if (result.score === bestScore) {
               // TIE DETECTED - CHECK RULES
               
               // RULE: If Score is 31 (Špic), the FIRST player keeps the win.
               // Since we sorted by turn order, the person already in 'winners' is "First".
               // We DO NOT add the new player to winners.
               if (bestScore === 31) {
                   console.log(`${p.name} has Špic (31) but was beaten by priority!`);
                   continue; 
               }
               
               // Standard Tie (e.g., both have 24) -> Both are winners
               winners.push(p);
           }
       }
       
       winnerName = winners.length === 1 ? winners[0].name : "Tie";
    }

    // --- PAYOUT ---
    if (winners.length === 1) {
      const winner = winners[0];
      winner.chips += this.state.pot;
      this.state.gameWinner = winner.id;
      this.broadcast(`Game Over! Winner: ${winnerName}`);
      this.state.pot = 0; 
    } else {
      this.broadcast(`Game Tie! Score: ${activePlayers[0]?.score || 0}. Pot stays.`);
    }

    // --- RESET & ROTATE ---
    this.state.dealerIndex = this.getNextOccupiedSeat(this.state.dealerIndex);
    
    setTimeout(() => {
        this.broadcast("Ready for next round.");
        this.state.phase = 'WAITING';
        this.state.gameWinner = null;
        this.state.talon = [];
        this.state.minScoreToBeat = 0; // Reset the "Bar"
        this.state.players.forEach(p => {
            p.hand = [];
            p.bet = 0;
            p.isFolded = false;
            p.specialStatus = undefined;
            p.isFaceUp = false;
            p.score = 0;
        });
        this.io.emit('gameState', this.state);
    }, 5000);
  }

  private startGame() {
    if (this.state.players.length < 2) return; 

    this.deck.reset();
    this.state.phase = 'BETTING_1';
    this.state.pot = 0;
    this.state.gameWinner = null;
    const ANTE = 5; 

    // --- RANDOMIZE DEALER (If first game) ---
    // If dealerIndex is 0 and we haven't played yet, pick random.
    // Simple way: just random every start if you prefer, or just rotation.
    // Let's just pick random active player to start fresh sessions.
    if (this.state.log.length < 5) { // Heuristic for "First Game"
        const activeSeats = this.state.players.map(p => p.seatIndex);
        this.state.dealerIndex = activeSeats[Math.floor(Math.random() * activeSeats.length)];
    }
    // ----------------------------------------

    this.state.players.forEach(p => {
      p.chips -= ANTE;
      p.bet = 0;
      p.isFolded = false;
      p.specialStatus = undefined;
      p.hand = [];

      p.isFaceUp = false; // <--- NEW
      
      const c1 = this.deck.draw();
      const c2 = this.deck.draw();
      if (c1 && c2) p.hand.push(c1, c2);
      this.updatePlayerScore(p);
    });

    this.state.pot = ANTE * this.state.players.length;
    this.state.currentBet = 0;
    
    // Start Turn: Next person after Dealer
    const firstPlayer = this.getNextActiveSeat(this.state.dealerIndex);
    this.state.turnIndex = firstPlayer;
    this.state.lastRaiserIndex = firstPlayer;

    this.broadcast(`Game Started! Dealer is Seat ${this.state.dealerIndex}.`);
    
    // Special Check: If only 2 players, the "Next" player is NOT the dealer. 
    // But if logic fails, ensure we check for Auto-Call immediately if turn lands on dealer.
    if (this.state.turnIndex === this.state.dealerIndex) {
         setTimeout(() => this.nextTurn(), 500);
    }
  }

  // --- HELPERS ---
  
  // Gets next seat that has a player sitting in it (for dealer rotation)
  private getNextOccupiedSeat(currentSeat: number): number {
      let next = currentSeat;
      for (let i = 0; i < 6; i++) {
        next = (next + 1) % 6; 
        if (this.state.players.find(p => p.seatIndex === next)) return next;
      }
      return currentSeat;
  }

  // Gets next seat participating in the current hand (not folded)
  private getNextActiveSeat(currentSeat: number): number {
    let next = currentSeat;
    for (let i = 0; i < 6; i++) {
      next = (next + 1) % 6; 
      const player = this.state.players.find(p => p.seatIndex === next);
      if (player && !player.isFolded) return next;
    }
    return currentSeat;
  }

  // ... (rest of helpers: addPlayer, removePlayer, getActivePlayerCount, broadcast are same)
  private addPlayer(id: string, name: string, seatIndex: number) {
    if (this.state.players.find(p => p.seatIndex === seatIndex)) return;
    const newPlayer: Player = { id, name, seatIndex, chips: 100, hand: [], isFolded: false, bet: 0 };
    this.state.players.push(newPlayer);
    this.broadcast(`Player ${name} sat at seat ${seatIndex + 1}.`);
  }
  private removePlayer(id: string) {
    const player = this.state.players.find(p => p.id === id);
    if (player) {
      this.state.players = this.state.players.filter(p => p.id !== id);
      this.broadcast(`${player.name} left the table.`);
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
    this.io.emit('gameState', this.state);
  }
}