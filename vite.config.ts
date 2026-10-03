import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['react', 'react-dom', 'react-helmet-async', '@supabase/supabase-js'],
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-dom/client'],
          'helmet': ['react-helmet-async'],
          'supabase': ['@supabase/supabase-js'],
          'icons': ['lucide-react'],
          'vercel': ['@vercel/analytics/react'],
        },
      },
    },
  },
});
