import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { authPreHandler } from './auth.js';
import type { Grade } from './types.js';
import { calculateNextReview } from './sm2.js';

function encodeCursor(dueDate: number, id: string): string {
  return Buffer.from(JSON.stringify({ d: dueDate, i: id }), 'utf8').toString('base64url');
}

function decodeCursor(s: string | undefined): { d: number; i: string } | null {
  if (!s) return null;
  try {
    const raw = Buffer.from(s, 'base64url').toString('utf8');
    const o = JSON.parse(raw) as { d?: number; i?: string };
    if (typeof o.d !== 'number' || typeof o.i !== 'string') return null;
    return { d: o.d, i: o.i };
  } catch {
    return null;
  }
}

export async function registerRoutes(app: FastifyInstance, db: DatabaseSync): Promise<void> {
  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', authPreHandler);

    protectedRoutes.get('/decks', async (request) => {
      const userId = request.authUser!.sub;
      const now = Date.now();
      const rows = db
        .prepare(
          `SELECT d.id, d.name, d.created_at AS createdAt,
                  COALESCE(SUM(CASE
                    WHEN c.status != 'new' AND c.due_date <= ? THEN 1
                    ELSE 0
                  END), 0) AS dueCount
           FROM decks d
           LEFT JOIN cards c ON c.deck_id = d.id AND c.user_id = d.user_id
           WHERE d.user_id = ?
           GROUP BY d.id, d.name, d.created_at
           ORDER BY d.created_at ASC`
        )
        .all(now, userId) as { id: string; name: string; createdAt: number; dueCount: number }[];
      return { decks: rows };
    });

    protectedRoutes.post<{ Body: { name?: string } }>('/decks', async (request, reply) => {
      const userId = request.authUser!.sub;
      const name = request.body?.name?.trim();
      if (!name) {
        reply.code(400).send({ error: 'Bad Request', message: 'name is required' });
        return;
      }
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`
      ).run(id, userId, name, createdAt);
      reply.code(201).send({ id, name, createdAt });
    });

    protectedRoutes.patch<{ Params: { id: string }; Body: { name?: string } }>(
      '/decks/:id',
      async (request, reply) => {
        const userId = request.authUser!.sub;
        const { id } = request.params;
        const name = request.body?.name?.trim();
        if (!name) {
          reply.code(400).send({ error: 'Bad Request', message: 'name is required' });
          return;
        }
        const r = db
          .prepare(`UPDATE decks SET name = ? WHERE id = ? AND user_id = ?`)
          .run(name, id, userId);
        if (r.changes === 0) {
          reply.code(404).send({ error: 'Not Found' });
          return;
        }
        return { id, name };
      }
    );

    protectedRoutes.get<{
      Querystring: {
        deckId?: string;
        limit?: string;
        cursor?: string;
        all?: string;
      };
    }>('/cards/due', async (request, reply) => {
      const userId = request.authUser!.sub;
      const now = Date.now();
      const deckId = request.query.deckId?.trim() || undefined;
      const all = request.query.all === 'true' || request.query.all === '1';
      let limit = parseInt(request.query.limit ?? '100', 10);
      if (Number.isNaN(limit) || limit < 0) limit = 100;
      if (all) limit = 1_000_000;

      const cur = decodeCursor(request.query.cursor);
      const params: (string | number)[] = [userId, now];
      let deckSql = '';
      if (deckId) {
        deckSql = ' AND deck_id = ? ';
        params.push(deckId);
      }

      let cursorSql = '';
      if (cur) {
        cursorSql = ` AND (due_date > ? OR (due_date = ? AND id > ?)) `;
        params.push(cur.d, cur.d, cur.i);
      }

      const sql = `
        SELECT id, deck_id AS deckId, front, back, status, step, due_date AS dueDate,
               interval, repetition, efactor
        FROM cards
        WHERE user_id = ? AND status != 'new' AND due_date <= ? ${deckSql} ${cursorSql}
        ORDER BY due_date ASC, id ASC
        LIMIT ?
      `;
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as Array<{
        id: string;
        deckId: string;
        front: string;
        back: string;
        status: 'new' | 'learning' | 'review';
        step: number;
        dueDate: number;
        interval: number;
        repetition: number;
        efactor: number;
      }>;

      if (rows.length === 0) {
        const newParams: (string | number)[] = [userId];
        let newDeckSql = '';
        if (deckId) {
          newDeckSql = ' AND deck_id = ? ';
          newParams.push(deckId);
        }
        newParams.push(limit);
        const newRows = db
          .prepare(
            `
            SELECT id, deck_id AS deckId, front, back, status, step, due_date AS dueDate,
                   interval, repetition, efactor
            FROM cards
            WHERE user_id = ? AND status = 'new' ${newDeckSql}
            ORDER BY created_at ASC, id ASC
            LIMIT ?
            `
          )
          .all(...newParams) as typeof rows;
        return { cards: newRows, nextCursor: null };
      }

      const last = rows[rows.length - 1];
      const nextCursor =
        last && rows.length === limit ? encodeCursor(last.dueDate, last.id) : null;

      return { cards: rows, nextCursor };
    });

    protectedRoutes.post<{
      Body: { deckId?: string; front?: string; back?: string };
    }>('/cards', async (request, reply) => {
      const userId = request.authUser!.sub;
      const { deckId, front, back } = request.body ?? {};
      if (!deckId || !front?.trim() || !back?.trim()) {
        reply.code(400).send({ error: 'Bad Request', message: 'deckId, front, back required' });
        return;
      }
      const deck = db
        .prepare(`SELECT id FROM decks WHERE id = ? AND user_id = ?`)
        .get(deckId, userId);
      if (!deck) {
        reply.code(404).send({ error: 'Not Found', message: 'Deck not found' });
        return;
      }
      const id = randomUUID();
      const dueDate = 0;
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO cards (
          id, user_id, deck_id, front, back, status, step, due_date, created_at, interval, repetition, efactor
        )
         VALUES (?, ?, ?, ?, ?, 'new', 0, ?, ?, 0, 0, 2.5)`
      ).run(id, userId, deckId, front.trim(), back.trim(), dueDate, createdAt);
      reply.code(201).send({
        id,
        deckId,
        front: front.trim(),
        back: back.trim(),
        status: 'new',
        step: 0,
        dueDate,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
      });
    });

    protectedRoutes.patch<{
      Params: { id: string };
      Body: { front?: string; back?: string };
    }>('/cards/:id', async (request, reply) => {
      const userId = request.authUser!.sub;
      const { id } = request.params;
      const front = request.body?.front?.trim();
      const back = request.body?.back?.trim();
      if (front === undefined && back === undefined) {
        reply.code(400).send({ error: 'Bad Request', message: 'front or back required' });
        return;
      }
      const row = db
        .prepare(
          `SELECT front, back FROM cards WHERE id = ? AND user_id = ?`
        )
        .get(id, userId) as { front: string; back: string } | undefined;
      if (!row) {
        reply.code(404).send({ error: 'Not Found' });
        return;
      }
      const nf = front ?? row.front;
      const nb = back ?? row.back;
      db.prepare(`UPDATE cards SET front = ?, back = ? WHERE id = ? AND user_id = ?`).run(
        nf,
        nb,
        id,
        userId
      );
      const card = db
        .prepare(
          `SELECT id, deck_id AS deckId, front, back, status, step, due_date AS dueDate,
                  interval, repetition, efactor FROM cards WHERE id = ?`
        )
        .get(id) as Record<string, unknown>;
      return card;
    });

    protectedRoutes.post<{
      Body: { cardId?: string; grade?: Grade };
    }>('/reviews', async (request, reply) => {
      const userId = request.authUser!.sub;
      const { cardId, grade } = request.body ?? {};
      const grades: Grade[] = ['again', 'hard', 'good', 'easy'];
      if (!cardId || !grade || !grades.includes(grade)) {
        reply.code(400).send({ error: 'Bad Request', message: 'cardId and valid grade required' });
        return;
      }

      const row = db
        .prepare(
          `SELECT id, deck_id AS deckId, front, back, status, step, due_date AS dueDate,
                  interval, repetition, efactor FROM cards WHERE id = ? AND user_id = ?`
        )
        .get(cardId, userId) as
        | {
            id: string;
            deckId: string;
            front: string;
            back: string;
            status: 'new' | 'learning' | 'review';
            step: number;
            dueDate: number;
            interval: number;
            repetition: number;
            efactor: number;
          }
        | undefined;

      if (!row) {
        reply.code(404).send({ error: 'Not Found' });
        return;
      }

      const next = calculateNextReview(
        {
          status: row.status,
          step: row.step,
          dueDate: row.dueDate,
          interval: row.interval,
          repetition: row.repetition,
          efactor: row.efactor,
        },
        grade
      );

      db.prepare(
        `UPDATE cards SET status = ?, step = ?, due_date = ?, interval = ?, repetition = ?, efactor = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        next.status,
        next.step,
        next.dueDate,
        next.interval,
        next.repetition,
        next.efactor,
        cardId,
        userId
      );

      db.prepare(
        `INSERT INTO review_events (user_id, card_id, grade, created_at) VALUES (?, ?, ?, ?)`
      ).run(userId, cardId, grade, Date.now());

      return {
        card: {
          id: row.id,
          deckId: row.deckId,
          front: row.front,
          back: row.back,
          ...next,
        },
      };
    });
    },
    { prefix: '/api/v1' }
  );
}
