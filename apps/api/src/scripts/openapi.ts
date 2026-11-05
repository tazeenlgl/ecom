import { writeFileSync } from 'node:fs';
import { buildApp } from '../app.js';
import { testConfig } from '../config/env.js';
import type { Database } from '../db/client.js';
import { buildOpenApi } from '../lib/openapi.js';

/** Writes the OpenAPI document generated from the route definitions. No database is used. */
const out = process.argv[2] ?? '../../docs/openapi.json';
const app = await buildApp({ config: testConfig(), db: {} as Database });
await app.ready();
writeFileSync(out, JSON.stringify(buildOpenApi(app.routeDocs), null, 2) + '\n');
console.log(`Wrote ${out} (${app.routeDocs.length} operations)`);
await app.close();
