import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { authPreHandler } from './auth.js';
import type { Grade } from './types.js';
import { calculateNextReview } from './sm2.js';

type SyncOpType = 'review-submit' | 'deck-create' | 'deck-update' | 'card-create';
type SyncOperation = {
  opId?: string;
  type?: SyncOpType;
  entityId?: string;
  payload?: Record<string, unknown>;
  clientTs?: number;
};
type SyncResultStatus = 'applied' | 'rejected' | 'retryable';
type SyncResult = {
  opId: string;
  status: SyncResultStatus;
  error?: string;
  data?: Record<string, unknown>;
};

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

function runReviewSubmitOp(
  db: DatabaseSync,
  userId: string,
  payload: Record<string, unknown>
): SyncResult {
  const cardId = typeof payload.cardId === 'string' ? payload.cardId : '';
  const grade = payload.grade as Grade;
  const grades: Grade[] = ['again', 'hard', 'good', 'easy'];
  if (!cardId || !grade || !grades.includes(grade)) {
    return { opId: '', status: 'rejected', error: 'cardId and valid grade required' };
  }
  const row = db
    .prepare(
      `SELECT id, deck_id AS deckId, front, back, fields, status, step, due_date AS dueDate,
              interval, repetition, efactor FROM cards WHERE id = ? AND user_id = ?`
    )
    .get(cardId, userId) as
    | {
        id: string;
        deckId: string;
        front: string;
        back: string;
        fields: string;
        status: 'new' | 'learning' | 'review';
        step: number;
        dueDate: number;
        interval: number;
        repetition: number;
        efactor: number;
      }
    | undefined;
  if (!row) {
    return { opId: '', status: 'rejected', error: 'Card not found' };
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
    opId: '',
    status: 'applied',
    data: {
      card: {
        id: row.id,
        deckId: row.deckId,
        front: row.front,
        back: row.back,
        fields: JSON.parse(row.fields || '{}'),
        ...next,
      },
    },
  };
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
        SELECT id, deck_id AS deckId, front, back, fields, status, step, due_date AS dueDate,
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
        fields: string;
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
        return {
          cards: newRows.map((row) => ({ ...row, fields: JSON.parse(row.fields || '{}') })),
          nextCursor: null,
        };
      }

      const last = rows[rows.length - 1];
      const nextCursor =
        last && rows.length === limit ? encodeCursor(last.dueDate, last.id) : null;

      return { cards: rows.map((row) => ({ ...row, fields: JSON.parse(row.fields || '{}') })), nextCursor };
    });

    protectedRoutes.get<{
      Querystring: {
        deckId?: string;
        limit?: string;
      };
    }>('/cards/training', async (request, reply) => {
      const userId = request.authUser!.sub;
      const now = Date.now();
      const deckId = request.query.deckId?.trim() || undefined;
      let limit = parseInt(request.query.limit ?? '100', 10);
      if (Number.isNaN(limit) || limit < 0) limit = 100;
      if (limit > 1_000) limit = 1_000;

      const params: (string | number)[] = [userId];
      let deckSql = '';
      if (deckId) {
        deckSql = ' AND deck_id = ? ';
        params.push(deckId);
      }
      params.push(now, now, limit);

      const rows = db
        .prepare(
          `
          SELECT id, deck_id AS deckId, front, back, fields, status, step, due_date AS dueDate,
                 interval, repetition, efactor
          FROM cards
          WHERE user_id = ? ${deckSql}
          ORDER BY
            CASE
              WHEN status != 'new' AND due_date <= ? THEN 0
              ELSE 1
            END ASC,
            CASE
              WHEN status != 'new' AND due_date <= ? THEN due_date
              ELSE created_at
            END ASC,
            id ASC
          LIMIT ?
          `
        )
        .all(...params) as Array<{
        id: string;
        deckId: string;
        front: string;
        back: string;
        fields: string;
        status: 'new' | 'learning' | 'review';
        step: number;
        dueDate: number;
        interval: number;
        repetition: number;
        efactor: number;
      }>;

      return { cards: rows.map((row) => ({ ...row, fields: JSON.parse(row.fields || '{}') })) };
    });

    protectedRoutes.post<{
      Body: { deckId?: string; front?: string; back?: string; fields?: Record<string, string> };
    }>('/cards', async (request, reply) => {
      const userId = request.authUser!.sub;
      const { deckId, front, back, fields } = request.body ?? {};
      const normalizedFields =
        fields && typeof fields === 'object' ? (fields as Record<string, string>) : {};
      const resolvedFront = (front ?? normalizedFields.front ?? '').trim();
      const resolvedBack = (back ?? normalizedFields.back ?? '').trim();
      if (!deckId || !resolvedFront || !resolvedBack) {
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
          id, user_id, deck_id, front, back, fields, status, step, due_date, created_at, interval, repetition, efactor
        )
         VALUES (?, ?, ?, ?, ?, ?, 'new', 0, ?, ?, 0, 0, 2.5)`
      ).run(id, userId, deckId, resolvedFront, resolvedBack, JSON.stringify(normalizedFields), dueDate, createdAt);
      reply.code(201).send({
        id,
        deckId,
        front: resolvedFront,
        back: resolvedBack,
        fields: normalizedFields,
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
          `SELECT id, deck_id AS deckId, front, back, fields, status, step, due_date AS dueDate,
                  interval, repetition, efactor FROM cards WHERE id = ?`
        )
        .get(id) as Record<string, unknown>;
      if (card && typeof card.fields === 'string') {
        (card as Record<string, unknown>).fields = JSON.parse(String(card.fields || '{}'));
      }
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
          `SELECT id, deck_id AS deckId, front, back, fields, status, step, due_date AS dueDate,
                  interval, repetition, efactor FROM cards WHERE id = ? AND user_id = ?`
        )
        .get(cardId, userId) as
        | {
            id: string;
            deckId: string;
            front: string;
            back: string;
            fields: string;
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
          fields: JSON.parse(row.fields || '{}'),
          ...next,
        },
      };
    });

    protectedRoutes.get('/sync/ping', async () => {
      return { ok: true, ts: Date.now() };
    });

    protectedRoutes.post<{
      Body: { operations?: SyncOperation[] };
    }>('/sync/batch', async (request) => {
      const userId = request.authUser!.sub;
      const operations = Array.isArray(request.body?.operations) ? request.body.operations : [];
      const results: SyncResult[] = [];

      for (const op of operations) {
        const opId = typeof op.opId === 'string' && op.opId.trim() ? op.opId.trim() : '';
        if (!opId) {
          results.push({ opId: '', status: 'rejected', error: 'opId is required' });
          continue;
        }
        const known = db
          .prepare(`SELECT response_json AS responseJson FROM sync_applied_ops WHERE user_id = ? AND op_id = ?`)
          .get(userId, opId) as { responseJson?: string } | undefined;
        if (known?.responseJson) {
          try {
            const parsed = JSON.parse(known.responseJson) as SyncResult;
            results.push(parsed);
            continue;
          } catch {
            // broken row; proceed with normal processing
          }
        }

        const type = op.type;
        const entityId = typeof op.entityId === 'string' ? op.entityId : '';
        const payload = (op.payload ?? {}) as Record<string, unknown>;
        let result: SyncResult;

        try {
          if (!type) {
            result = { opId, status: 'rejected', error: 'type is required' };
          } else if (type === 'review-submit') {
            result = runReviewSubmitOp(db, userId, payload);
          } else if (type === 'deck-create') {
            const name = typeof payload.name === 'string' ? payload.name.trim() : '';
            if (!name) {
              result = { opId, status: 'rejected', error: 'name is required' };
            } else {
              const id = randomUUID();
              const createdAt = Date.now();
              const fieldSchema =
                typeof payload.fieldSchema === 'object' && payload.fieldSchema !== null
                  ? JSON.stringify(payload.fieldSchema)
                  : undefined;
              if (fieldSchema) {
                db.prepare(
                  `INSERT INTO decks (id, user_id, name, field_schema, created_at) VALUES (?, ?, ?, ?, ?)`
                ).run(id, userId, name, fieldSchema, createdAt);
              } else {
                db.prepare(`INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`).run(
                  id,
                  userId,
                  name,
                  createdAt
                );
              }
              result = {
                opId,
                status: 'applied',
                data: {
                  tempId: entityId,
                  deck: { id, name, createdAt, dueCount: 0 },
                },
              };
            }
          } else if (type === 'deck-update') {
            const deckId = entityId || (typeof payload.deckId === 'string' ? payload.deckId : '');
            if (!deckId) {
              result = { opId, status: 'rejected', error: 'deckId is required' };
            } else {
              const patch: string[] = [];
              const params: Array<string | number> = [];
              if (typeof payload.name === 'string' && payload.name.trim()) {
                patch.push('name = ?');
                params.push(payload.name.trim());
              }
              if (typeof payload.fieldSchema === 'object' && payload.fieldSchema !== null) {
                patch.push('field_schema = ?');
                params.push(JSON.stringify(payload.fieldSchema));
              }
              if (patch.length === 0) {
                result = { opId, status: 'rejected', error: 'name or fieldSchema is required' };
              } else {
                params.push(deckId, userId);
                const r = db
                  .prepare(`UPDATE decks SET ${patch.join(', ')} WHERE id = ? AND user_id = ?`)
                  .run(...params);
                if (r.changes === 0) {
                  result = { opId, status: 'rejected', error: 'Deck not found' };
                } else {
                  const deck = db
                    .prepare(`SELECT id, name, created_at AS createdAt FROM decks WHERE id = ? AND user_id = ?`)
                    .get(deckId, userId) as { id: string; name: string; createdAt: number } | undefined;
                  result = deck
                    ? { opId, status: 'applied', data: { deck: { ...deck, dueCount: 0 } } }
                    : { opId, status: 'applied' };
                }
              }
            }
          } else if (type === 'card-create') {
            const deckId = typeof payload.deckId === 'string' ? payload.deckId : '';
            const fields = typeof payload.fields === 'object' && payload.fields !== null ? payload.fields : {};
            const front = typeof (fields as Record<string, unknown>).front === 'string'
              ? String((fields as Record<string, unknown>).front).trim()
              : '';
            const back = typeof (fields as Record<string, unknown>).back === 'string'
              ? String((fields as Record<string, unknown>).back).trim()
              : '';
            if (!deckId || !front || !back) {
              result = { opId, status: 'rejected', error: 'deckId, fields.front, fields.back required' };
            } else {
              const deck = db.prepare(`SELECT id FROM decks WHERE id = ? AND user_id = ?`).get(deckId, userId);
              if (!deck) {
                result = { opId, status: 'retryable', error: 'Deck not found yet' };
              } else {
                const id = randomUUID();
                const dueDate = 0;
                const createdAt = Date.now();
                db.prepare(
                  `INSERT INTO cards (
                    id, user_id, deck_id, front, back, fields, status, step, due_date, created_at, interval, repetition, efactor
                  ) VALUES (?, ?, ?, ?, ?, ?, 'new', 0, ?, ?, 0, 0, 2.5)`
                ).run(id, userId, deckId, front, back, JSON.stringify(fields), dueDate, createdAt);
                result = {
                  opId,
                  status: 'applied',
                  data: {
                    tempId: entityId,
                    card: {
                      id,
                      deckId,
                      front,
                      back,
                      fields,
                      status: 'new',
                      step: 0,
                      dueDate,
                      interval: 0,
                      repetition: 0,
                      efactor: 2.5,
                    },
                  },
                };
              }
            }
          } else {
            result = { opId, status: 'rejected', error: `Unsupported operation type: ${String(type)}` };
          }
        } catch (e) {
          result = {
            opId,
            status: 'retryable',
            error: e instanceof Error ? e.message : String(e),
          };
        }

        result.opId = opId;
        results.push(result);
        if (result.status === 'applied' || result.status === 'rejected') {
          db.prepare(
            `INSERT OR REPLACE INTO sync_applied_ops (user_id, op_id, response_json, created_at)
             VALUES (?, ?, ?, ?)`
          ).run(userId, opId, JSON.stringify(result), Date.now());
        }
      }

      return { results };
    });
    },
    { prefix: '/api/v1' }
  );
}
