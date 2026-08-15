/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/hubben/',
  plugins: [react(), tailwindcss()],
  // Bara rena funktioner testas — ingen jsdom, inget testbibliotek för
  // komponenter. Med en användare hittas gränssnittsbuggar snabbare genom
  // att öppna appen än genom att beskriva den i ett test.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
