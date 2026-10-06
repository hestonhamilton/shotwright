import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const demoRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: demoRoot,
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL('index.html', import.meta.url)),
        about: fileURLToPath(new URL('about.html', import.meta.url)),
      },
    },
  },
})
