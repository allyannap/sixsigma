import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps asset paths relative, so dist/ works at any URL (Posit Connect too).
// In dev (npm run dev) the API and the map files come from the FastAPI app on port 8000.
export default defineConfig({
  plugins: [react()],
  base: './',
  // Read the repo-root .env (gitignored). Only VITE_* names reach the page; CENSUS_API_KEY and the rest never do.
  envDir: '../..',
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
