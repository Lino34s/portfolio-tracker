import { VitePWA } from 'vite-plugin-pwa'

export default {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: { /* conteúdo do manifest acima */ }
    })
  ]
}
