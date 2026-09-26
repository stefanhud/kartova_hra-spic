import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs'; // <--- Import fs
import { GameManager } from './game/GameManager';

const app = express();
app.use(cors());

// 👇👇👇 UPDATED STATIC SERVING LOGIC 👇👇👇
const clientBuildPath = path.join(__dirname, '../../client/dist');

// Only serve static files if the build folder actually exists (Production/Docker)
// ✅ FIXED VERSION
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));

  // Use regex /^(.*)$/ instead of '*' to satisfy the new parser
  app.get(/^(.*)$/, (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  console.log("Dev Mode: Client build not found (skipping static serve).");
}
// 👆👆👆 END UPDATE 👆👆👆

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from anywhere (useful for mobile/network testing later)
    methods: ["GET", "POST"]
  }
});

// Initialize the Game Manager
const gameManager = new GameManager(io);

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Pass control to the game manager
  gameManager.handleConnection(socket);
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
