import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Каждый тест создаёт свою БД в памяти, сеть не нужна.
    testTimeout: 15000,
  },
});
