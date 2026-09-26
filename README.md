# ŠPIC — Bar Card Game

ŠPIC is a real-time, multiplayer card game inspired by the Slovak bar game *Špic*. Join a shared six-seat table, build the strongest three-card hand you can, and try to take the pot. The client is built with React and Vite; the Node.js server manages the game and synchronizes players with Socket.IO.

## Features

- Multiplayer table with up to six seats
- Live game state over Socket.IO
- €5 ante and configurable €5–€100 buy-in
- Two betting rounds, a shared four-card talon, and one-card swaps
- Rotating dealer role, with a special option when the talon has a strong hand
- Turn timer with automatic actions when a player does not act
- Responsive table layout for desktop and mobile
- Docker and Docker Compose deployment

## How to play

1. Open the game and select **SIT** at an open seat. Enter a name and choose a buy-in.
2. When at least two players are seated, start the round with **DEAL CARDS**. Each player antes €5 and receives two cards.
3. Take turns checking, calling, raising, or folding in the first betting round. The dealer cannot fold. If the dealer looks at their cards, they give up the option to play blind later.
4. Each active player receives a third card, followed by a second betting round.
5. The server reveals a four-card talon. Players may replace one card with a talon card, but the resulting hand must beat the best score already set. Players can also pass. If the talon contains a qualifying special hand, the blind dealer may take it or reveal their own hand.
6. At showdown, the best qualifying hand wins the pot. If the round ties, the pot carries over and a future winner must beat the tied score.

### Hand scoring

Hands are scored from three cards:

- **Špic (31):** a flush totaling 31 points.
- **Flush:** three cards of the same suit; the score is the sum of their card values in that suit.
- **Trojica:** three cards of the same rank, scored as 30.5; higher triples win ties.
- **Zlatý špic:** three aces, scored as 33.
- **Bicykel:** three different suits with no pair. This dead hand cannot be improved with a single swap and folds automatically.

The turn clock is 15 seconds. If a player runs out of time, the server checks or calls when free, folds when facing a bet, or passes during the swap phase.

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

Open [http://localhost:5173](http://localhost:5173). The Vite client connects to the Socket.IO server on port `3001`.

## Run with Docker

From the repository root:

```bash
docker compose up --build
```

Then open [http://localhost:3001](http://localhost:3001). To stop the service, press `Ctrl+C` in the terminal running Compose.

## Project structure

```text
client/   React and Vite web client
server/   Express, Socket.IO, and game rules
Dockerfile
docker-compose.yml
```

## Screenshots

Screenshots of the lobby and an active hand are not included yet. The local browser session can display the game, but this environment does not currently grant the desktop capture permission needed to save the images into the repository.
