import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose the dev server on your local network (test on phones)
    port: 5173, // the client expects the game server on :3001 when served from here
  },
})
