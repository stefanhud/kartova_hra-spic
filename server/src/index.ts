import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameManager } from './game/GameManager';

const app = express();
app.use(cors());

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