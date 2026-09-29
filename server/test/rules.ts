// Deterministic rule tests: stacked decks and scripted players for the pub rules.
//
//   npm test            (from server/)
import { Bot, FAST, Harness, check, failureCount, presetBanker, seatBots, sleep, stackDeck, startServer, unstackDeck, waitFor } from './harness';

const SLOW_TURNS = { ...FAST, turn: 5000, offlineTurn: 5000 };

const player = (h: Harness, seat: number) => h.state().players.find(p => p.seatIndex === seat)!;

// Wait until `seat` has a real decision, then send the action and wait for the game to move on.
async function act(h: Harness, bot: Bot, seat: number, event: string, ...args: unknown[]) {
  const ok = await waitFor(() => h.state().turnIndex === seat && h.state().turnDeadline > 0, 1500, `turn of seat ${seat} for ${event} ${args.join(' ')}`);
  if (!ok) return;
  const nonce = h.state().turnNonce;
  bot.emit(event, ...args);
  await waitFor(() => h.state().turnNonce !== nonce || h.state().phase === 'SHOWDOWN', 1000, `${bot.name} ${event} ${args.join(' ')} accepted`);
}

// Keep your hand in the talon round. Players whose hand can't count (no swap reaches the bar
// or could win a carried pot) are passed automatically, so only pass if actually asked.
async function pass(h: Harness, bot: Bot, seat: number) {
  const id = player(h, seat).id;
  await waitFor(() => h.state().swappedPlayers.includes(id) || h.state().phase === 'SHOWDOWN'
    || (h.state().turnIndex === seat && h.state().turnDeadline > 0), 3000, `seat ${seat} keeps their hand`);
  if (h.state().turnIndex === seat && h.state().turnDeadline > 0) await act(h, bot, seat, 'passTurn');
}

// Send an action that must be refused: nothing may change.
async function refused(h: Harness, bot: Bot, what: string, event: string, ...args: unknown[]) {
  const s = h.state();
  const before = { nonce: s.turnNonce, pot: s.pot, bet: s.currentBet };
  bot.emit(event, ...args);
  await sleep(40);
  const after = h.state();
  check(after.turnNonce === before.nonce && after.pot === before.pot && after.currentBet === before.bet, `refused: ${what}`);
}

async function deal(h: Harness, bots: Bot[], bankerSeat: number, deck?: string[]) {
  if (deck) stackDeck(h, deck);
  else unstackDeck(h);
  await waitFor(() => h.state().phase === 'WAITING', 1000, 'table ready to deal');
  presetBanker(h, bankerSeat);
  bots[0].emit('startGame');
  await waitFor(() => h.state().phase !== 'WAITING', 500, 'deal');
}

async function showdown(h: Harness) {
  await waitFor(() => h.state().phase === 'SHOWDOWN', 2000, 'showdown');
}

// Four players (A banker at seat 0, B first, C middle, D last). The hand ties at 29 between
// A and B. C called €1 then folded; D folded straight away.
const TIE_AT_29 = [
  'HA', 'H8', /* A */ 'SK', 'S10', /* B */ 'D7', 'D8', /* C */ 'C7', 'S7', /* D */
  'H10', 'S9', 'D9', // third cards: A 29, B 29, C 24 (D has folded)
  'C9', 'S8', 'D10', 'CA', // talon: no flush, no trojica
];

async function playTieAt29(h: Harness, bots: Bot[]) {
  const [, b, c, d] = bots;
  await deal(h, bots, 0, TIE_AT_29);
  await act(h, b, 1, 'playerAction', 'RAISE', 100);
  await act(h, c, 2, 'playerAction', 'CALL');
  await act(h, d, 3, 'playerAction', 'FOLD');
  await act(h, b, 1, 'playerAction', 'RAISE', 100); // round 2 (banker called automatically)
  await act(h, c, 2, 'playerAction', 'FOLD');
  await pass(h, b, 1);
  await pass(h, bots[0], 0);
  await showdown(h);
}

async function tieChargesOutsiders() {
  console.log('• a tie at 29 keeps the pot and charges the players who did not finish');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false);
  await playTieAt29(h, bots);

  const s = h.state();
  check(s.result && s.result.winnerIds.length === 0, 'the hand is a tie');
  check(s.potThreshold === 29 && !s.spicTie, `next winner must beat 29 (threshold ${s.potThreshold})`);
  check(s.pot === 700, `pot stays at €7 (4 antes + €5 bets), got ${s.pot}`);
  check(player(h, 0).debt === 0 && player(h, 1).debt === 0, 'the finishers owe nothing');
  check(player(h, 2).debt === 100, `C paid €1 of the €2, owes €1 (got ${player(h, 2).debt})`);
  check(player(h, 3).debt === 200, `D paid nothing, owes €2 (got ${player(h, 3).debt})`);
  check(s.carryTotal === 200, 'newcomers would owe €2');

  // A newcomer owes the full amount.
  const e = new Bot(h.url, 'Eva', false);
  await e.connect();
  e.emit('joinGame', 'Eva', 4);
  await waitFor(() => !!h.state().players.find(p => p.name === 'Eva'), 500, 'Eva seated');
  check(h.state().players.find(p => p.name === 'Eva')?.debt === 200, 'a newcomer owes €2');
  e.emit('leaveGame');
  await waitFor(() => !h.state().players.find(p => p.name === 'Eva'), 500, 'Eva left');

  // Next hand: B deals. C pays the debt at the first decision; D (a middle player) can't raise.
  await deal(h, bots, 1);
  check(h.state().phase === 'BETTING_1' && h.state().dealerIndex === 1, 'B deals without a choice (owes nothing)');
  const potAfterAntes = h.state().pot;
  await act(h, bots[2], 2, 'playerAction', 'CALL');
  check(player(h, 2).debt === 0 && h.state().pot === potAfterAntes + 100, 'C checks and pays the €1 owed into the pot');
  await waitFor(() => h.state().turnIndex === 3 && h.state().turnDeadline > 0, 1000, "D's turn");
  await refused(h, bots[3], 'a middle player cannot raise', 'playerAction', 'RAISE', 50);
  await act(h, bots[3], 3, 'playerAction', 'FOLD');
  check(player(h, 3).debt === 200, 'D folds without paying and still owes €2');

  bots.forEach(x => x.disconnect());
  e.disconnect();
  await h.close();
}

async function dealerWhoOwesChooses(choice: 'PAY' | 'SKIP') {
  console.log(`• the next banker owes money and chooses to ${choice === 'PAY' ? 'pay and deal' : 'skip until the pot is won'}`);
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false);
  await playTieAt29(h, bots);

  await deal(h, bots, 2); // C (owes €1) is next to deal
  await waitFor(() => h.state().phase === 'DEALER_CHOICE' && h.state().turnIndex === 2, 1000, 'C is offered the choice');
  await refused(h, bots[3], 'only the banker-to-be can choose', 'dealerChoice', 'PAY');
  const pot = h.state().pot;
  bots[2].emit('dealerChoice', choice);
  await waitFor(() => h.state().phase === 'BETTING_1', 1000, 'hand dealt');

  const s = h.state();
  const c = player(h, 2);
  if (choice === 'PAY') {
    check(s.dealerIndex === 2 && c.debt === 0, 'C paid and deals');
    check(s.pot === pot + 100 + 4 * 50, `the €1 debt and 4 antes went into the pot (pot ${s.pot})`);
  } else {
    check(c.benched && c.sittingOut && c.isFolded && c.hand.length === 0, 'C sits out');
    check(c.debt === 100, 'C still owes €1');
    check(s.dealerIndex === 0, 'the deal skipped D (who owes) and went to A, who owes nothing');
    check(s.pot === pot + 3 * 50, 'only the three players dealt in paid the ante');
  }
  bots.forEach(x => x.disconnect());
  await h.close();
}

// Three players, A banker at seat 0. Hand 1: A and B both make Špic -> a tie.
// Hand 2 (B banker): A and B make Špic again -> the first Špic after the banker (A) wins.
async function spicTieThenFirstSpicWins() {
  console.log('• two Špics tie; after that, the first Špic takes the pot');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 3, false);
  const [a, b, c] = bots;

  await deal(h, bots, 0, [
    'HA', 'HK', /* A */ 'SA', 'SK', /* B */ 'D7', 'C8', /* C */
    'H10', 'S10', 'S9', // A Špic, B Špic, C Bicykel (auto-fold)
    'D8', 'C9', 'H7', 'DQ',
  ]);
  await act(h, b, 1, 'playerAction', 'CALL');
  await act(h, c, 2, 'playerAction', 'CALL');
  await act(h, b, 1, 'playerAction', 'CALL');
  await pass(h, b, 1);
  await pass(h, a, 0);
  await showdown(h);
  let s = h.state();
  check(s.result?.winnerIds.length === 0 && s.spicTie && s.potThreshold === 31, 'two Špics in one hand are a tie');
  const pot = s.pot;

  await deal(h, bots, 1, [
    'DA', 'DK', /* A */ 'CA', 'CK', /* B */ 'H7', 'H8', /* C */
    'D10', 'C10', 'H9', // A Špic, B Špic, C flush 24
    'S7', 'S8', 'CQ', 'D9',
  ]);
  await act(h, c, 2, 'playerAction', 'CALL');
  await act(h, a, 0, 'playerAction', 'CALL');
  await act(h, c, 2, 'playerAction', 'CALL');
  await act(h, a, 0, 'playerAction', 'CALL');
  await pass(h, c, 2);
  await pass(h, a, 0);
  await pass(h, b, 1);
  await showdown(h);
  s = h.state();
  check(s.gameWinner === player(h, 0).id, 'A (first Špic after the banker) wins');
  check(player(h, 0).balance === -100 + pot + 150, `A collects the whole carried pot (score ${player(h, 0).balance})`);
  check(!s.spicTie && s.potThreshold === 0 && s.pot === 0, 'the carry-over is reset');

  bots.forEach(x => x.disconnect());
  await h.close();
}

// Four players, A banker. Only B (first) and D (last) may raise: one raise + one re-raise per round.
async function raiseRules() {
  console.log('• only the first and last player raise, one raise and one re-raise per round');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false);
  const [, b, c, d] = bots;
  await deal(h, bots, 0, [
    'H7', 'H8', 'S7', 'S8', 'D7', 'D8', 'C7', 'C8',
    'H9', 'S9', 'D9', 'C9',
    'HA', 'SA', 'DK', 'CK',
  ]);
  check(JSON.stringify(h.state().raiserSeats) === '[1,3]', `B and D may raise (${h.state().raiserSeats})`);

  // Round 1: B raises, D re-raises, then B can only call.
  await act(h, b, 1, 'playerAction', 'RAISE', 50);
  await waitFor(() => h.state().turnIndex === 2 && h.state().turnDeadline > 0, 1000, "C's turn");
  await refused(h, c, 'the middle player cannot raise', 'playerAction', 'RAISE', 50);
  await act(h, c, 2, 'playerAction', 'CALL');
  await act(h, d, 3, 'playerAction', 'RAISE', 100);
  check(h.state().currentBet === 150 && h.state().raisesThisRound === 2, 'D re-raised to €1.50');
  await waitFor(() => h.state().turnIndex === 1 && h.state().turnDeadline > 0, 1000, "B's turn after the re-raise");
  await refused(h, b, 'no second re-raise', 'playerAction', 'RAISE', 50);
  await act(h, b, 1, 'playerAction', 'CALL');
  await act(h, c, 2, 'playerAction', 'CALL');
  await waitFor(() => h.state().phase === 'BETTING_2', 1000, 'second betting round');
  check(h.state().pot === 4 * 50 + 4 * 150, `everyone paid €1.50 (pot ${h.state().pot})`);

  // Round 2: B checks, D raises, B re-raises, then D can only call.
  await act(h, b, 1, 'playerAction', 'CALL');
  await act(h, c, 2, 'playerAction', 'CALL');
  await act(h, d, 3, 'playerAction', 'RAISE', 50);
  await act(h, b, 1, 'playerAction', 'RAISE', 200);
  check(h.state().currentBet === 250, 'B re-raised to €2.50');
  await act(h, c, 2, 'playerAction', 'CALL');
  await waitFor(() => h.state().turnIndex === 3 && h.state().turnDeadline > 0, 1000, "D's turn after the re-raise");
  await refused(h, d, 'no second re-raise', 'playerAction', 'RAISE', 50);
  await act(h, d, 3, 'playerAction', 'CALL');
  await waitFor(() => h.state().phase === 'TALON_SWAP', 1000, 'talon');

  bots.forEach(x => x.disconnect());
  await h.close();
}

// Everyone else folds in round 1: the banker still has to prove a Flush or Trojica.
async function foldOutMustProve(withFlush: boolean) {
  console.log(`• everyone folds in round 1 — the banker ${withFlush ? 'makes a flush with the third card and wins' : 'has nothing, so the pot stays'}`);
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 3, false);
  await deal(h, bots, 0, withFlush
    ? ['H7', 'H8', 'C7', 'C8', 'D7', 'D8', 'H9', 'HA', 'SA', 'DK', 'CK']
    : ['H7', 'S8', 'C7', 'C8', 'D7', 'D8', 'D9', 'HA', 'SA', 'DK', 'CK']);
  await act(h, bots[1], 1, 'playerAction', 'FOLD');
  await act(h, bots[2], 2, 'playerAction', 'FOLD');
  await showdown(h);

  const s = h.state();
  const banker = player(h, 0);
  check(banker.hand.length === 3, 'the banker got a third card before anything was decided');
  if (withFlush) {
    check(s.gameWinner === banker.id && banker.balance === 100, 'the banker wins with the flush');
  } else {
    check(!s.gameWinner && s.pot === 150, 'no Flush/Trojica: the pot stays');
  }
  bots.forEach(x => x.disconnect());
  await h.close();
}

// After the tie at 29, the next winner needs more than 29: a lone 29 keeps the pot there, a 30 takes it.
async function mustBeatTiedScore(score: 29 | 30) {
  console.log(`• after a tie at 29, a winner with ${score} ${score === 29 ? 'does not get the pot' : 'takes the pot'}`);
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false);
  const [a, , c, d] = bots;
  await playTieAt29(h, bots);
  const carried = h.state().pot;

  // B banks and ends up with a Bicykel; C and D fold; A is left with 29 (or 30).
  await deal(h, bots, 1, [
    'HA', score === 29 ? 'H8' : 'H9', /* A */ 'S7', 'C8', /* B */ 'D7', 'D8', /* C */ 'C7', 'H7', /* D */
    'H10', 'D9',
    'S9', 'D10', 'CA', 'S10',
  ]);
  await act(h, c, 2, 'playerAction', 'FOLD');
  await act(h, d, 3, 'playerAction', 'FOLD');
  await act(h, a, 0, 'playerAction', 'CALL');
  await act(h, a, 0, 'playerAction', 'CALL');
  await pass(h, a, 0);
  await showdown(h);

  const s = h.state();
  if (score === 29) {
    check(!s.gameWinner && s.pot === carried + 4 * 50 && s.potThreshold === 29, 'a 29 does not beat the tied 29: the pot stays');
    check(player(h, 2).debt === 100 && player(h, 3).debt === 200, 'debts stay open while the pot is carried');
  } else {
    check(s.gameWinner === player(h, 0).id && s.pot === 0, 'a 30 beats the tied 29 and takes the pot');
    check(h.state().players.every(p => p.debt === 0), 'all debts are cleared');
  }
  bots.forEach(x => x.disconnect());
  await h.close();
}

// Matching the bar is allowed: it makes a tie and the pot stays (reported from a real game).
async function swapToTie() {
  console.log('• a swap that only matches the bar is allowed and makes a tie');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 3, false);
  const [, b, c] = bots;
  await deal(h, bots, 0, [
    'S8', 'S9', /* A (banker) */ 'C8', 'CJ', /* B */ 'D7', 'CA', /* C */
    'D10', 'H10', 'CQ', // third cards
    'H7', 'CK', 'C7', 'DA', // talon
  ]);
  for (let round = 0; round < 2; round++) {
    await act(h, b, 1, 'playerAction', 'CALL');
    await act(h, c, 2, 'playerAction', 'CALL');
  }
  await act(h, b, 1, 'swapCard', 2, 1); // H10 <-> CK: Flush 28, the bar
  await waitFor(() => h.state().turnIndex === 2 && h.state().turnDeadline > 0, 1000, "C's swap turn");
  await sleep(40);
  check(!!c.view?.swapOptions.some(o => o.h === 0 && o.t === 2 && o.score === 28), 'C is offered D7 <-> C7 for 28 (ties the bar)');
  await act(h, c, 2, 'swapCard', 0, 2);
  check(player(h, 2).score === 28, `C swapped to 28 (score ${player(h, 2).score})`);
  await showdown(h);
  const s = h.state();
  check(s.result?.winnerIds.length === 0 && s.pot > 0 && s.potThreshold === 28, `tie at 28: the pot stays (threshold ${s.potThreshold})`);
  bots.forEach(x => x.disconnect());
  await h.close();
}

// Two Trojicas never tie: 888 beats 777 although both score 30.5 (the bar and the showdown).
async function trojicaRanks() {
  console.log('• a lower Trojica never matches a higher one; a higher one beats it');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 3, false);
  const [a, b, c] = bots;
  await deal(h, bots, 0, [
    'C9', 'D9', /* A (banker) */ 'D8', 'C8', /* B */ 'H7', 'D7', /* C */
    'HA', 'SJ', 'SQ', // third cards
    'H8', 'C7', 'S9', 'DK', // talon
  ]);
  for (let round = 0; round < 2; round++) {
    await act(h, b, 1, 'playerAction', 'CALL');
    await act(h, c, 2, 'playerAction', 'CALL');
  }
  await act(h, b, 1, 'swapCard', 2, 0); // SJ <-> H8: Trojica 8 is the bar
  check(h.state().barHand?.k === 'trojica' && h.state().barHand?.v === '8', 'the bar is Trojica 8');
  // C could only make Trojica 7: not offered, and passed automatically.
  await waitFor(() => h.state().turnIndex === 0 && h.state().turnDeadline > 0, 2000, "the banker's swap turn");
  check(h.state().log.some(e => e.key === 'cantImprove' && e.p?.name === 'Bot2'), 'C (Trojica 7 at best) cannot swap against Trojica 8');
  check(!player(h, 2).hand.every(x => x.rank === '7'), 'C did not get a Trojica 7');
  // The banker can make Trojica 9, which beats Trojica 8.
  await sleep(40);
  check(!!a.view?.swapOptions.some(o => o.h === 2 && o.t === 2), 'the banker is offered HA <-> S9 for Trojica 9');
  await act(h, a, 0, 'swapCard', 2, 2);
  await showdown(h);
  const s = h.state();
  check(s.result?.winnerIds.length === 1 && s.gameWinner === player(h, 0).id, 'Trojica 9 beats Trojica 8 at the showdown (no tie)');
  bots.forEach(x => x.disconnect());
  await h.close();
}

// While a pot is carried, a swap (or the banker's talon option) must make a hand that can win
// it: after a tie at 29, a swap into Flush 25 would only take a card somebody else may need.
async function carriedPotSwaps() {
  console.log('• with a carried pot, only swaps that can win it are allowed');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false);
  const [a, b, c, d] = bots;
  await playTieAt29(h, bots);
  check(h.state().potThreshold === 29, 'the pot is carried, the next winner needs more than 29');

  // B banks. The talon holds S9 S10 SJ = Flush 29: not enough to win, so no banker's option.
  await deal(h, bots, 1, [
    'S7', 'S8', /* A */ 'DA', 'D9', /* B (banker) */ 'C7', 'H7', /* C */ 'C8', 'H8', /* D */
    'HQ', 'CK', // third cards (A, B)
    'S9', 'S10', 'SJ', 'D10', // talon
  ]);
  await act(h, c, 2, 'playerAction', 'FOLD');
  await act(h, d, 3, 'playerAction', 'FOLD');
  await act(h, a, 0, 'playerAction', 'CALL');
  await act(h, a, 0, 'playerAction', 'CALL');
  await waitFor(() => h.state().phase === 'TALON_SWAP' && h.state().turnIndex === 1 && h.state().turnDeadline > 0, 3000, "the banker's swap turn");
  const log = h.state().log;
  check(!log.some(e => e.key === 'bankerOption'), 'no banker option for a talon Flush 29 that cannot win the pot');
  // A could make Flush 25 with any spade, but that can't win: passed automatically.
  check(log.some(e => e.key === 'cantImprove' && e.p?.name === 'Bot0'), 'A cannot swap into Flush 25');
  check(!player(h, 0).hand.every(x => x.suit === 'S'), 'A kept their hand');
  // The banker can make Flush 30 (CK <-> D10), which wins.
  await sleep(40);
  const opts = b.view?.swapOptions ?? [];
  check(opts.length > 0 && opts.every(o => o.score > 29), `the banker is only offered winning swaps (${JSON.stringify(opts)})`);
  b.emit('swapCard', 2, 0); // CK <-> S9 would be no flush: refused
  await sleep(40);
  check(player(h, 1).hand[2].rank === 'K', 'a swap that cannot win is refused');
  await act(h, b, 1, 'swapCard', 2, 3);
  await showdown(h);
  check(h.state().gameWinner === player(h, 1).id && h.state().pot === 0, 'Flush 30 wins the carried pot');
  bots.forEach(x => x.disconnect());
  await h.close();
}

// While a pot is carried, a tie with the bar doesn't count: a swap has to beat it.
async function carriedPotNoTieSwaps() {
  console.log('• with a carried pot, a swap has to beat the bar, not just match it');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false);
  const [a, b, c, d] = bots;
  await playTieAt29(h, bots);
  await deal(h, bots, 1, [
    'DA', 'D9', /* A */ 'HA', 'H9', /* B (banker) */ 'C8', 'H7', /* C */ 'S7', 'H8', /* D */
    'CK', 'SK', // third cards (A, B)
    'D10', 'H10', 'C7', 'S8', // talon
  ]);
  await act(h, c, 2, 'playerAction', 'FOLD');
  await act(h, d, 3, 'playerAction', 'FOLD');
  await act(h, a, 0, 'playerAction', 'CALL');
  await act(h, a, 0, 'playerAction', 'CALL');
  await act(h, a, 0, 'swapCard', 2, 0); // CK <-> D10: Flush 30, the bar
  // The banker could only tie at 30 (SK <-> H10): not allowed, passed automatically.
  await showdown(h);
  check(h.state().log.some(e => e.key === 'cantImprove' && e.p?.name === 'Bot1'), 'the banker cannot swap to tie the bar at 30');
  check(!h.state().log.some(e => e.key === 'swapped' && e.p?.name === 'Bot1'), 'the banker did not swap');
  check(h.state().gameWinner === player(h, 0).id, 'A wins the carried pot with 30');
  void b;
  bots.forEach(x => x.disconnect());
  await h.close();
}

// Set everyone's score directly (seat -> [score before the pot, paid into the current pot]).
function setScores(h: Harness, scores: Record<number, [number, number]>) {
  let pot = 0;
  for (const [seat, [before, share]] of Object.entries(scores)) {
    const p = player(h, Number(seat));
    p.balance = before - share;
    p.potShare = share;
    pot += share;
  }
  h.state().pot = pot;
  (h.gm as any).scheduleEmit(); // refresh everyone's view
}

// Leaving for good: settle with the table, the others play on.
async function cashOut() {
  console.log('• a player who leaves settles with the table; money in a carried pot is lost');
  const h = await startServer(SLOW_TURNS);
  let bots = await seatBots(h, 3, false);
  const [a, b, c] = bots;
  const names = () => h.state().players.map(p => p.name).join(',');

  // No pot: C (−€3) pays A (+€5).
  setScores(h, { 0: [500, 0], 1: [-200, 0], 2: [-300, 0] });
  await sleep(40);
  const preview = c.view!.cashOut!;
  check(preview.payments.length === 1 && preview.payments[0].name === 'Bot0' && preview.payments[0].amount === 300 && preview.lost === 0,
    `preview: C pays A €3 (${JSON.stringify(preview)})`);
  c.emit('cashOut');
  await waitFor(() => !h.state().players.some(p => p.name === 'Bot2'), 500, 'C left');
  check(player(h, 0).balance === 200 && player(h, 1).balance === -200, 'A is now +€2, B still −€2');
  check(h.state().departed.length === 0, 'C is off the books');

  // A winner cashing out is paid by the biggest losers first.
  const d = new Bot(h.url, 'Bot3', false);
  const e = new Bot(h.url, 'Bot4', false);
  await d.connect();
  await e.connect();
  d.emit('joinGame', 'Bot3', 3);
  e.emit('joinGame', 'Bot4', 4);
  await waitFor(() => h.state().players.length === 4, 500, 'D and E seated');
  bots = [a, b, d, e];
  setScores(h, { 0: [900, 0], 1: [-200, 0], 3: [-500, 0], 4: [-200, 0] });
  a.emit('cashOut');
  await waitFor(() => !h.state().players.some(p => p.name === 'Bot0'), 500, 'A left');
  check(player(h, 3).balance === 0 && player(h, 1).balance === 0 && player(h, 4).balance === 0,
    `D, B and E paid A (scores ${h.state().players.map(p => p.balance).join(',')})`);
  check(h.state().hostId === player(h, 1).id, 'B is the host now');

  // A carried pot: E (−€3 before the pot, €1.50 in it) settles the €3 and hands the €1.50 to the host.
  setScores(h, { 1: [500, 100], 3: [-200, 100], 4: [-300, 150] });
  await sleep(40);
  const carried = e.view!.cashOut!;
  check(carried.lost === 150 && carried.holder === 'Bot1' && carried.payments.length === 1 && carried.payments[0].amount === 450,
    `preview: pays B €3 + €1.50 for the pot (${JSON.stringify(carried)})`);
  e.emit('cashOut');
  await waitFor(() => !h.state().players.some(p => p.name === 'Bot4'), 500, 'E left');
  const host = player(h, 1);
  check(h.state().pot === 350 && host.balance === 400 - 450 && host.potShare === 250,
    `the pot stays €3.50, B holds E's €1.50 (B ${host.balance}/${host.potShare})`);
  check(h.state().departed.length === 0, `still nobody unsettled (${names()})`);

  // Leaving without settling keeps the score on the list.
  d.emit('leaveGame');
  await waitFor(() => h.state().departed.length === 1, 500, 'D on the left list');
  check(h.state().departed[0].balance === -300, 'D is listed at −€3');

  [...bots, c].forEach(x => x.disconnect());
  await h.close();
}

async function hostSettings() {
  console.log('• only the host changes table settings, between hands, to the offered values');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 3, false);
  const [a, b, c] = bots;
  const s = () => h.state().settings;
  check(h.state().hostId === player(h, 0).id, 'the first player to sit down is the host');

  b.emit('updateSettings', { turnSeconds: 30, ante: 100, raiseSteps: [100, 200, 500] });
  await sleep(40);
  check(s().ante === 50 && s().turnSeconds === 15, 'a non-host cannot change settings');

  a.emit('updateSettings', { turnSeconds: 31, ante: 100, raiseSteps: [100, 200, 500] });
  a.emit('updateSettings', { turnSeconds: 30, ante: 70, raiseSteps: [100, 200, 500] });
  a.emit('updateSettings', { turnSeconds: 30, ante: 100, raiseSteps: [100, 200, 300] });
  await sleep(40);
  check(s().ante === 50 && s().turnSeconds === 15, 'values outside the offered options are refused');

  a.emit('updateSettings', { turnSeconds: 30, ante: 100, raiseSteps: [100, 200, 500] });
  await waitFor(() => s().ante === 100, 500, 'host settings applied');
  check(s().turnSeconds === 30 && s().raiseSteps.join() === '100,200,500', 'the host changed timer, ante and raises');

  await deal(h, bots, 0);
  check(h.state().pot === 300, `the next hand uses the new ante (pot ${h.state().pot})`);
  a.emit('updateSettings', { turnSeconds: 15, ante: 50, raiseSteps: [50, 100, 200] });
  await sleep(40);
  check(s().ante === 100, 'settings cannot change during a hand');
  await refused(h, b, 'a raise step from the old settings', 'playerAction', 'RAISE', 50);
  await act(h, b, 1, 'playerAction', 'RAISE', 500);
  check(h.state().currentBet === 500, 'a raise step from the new settings is accepted');

  a.emit('leaveGame');
  await waitFor(() => h.state().hostId === player(h, 1)?.id, 1000, 'host passes on');
  check(h.state().hostId === player(h, 1).id, 'when the host leaves, the longest-seated player takes over');
  bots.forEach(x => x.disconnect());
  void c;
  await h.close();
}

(async () => {
  const started = Date.now();
  await tieChargesOutsiders();
  await dealerWhoOwesChooses('PAY');
  await dealerWhoOwesChooses('SKIP');
  await spicTieThenFirstSpicWins();
  await raiseRules();
  await foldOutMustProve(false);
  await foldOutMustProve(true);
  await mustBeatTiedScore(29);
  await mustBeatTiedScore(30);
  await cashOut();
  await swapToTie();
  await trojicaRanks();
  await carriedPotSwaps();
  await carriedPotNoTieSwaps();
  await hostSettings();

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failureCount()) {
    console.error(`\n${failureCount()} rule check(s) failed (${secs}s).`);
    process.exit(1);
  }
  console.log(`\nAll rule checks passed (${secs}s).\n`);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
