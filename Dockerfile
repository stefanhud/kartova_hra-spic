# ---- 1. Build the React client ----
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. Compile the TypeScript server ----
FROM node:22-alpine AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- 3. Runtime: compiled JS + production dependencies only ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server /app/server/dist ./dist
COPY --from=client /app/client/dist /app/client/dist

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3001/healthz >/dev/null || exit 1
CMD ["node", "dist/index.js"]
