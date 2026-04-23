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

function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return (
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]'
    );
  } catch {
    return false;
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
    allowedOrigins.add('http://localhost:5174');
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
    allowedOrigins.add('http://127.0.0.1:5174');
  }

  const hasConfiguredOrigins = allowedOrigins.size > 0;
  const allowAnyLocalDevOrigin = process.env.NODE_ENV !== 'production';

  return {
    // If CORS_ORIGINS is unset, keep permissive behavior for local development.
    origin: hasConfiguredOrigins
      ? (origin, cb) => {
          if (!origin) return cb(null, true);
          const normalizedOrigin = normalizeToOrigin(origin);
          cb(
            null,
            allowedOrigins.has(normalizedOrigin) ||
              (allowAnyLocalDevOrigin && isLocalDevOrigin(normalizedOrigin))
          );
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
