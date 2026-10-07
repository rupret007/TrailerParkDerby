/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// Project Pages live at https://rupret007.github.io/TrailerParkDerby/
export default defineConfig({
  base: '/TrailerParkDerby/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
