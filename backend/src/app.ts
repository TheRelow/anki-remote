import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { DatabaseSync } from 'node:sqlite';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import type { FastifyCorsOptions } from '@fastify/cors';
import { initAuth } from './auth.js';
import { registerRoutes } from './routes.js';

export type ServerTlsOptions = Pick<HttpsServerOptions, 'key' | 'cert'>;

function normalizeToOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    // Allow plain origins in env, e.g. https://example.com
    return trimmed.replace(/\/+$/, '');
  }
}

function buildCorsOptions(): FastifyCorsOptions {
  const raw = process.env.CORS_ORIGINS?.trim();
  const allowedOrigins = new Set(
    raw && raw.length > 0
      ? raw
          .split(',')
          .map(normalizeToOrigin)
          .filter(Boolean)
      : []
  );

  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  const hasConfiguredOrigins = allowedOrigins.size > 0;

  return {
    // If CORS_ORIGINS is unset, keep permissive behavior for local development.
    origin: hasConfiguredOrigins
      ? (origin, cb) => {
          if (!origin) return cb(null, true);
          cb(null, allowedOrigins.has(normalizeToOrigin(origin)));
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
