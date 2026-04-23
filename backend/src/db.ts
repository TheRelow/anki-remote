import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      field_schema TEXT NOT NULL DEFAULT '{"version":1,"fields":[{"id":"front","type":"text","required":true},{"id":"back","type":"text","required":true}]}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('new', 'learning', 'review')),
      step INTEGER NOT NULL,
      due_date INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      interval INTEGER NOT NULL,
      repetition INTEGER NOT NULL,
      efactor REAL NOT NULL,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cards_user_due ON cards(user_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);

    CREATE TABLE IF NOT EXISTS review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      grade TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
  `);

  migrateDecksTable(db);
  migrateCardsTable(db);
  migrateReviewEventsTable(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cards_user_deck_status_created
      ON cards(user_id, deck_id, status, created_at, id)
  `);
}

function migrateDecksTable(db: DatabaseSync): void {
  const hasFieldSchema = hasColumn(db, 'decks', 'field_schema');
  if (hasFieldSchema) return;
  db.exec(
    `ALTER TABLE decks ADD COLUMN field_schema TEXT NOT NULL DEFAULT '{"version":1,"fields":[{"id":"front","type":"text","required":true},{"id":"back","type":"text","required":true}]}'`
  );
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function migrateCardsTable(db: DatabaseSync): void {
  if (!hasColumn(db, 'cards', 'fields')) {
    db.exec(`ALTER TABLE cards ADD COLUMN fields TEXT NOT NULL DEFAULT '{}'`);
  }

  const cardsSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cards'`)
    .get() as { sql?: string } | undefined;
  if (!cardsSqlRow?.sql) return;

  const cardsSql = cardsSqlRow.sql.toLowerCase();
  const hasNewStatus = cardsSql.includes("'new'");
  const hasCreatedAt = cardsSql.includes('created_at');
  const hasFields = cardsSql.includes('fields');

  if (hasNewStatus && hasCreatedAt) return;

  db.exec('BEGIN');
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ALTER TABLE cards RENAME TO cards_old`);
    db.exec(`
      CREATE TABLE cards (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        deck_id TEXT NOT NULL,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        fields TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK (status IN ('new', 'learning', 'review')),
        step INTEGER NOT NULL,
        due_date INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        interval INTEGER NOT NULL,
        repetition INTEGER NOT NULL,
        efactor REAL NOT NULL,
        FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
      );
    `);
    if (hasFields) {
      db.exec(`
        INSERT INTO cards (
          id, user_id, deck_id, front, back, fields, status, step, due_date, created_at, interval, repetition, efactor
        )
        SELECT
          id, user_id, deck_id, front, back, COALESCE(fields, '{}'), status, step, due_date,
          COALESCE(due_date, 0) AS created_at,
          interval, repetition, efactor
        FROM cards_old;
      `);
    } else {
      db.exec(`
        INSERT INTO cards (
          id, user_id, deck_id, front, back, fields, status, step, due_date, created_at, interval, repetition, efactor
        )
        SELECT
          id, user_id, deck_id, front, back, '{}', status, step, due_date,
          COALESCE(due_date, 0) AS created_at,
          interval, repetition, efactor
        FROM cards_old;
      `);
    }
    db.exec(`DROP TABLE cards_old`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cards_user_due ON cards(user_id, due_date)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id)`);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cards_user_deck_status_created
        ON cards(user_id, deck_id, status, created_at, id)
    `);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw error;
  }
}

function migrateReviewEventsTable(db: DatabaseSync): void {
  const fkRows = db.prepare(`PRAGMA foreign_key_list(review_events)`).all() as Array<{ table: string }>;
  const hasBrokenCardsRef = fkRows.some((row) => row.table !== 'cards');
  if (!hasBrokenCardsRef) return;

  db.exec('BEGIN');
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ALTER TABLE review_events RENAME TO review_events_old`);
    db.exec(`
      CREATE TABLE review_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        grade TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
      );
    `);
    db.exec(`
      INSERT INTO review_events (id, user_id, card_id, grade, created_at)
      SELECT id, user_id, card_id, grade, created_at
      FROM review_events_old;
    `);
    db.exec(`DROP TABLE review_events_old`);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw error;
  }
}
