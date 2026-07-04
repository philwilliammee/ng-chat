import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['packages/chat-server/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/chat-server/src/lib/**'],
      thresholds: {
        'packages/chat-server/src/lib/**': {
          lines: 70, functions: 70, branches: 70, statements: 70,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@ng-chat/server': resolve(__dirname, 'packages/chat-server/src/index.ts'),
    },
  },
});
