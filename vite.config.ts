import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', 'zustand'],
          canvas: ['konva', 'react-konva', 'use-image'],
        },
      },
    },
  },
  server: {
    port: 33020,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:38120',
    },
  },
})
