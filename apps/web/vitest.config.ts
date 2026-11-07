import { defineConfig } from 'vitest/config';
import path from 'node:path';

// `jsx: automatic` lets tests import page modules (tsconfig keeps `preserve` for Next.js, which compiles JSX itself).
export default defineConfig({ esbuild: { jsx: 'automatic' }, resolve: { alias: { '@': path.resolve(__dirname) } }, test: { include: ['test/**/*.test.ts'] } });
