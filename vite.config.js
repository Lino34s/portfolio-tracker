import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  
  build: {
    outDir: 'dist',
    sourcemap: false
  },

  // Força o Vite a usar a versão correta
  resolve: {
    dedupe: ['react', 'react-dom']
  }
})
