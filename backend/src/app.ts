import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { DatabaseSync } from 'node:sqlite';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import type { FastifyCorsOptions } from '@fastify/cors';
import { initAuth } from './auth.js';
import { registerRoutes } from './routes.js';

export type ServerTlsOptions = Pick<HttpsServerOptions, 'key' | 'cert'>;

function buildCorsOptions(): FastifyCorsOptions {
  const raw = process.env.CORS_ORIGINS?.trim();
  const allowedOrigins =
    raw && raw.length > 0
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

  return {
    // If CORS_ORIGINS is unset, keep permissive behavior for local development.
    origin: allowedOrigins
      ? (origin, cb) => {
          if (!origin) return cb(null, true);
          cb(null, allowedOrigins.includes(origin));
        }
      : true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    maxAge: 86_400,
  };
}

export async function buildServer(db: DatabaseSync, tls?: ServerTlsOptions) {
  initAuth();

  const app = Fastify({
    logger: true,
    ...(tls ? { https: tls } : {}),
  });
  await app.register(cors, buildCorsOptions());

  await registerRoutes(app, db);

  return app;
}
