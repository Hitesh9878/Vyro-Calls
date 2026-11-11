import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the client talks to the Express server through this proxy,
// so no CORS setup is needed and the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
