import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { DEFAULT_TIMINGS, GameManager, Timings } from './game/GameManager';

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Serve the built client when it exists (production / Docker).
const clientBuildPath = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientBuildPath)) {
  // Vite puts content-hashed bundles in /assets, so they can be cached forever.
  app.use('/assets', express.static(path.join(clientBuildPath, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(clientBuildPath, { index: false, maxAge: '7d' }));
  // Always revalidate index.html so phones pick up new versions right away.
  app.get(/^(.*)$/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  console.log('Dev mode: client build not found (skipping static serve).');
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // Notice dead phone connections within ~20s instead of the default ~45s.
  pingInterval: 10000,
  pingTimeout: 10000,
  maxHttpBufferSize: 16 * 1024,
});

// SPIC_TIME_SCALE < 1 speeds up every game timer (used by the simulation test).
const scale = Number(process.env.SPIC_TIME_SCALE) || 1;
const timings = Object.fromEntries(
  Object.entries(DEFAULT_TIMINGS).map(([k, v]) => [k, Math.round(v * scale)]),
) as unknown as Timings;

const gameManager = new GameManager(io, timings);

io.on('connection', socket => {
  gameManager.handleConnection(socket);
});

server.listen(PORT, () => {
  console.log(`ŠPIC server running on port ${PORT}`);
});
