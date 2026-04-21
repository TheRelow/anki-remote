import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type AuthUser = { sub: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let pemKeyPromise: Promise<CryptoKey> | null = null;
let hsSecret: Uint8Array | null = null;

export function initAuth(): void {
  const jwksUrl = process.env.JWT_JWKS_URL?.trim();
  if (jwksUrl) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    return;
  }
  const pem = process.env.JWT_PUBLIC_KEY?.trim();
  if (pem) {
    pemKeyPromise = importSPKI(pem, 'RS256');
    return;
  }
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    hsSecret = new TextEncoder().encode(secret);
    return;
  }
  console.warn(
    'No JWT_JWKS_URL, JWT_PUBLIC_KEY, or JWT_SECRET set — all authenticated requests will fail.'
  );
}

async function verifyWithPem(token: string): Promise<AuthUser> {
  if (!pemKeyPromise) throw new Error('JWT public key not configured');
  const key = await pemKeyPromise;
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['RS256'],
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined,
  });
  const sub = payload.sub;
  if (!sub) throw new Error('Invalid token: missing sub');
  return { sub };
}

export async function verifyBearerToken(token: string): Promise<AuthUser> {
  if (jwks) {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.JWT_ISSUER || undefined,
      audience: process.env.JWT_AUDIENCE || undefined,
    });
    const sub = payload.sub;
    if (!sub) throw new Error('Invalid token: missing sub');
    return { sub };
  }
  if (pemKeyPromise) {
    return verifyWithPem(token);
  }
  if (hsSecret) {
    const { payload } = await jwtVerify(token, hsSecret, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || undefined,
      audience: process.env.JWT_AUDIENCE || undefined,
    });
    const sub = payload.sub;
    if (!sub) throw new Error('Invalid token: missing sub');
    return { sub };
  }
  throw new Error('JWT verification not configured');
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function authPreHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const h = request.headers.authorization;
  if (!h?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Missing Bearer token' });
  }
  const token = h.slice(7).trim();
  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Empty token' });
  }
  try {
    request.authUser = await verifyBearerToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid token';
    return reply.code(401).send({ error: 'Unauthorized', message: msg });
  }
}
