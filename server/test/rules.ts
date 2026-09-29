// Deterministic rule tests: stacked decks and scripted players for the pub rules.
//
//   npm test            (from server/)
import { Bot, FAST, Harness, check, failureCount, presetBanker, seatBots, sleep, stackDeck, startServer, unstackDeck, waitFor } from './harness';

const SLOW_TURNS = { ...FAST, turn: 5000, offlineTurn: 5000 };
const BUY_IN = 2000; // €20

const player = (h: Harness, seat: number) => h.state().players.find(p => p.seatIndex === seat)!;

// Wait until `seat` has a real decision, then send the action and wait for the game to move on.
async function act(h: Harness, bot: Bot, seat: number, event: string, ...args: unknown[]) {
  const ok = await waitFor(() => h.state().turnIndex === seat && h.state().turnDeadline > 0, 1500, `turn of seat ${seat} for ${event} ${args.join(' ')}`);
  if (!ok) return;
  const nonce = h.state().turnNonce;
  bot.emit(event, ...args);
  await waitFor(() => h.state().turnNonce !== nonce || h.state().phase === 'SHOWDOWN', 1000, `${bot.name} ${event} ${args.join(' ')} accepted`);
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
  await act(h, b, 1, 'passTurn');
  await act(h, bots[0], 0, 'passTurn');
  await showdown(h);
}

async function tieChargesOutsiders() {
  console.log('• a tie at 29 keeps the pot and charges the players who did not finish');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false, BUY_IN);
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
  e.emit('joinGame', 'Eva', 4, BUY_IN);
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
  const bots = await seatBots(h, 4, false, BUY_IN);
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
  const bots = await seatBots(h, 3, false, BUY_IN);
  const [a, b, c] = bots;

  await deal(h, bots, 0, [
    'HA', 'HK', /* A */ 'SA', 'SK', /* B */ 'D7', 'C8', /* C */
    'H10', 'S10', 'S9', // A Špic, B Špic, C Bicykel (auto-fold)
    'D8', 'C9', 'H7', 'DQ',
  ]);
  await act(h, b, 1, 'playerAction', 'CALL');
  await act(h, c, 2, 'playerAction', 'CALL');
  await act(h, b, 1, 'playerAction', 'CALL');
  await act(h, b, 1, 'passTurn');
  await act(h, a, 0, 'passTurn');
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
  await act(h, c, 2, 'passTurn');
  await act(h, a, 0, 'passTurn');
  await act(h, b, 1, 'passTurn');
  await showdown(h);
  s = h.state();
  check(s.gameWinner === player(h, 0).id, 'A (first Špic after the banker) wins');
  check(player(h, 0).chips === BUY_IN - 100 + pot + 150, `A collects the whole carried pot (chips ${player(h, 0).chips})`);
  check(!s.spicTie && s.potThreshold === 0 && s.pot === 0, 'the carry-over is reset');

  bots.forEach(x => x.disconnect());
  await h.close();
}

// Four players, A banker. Only B (first) and D (last) may raise: one raise + one re-raise per round.
async function raiseRules() {
  console.log('• only the first and last player raise, one raise and one re-raise per round');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 4, false, BUY_IN);
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
  const bots = await seatBots(h, 3, false, BUY_IN);
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
    check(s.gameWinner === banker.id && banker.chips === BUY_IN + 100, 'the banker wins with the flush');
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
  const bots = await seatBots(h, 4, false, BUY_IN);
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
  await act(h, a, 0, 'passTurn');
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

// A banker with €1 left keeps calling raises: the missing money comes from their wallet.
async function bankerTopsUp() {
  console.log('• a banker who runs out of chips tops up from the wallet and keeps calling');
  const h = await startServer(SLOW_TURNS);
  const bots = await seatBots(h, 3, false, 500); // €5 each
  const [a, b, c] = bots;
  await deal(h, bots, 0, ['H7', 'H8', 'S7', 'S8', 'D7', 'D8', 'H9', 'S9', 'D9', 'HA', 'SA', 'DK', 'CK']);
  // The banker has just €1 left (move €3.50 of their chips into the pot to keep the books balanced).
  player(h, 0).chips -= 350;
  h.state().pot += 350;
  await act(h, b, 1, 'playerAction', 'RAISE', 200);
  await act(h, c, 2, 'playerAction', 'RAISE', 200);
  await act(h, b, 1, 'playerAction', 'CALL');
  await waitFor(() => h.state().phase === 'BETTING_2', 1000, 'second round');
  const banker = player(h, 0);
  check(banker.bet === 0 && banker.handBets === 400, `the banker paid the full €4 (paid ${banker.handBets})`);
  check(banker.chips === 0 && banker.bought === 500 + 300, `€3 came from the wallet (bought ${banker.bought})`);
  check(!banker.isFolded, 'the banker is still in the hand');

  // A normal player short of chips can top up and call too.
  const zuzka = player(h, 2);
  h.state().pot += zuzka.chips - 50; // Zuzka is down to €0.50
  zuzka.chips = 50;
  await act(h, b, 1, 'playerAction', 'RAISE', 200);
  await act(h, c, 2, 'playerAction', 'CALL');
  check(player(h, 2).chips === 0 && player(h, 2).handBets === 600, 'Zuzka topped up €1.50 and called €2');
  bots.forEach(x => x.disconnect());
  void a;
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
  await bankerTopsUp();

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
