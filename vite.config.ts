import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'powered-by-santosoft.jpg'],
      manifest: {
        name: 'Aplikasi Koperasi Simpan Pinjam',
        short_name: 'Koperasi',
        description: 'Pencatatan simpan pinjam, laporan, dan estimasi SHU',
        lang: 'id',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2,jpg}'],
      },
    }),
  ],
});
