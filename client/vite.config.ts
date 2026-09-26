import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 👇👇👇 ADD THIS BLOCK 👇👇👇
  server: {
    host: true, // This exposes the app to your local network
    port: 5173  // Ensures we stick to the port our logic expects
  }
  // 👆👆👆 END ADDITION 👆👆👆
})
