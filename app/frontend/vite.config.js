import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps asset paths relative, so dist/ works at any URL (Posit Connect too).
// In dev (npm run dev) the API and the map files come from the FastAPI app on port 8000.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/geo': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
