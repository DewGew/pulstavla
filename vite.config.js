import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	base: "/",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,

    hmr: {
      host: '192.168.1.13',
      protocol: 'ws',
      port: 5173	  // Synology proxy lyssnar här
    }
  }
})
