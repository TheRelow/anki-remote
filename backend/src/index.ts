import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openDatabase } from './db.js';
import { buildServer } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '..', '.env'),
];

if (typeof process.loadEnvFile === 'function') {
  for (const envPath of envCandidates) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore missing env files and continue.
    }
  }
}

const defaultDb = join(__dirname, '..', 'data', 'anki.sqlite');
const dbPath = process.env.DATABASE_PATH ?? defaultDb;
const certPath = process.env.SSL_CERT_PATH;
const keyPath = process.env.SSL_KEY_PATH;

if ((certPath && !keyPath) || (!certPath && keyPath)) {
  throw new Error('Set both SSL_CERT_PATH and SSL_KEY_PATH to enable HTTPS');
}

const tls =
  certPath && keyPath
    ? {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      }
    : undefined;

const db = openDatabase(dbPath);
const app = await buildServer(db, tls);

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const protocol = tls ? 'https' : 'http';

await app.listen({ port, host });
console.log(`Anki API listening on ${protocol}://${host}:${port}`);
