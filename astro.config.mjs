// @ts-check

import { defineConfig, passthroughImageService } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import bun from './adapters/bun/index.mjs';

export default defineConfig({
  output: 'static',
  trailingSlash: "never",
  adapter: bun({
    mode: 'standalone',
    plugins: [
      // './src/plugins/cors.mjs',
      // './src/plugins/rate-limit.mjs',
      './src/plugins/conditional-cache.mjs',
      // './src/plugins/security-headers.mjs'
    ]
  }),
  // image: {
  //   service: passthroughImageService(),
  // },
  vite: {
    plugins: [tailwindcss()]
  },
});