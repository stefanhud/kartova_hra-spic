// Multi-player simulation test: real Socket.IO server + bot clients with fast timers.
//
//   npm test            (from server/)
//
// Bot tables of 2-6 players with random play, disconnects, cash-outs and late joins.
// The harness checks the game's invariants after every state change (see harness.ts).
import { Bot, FAST, check, failureCount, printCoverage, rand, seatBots, sleep, startServer, waitFor } from './harness';

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
  console.log('• a player reconnecting keeps seat, score and cards');
  const h = await startServer({ ...FAST, turn: 5000, reconnectGrace: 5000 });
  const bots = await seatBots(h, 3, false);
  bots[0].emit('startGame');
  await waitFor(() => h.state().phase === 'BETTING_1', 500, 'deal');

  const victim = bots.find(b => b.me()!.seatIndex !== h.state().dealerIndex)!;
  const before = h.state().players.find(p => p.name === victim.name)!;
  const snapshot = { id: before.id, seat: before.seatIndex, balance: before.balance, hand: JSON.stringify(before.hand) };
  victim.disconnect();
  await waitFor(() => h.state().players.find(p => p.id === snapshot.id)?.connected === false, 500, 'disconnect noticed');
  await victim.connect();
  await waitFor(() => victim.me()?.connected === true, 500, 'reconnected');

  const after = h.state().players.find(p => p.id === snapshot.id);
  check(after, 'player still seated after reconnect');
  check(after?.seatIndex === snapshot.seat && after?.balance === snapshot.balance, 'same seat and score');
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
  spy.emit('joinGame', 'Bad', 9, 2000);
  spy.emit('joinGame', 'Bad', -1, 2000);
  spy.emit('joinGame', 'Bad', 1.5, 2000);
  spy.emit('joinGame', '', 2, 2000);
  spy.emit('startGame'); // spectators can't deal
  await sleep(50);
  check(h.state().players.length === 0, 'invalid seats / empty names rejected');

  spy.emit('joinGame', 'x'.repeat(200), 2, 'lots');
  await waitFor(() => h.state().players.length === 1, 300, 'valid join');
  const p = h.state().players[0];
  check(p.name.length <= 16 && p.balance === 0, `name clamped, sits down at €0 (${p.name.length}, ${p.balance})`);

  const bots = await seatBots(h, 2, false);
  bots[0].emit('startGame');
  await waitFor(() => h.state().phase === 'BETTING_1', 500, 'deal');
  const s = h.state();
  const onTurn = [spy, ...bots].find(b => b.me()?.seatIndex === s.turnIndex)!;
  const potBefore = s.pot;
  onTurn.emit('passTurn');                 // not a betting action
  onTurn.emit('swapCard', 0, 0);           // no talon yet
  onTurn.emit('playerAction', 'RAISE', 300); // raise steps are €0.50 / €1 / €2
  onTurn.emit('playerAction', 'RAISE', -50);
  await sleep(50);
  check(h.state().turnNonce === s.turnNonce && h.state().pot === potBefore, 'out-of-phase / invalid actions ignored');

  // The banker can't act manually during their automatic call.
  const banker = [spy, ...bots].find(b => b.me()?.seatIndex === s.dealerIndex)!;
  for (let i = 0; i < 6 && h.state().phase === 'BETTING_1'; i++) {
    const st = h.state();
    if (st.turnIndex === st.dealerIndex) {
      const pot = st.pot;
      banker.emit('playerAction', 'CALL');
      banker.emit('playerAction', 'RAISE', 100);
      await sleep(30);
      check(h.state().pot === pot, 'banker cannot act manually');
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
  console.log(`• chaos: ${players} bots, ${targetRounds} hands with random leaves, cash-outs and disconnects`);
  const h = await startServer();
  let bots = await seatBots(h, players, true);
  let spare = 0;
  const end = Date.now() + 40000;

  while (h.rounds() < targetRounds && Date.now() < end) {
    const s = h.state();
    if (s.phase === 'WAITING') {
      // Somebody deals.
      bots[rand(bots.length)]?.emit('startGame');
    }

    const r = Math.random();
    if (r < 0.01 && bots.length > 2) {
      // Someone leaves for good.
      const b = bots.splice(rand(bots.length), 1)[0];
      const how = Math.random();
      if (how < 0.4) b.emit('cashOut');
      else if (how < 0.7) b.emit('leaveGame');
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
        b.emit('joinGame', b.name, free[rand(free.length)]);
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
  printCoverage();
  if (failureCount()) {
    console.error(`\n${failureCount()} check(s) failed (${secs}s).`);
    process.exit(1);
  }
  console.log(`\nAll simulation checks passed (${secs}s).`);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
