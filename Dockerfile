# Use Node.js 18 on Alpine Linux (Lightweight)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# --- 1. BUILD CLIENT ---
WORKDIR /app/client
# Copy client package files and install
COPY client/package*.json ./
RUN npm install
# Copy client source code
COPY client/ ./
# Build the React app (creates /app/client/dist)
RUN npm run build

# --- 2. SETUP SERVER ---
WORKDIR /app/server
# Copy server package files and install
COPY server/package*.json ./
RUN npm install
# Copy server source code
COPY server/ ./

# --- 3. FINAL CONFIG ---
# Expose the port
EXPOSE 3001

# Command to start the server (using ts-node to run TypeScript directly)
CMD ["npx", "ts-node", "src/index.ts"]