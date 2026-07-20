import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to the LAN interface (not just localhost) so a phone on the same
    // Wi-Fi can open this dev server directly — needed for on-device testing
    // ahead of the exhibition, where visitors use the team's phone(s).
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
