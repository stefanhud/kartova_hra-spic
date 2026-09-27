# ŠPIC — Bar Card Game

ŠPIC is a real-time, multiplayer card game inspired by the Slovak bar game *Špic*. Up to six players sit at a shared table on their phones, build the strongest three-card hand they can, and try to take the pot. The client is built with React and Vite; the Node.js server runs the game and synchronizes players with Socket.IO.

<p align="center">
  <img src="docs/screenshots/phone-betting.jpg" width="220" alt="Betting round on a phone" />
  <img src="docs/screenshots/phone-swap.jpg" width="220" alt="Swapping a card with the talon" />
  <img src="docs/screenshots/phone-showdown.jpg" width="220" alt="Showdown with revealed hands" />
</p>
<p align="center">
  <img src="docs/screenshots/phone-landscape.jpg" width="560" alt="Landscape layout on a phone" />
</p>

## Features

- Six-seat table built for phones first: you always sit at the bottom, with your hand and big thumb-sized buttons in the dock below the table
- Portrait, landscape and desktop layouts
- Crisp vector cards with a four-colour deck (♠ black, ♥ red, ♦ blue, ♣ green), so suits are easy to tell apart on a small screen
- Talon swaps show which table cards beat the bar and the score you'd end up with, then ask you to confirm
- Countdown ring on the active player, vibration and a tab-title alert when it's your turn
- Reconnects without losing your seat: reload the page, switch apps or change networks mid-hand and you keep your seat, chips and cards
- The screen stays awake while you're seated, and the game can be added to your home screen as an app
- €5 ante and a configurable €5–€100 buy-in, with a rebuy button when you run out of chips
- Docker and Docker Compose deployment

## How to play

1. Open the game and tap an empty **Sit** seat. Enter a name and choose a buy-in.
2. When at least two players are seated, anyone at the table can tap **Deal cards**. Each player antes €5 and receives two cards.
3. Take turns checking, calling, raising (+€1 to +€3) or folding in the first betting round. The banker (marked **D**) cannot fold and plays blind, calling automatically. If the banker taps **Look at cards**, they give up the blind talon option and bet like everyone else.
4. Each player still in the hand receives a third card, followed by a second betting round.
5. The server reveals a four-card talon. Starting left of the banker, each player may replace one card with a talon card. The new hand must beat the bar, which is the best hand swapped in so far; otherwise the player passes. If the talon holds a Flush or Trojica and the banker never looked, the banker may take it instead.
6. At showdown the best hand wins the pot. If the round ties, the pot carries over and a future winner must beat the tied score.

Tap **?** in the top bar for the rules, and the log icon (or the ticker) for the table log.

### Hand scoring

Hands are scored from three cards (A = 11, K/Q/J/10 = 10, 9/8/7 = face value):

- **Zlatý špic:** three aces, scored as 33.
- **Špic (31):** a flush totaling 31 points.
- **Trojica:** three cards of the same rank, scored as 30.5; higher triples win ties.
- **Flush:** three cards of the same suit; the score is the sum of their card values.
- **Bicykel:** three different suits with no pair. This dead hand cannot be improved with a single swap and folds automatically.

### Timers and connections

- The turn clock is 15 seconds. If a player runs out of time, the server checks or calls when that is free (or for the banker), folds when facing a bet, and passes during the swap phase.
- A player whose connection drops keeps their seat for 2 minutes. While they are offline their turns run on a 5-second clock, and they are not dealt into new hands. If they don't come back, they are removed and fold any hand in progress.
- Players who sit down during a hand wait for the next deal; players with no chips sit out until they rebuy.

## Run locally

Use Node.js 22 or a recent Node.js 20 release supported by Vite 7.

Install dependencies:

```bash
npm install --prefix server
npm install --prefix client
```

Start the server in one terminal:

```bash
npm --prefix server run dev
```

Start the client in another terminal:

```bash
npm --prefix client run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite client connects to the Socket.IO server on port `3001`. To try it on phones, open `http://<your-computer's-LAN-IP>:5173` from a phone on the same Wi‑Fi. Each browser tab gets its own player session, so you can also open several tabs to fill the table.

### Tests

The server has a multi-player simulation test. It runs bot tables of 2–6 players over real sockets, with random raises, folds, swaps, timeouts, disconnects, reconnects, rebuys and late joins. It checks that money is conserved, no card is dealt twice, hidden cards stay hidden and a round can never stall:

```bash
npm --prefix server test
```

Client checks:

```bash
npm --prefix client run lint
npm --prefix client run build
```

## Run with Docker

From the repository root:

```bash
docker compose up --build
```

Then open [http://localhost:3001](http://localhost:3001), or `http://<server-IP>:3001` from phones on the same network. To stop the service, press `Ctrl+C` in the terminal running Compose.

The image compiles the client and server at build time and runs plain `node` with production dependencies only. It also exposes a `/healthz` endpoint for health checks.

## Project structure

```text
client/        React and Vite web client
  src/components/   Table, seats, cards, dock (hand + controls), sheets
server/        Express, Socket.IO, and game rules
  src/game/         GameManager (flow, timers, sessions), HandEvaluator, deck
  test/             Multi-player simulation test
Dockerfile
docker-compose.yml
```
