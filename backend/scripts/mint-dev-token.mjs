#!/usr/bin/env node
/**
 * Печатает HS256 JWT для локальной разработки.
 * Сервер и этот скрипт должны использовать один и тот же JWT_SECRET.
 *
 *   JWT_SECRET=your-secret node backend/scripts/mint-dev-token.mjs [sub]
 */
import { SignJWT } from 'jose';

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-me'
);
const sub = process.argv[2] || 'dev-user';

const token = await new SignJWT({ sub })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('90d')
  .sign(secret);

console.log(token);
