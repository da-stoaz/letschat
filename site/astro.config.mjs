import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://letschat.stoaz.net',
  vite: {
    plugins: [tailwindcss()],
  },
});
