import type { Card, Deck, Grade } from '../types';
import type { SyncOperation } from '../api/ankiApi';

const STORAGE_VERSION = 1 as const;
const STORAGE_PREFIX = 'anki-remote:offline:';

export type PendingReview = {
  cardId: string;
  grade: Grade;
  enqueuedAt: number;
};

export type OfflineSnapshot = {
  version: typeof STORAGE_VERSION;
  decks: Deck[];
  cardsById: Record<string, Card>;
  pendingReviews: PendingReview[];
  pendingOps: SyncOperation[];
};

function storageKeyForToken(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = Math.imul(31, h) + token.charCodeAt(i);
    h |= 0;
  }
  return `${STORAGE_PREFIX}v${STORAGE_VERSION}:${h}`;
}

export function emptySnapshot(): OfflineSnapshot {
  return {
    version: STORAGE_VERSION,
    decks: [],
    cardsById: {},
    pendingReviews: [],
    pendingOps: [],
  };
}

export function loadSnapshot(token: string | null): OfflineSnapshot | null {
  if (!token || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKeyForToken(token));
    if (!raw) return null;
    const o = JSON.parse(raw) as OfflineSnapshot;
    if (o?.version !== STORAGE_VERSION || !o.cardsById || !Array.isArray(o.decks)) {
      return null;
    }
    if (!Array.isArray(o.pendingReviews)) o.pendingReviews = [];
    if (!Array.isArray(o.pendingOps)) o.pendingOps = [];
    // Legacy migration: old snapshot had pendingReviews only.
    if (o.pendingOps.length === 0 && o.pendingReviews.length > 0) {
      o.pendingOps = o.pendingReviews.map((row, idx) => ({
        opId: `legacy-review-${row.cardId}-${row.enqueuedAt}-${idx}`,
        type: 'review-submit',
        entityId: row.cardId,
        payload: { cardId: row.cardId, grade: row.grade },
        clientTs: row.enqueuedAt,
        attempts: 0,
      }));
    }
    return o;
  } catch {
    return null;
  }
}

export function saveSnapshot(token: string | null, snap: OfflineSnapshot): void {
  if (!token || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKeyForToken(token), JSON.stringify(snap));
  } catch {
    /* quota / private mode */
  }
}

export function mergeCardsIntoSnapshot(snap: OfflineSnapshot, cards: Card[]): OfflineSnapshot {
  const next = { ...snap, cardsById: { ...snap.cardsById } };
  for (const c of cards) {
    next.cardsById[c.id] = c;
  }
  return next;
}

/** Колоды из ответа API — источник правды для списка колод. */
export function replaceDecksInSnapshot(snap: OfflineSnapshot, decks: Deck[]): OfflineSnapshot {
  return { ...snap, decks: decks.map((d) => ({ ...d })) };
}

export function upsertCardInSnapshot(snap: OfflineSnapshot, card: Card): OfflineSnapshot {
  return {
    ...snap,
    cardsById: { ...snap.cardsById, [card.id]: { ...card } },
  };
}

export function enqueueReview(snap: OfflineSnapshot, cardId: string, grade: Grade): OfflineSnapshot {
  return {
    ...snap,
    pendingReviews: [...snap.pendingReviews, { cardId, grade, enqueuedAt: Date.now() }],
  };
}

export function shiftPendingReview(snap: OfflineSnapshot): OfflineSnapshot {
  const [, ...rest] = snap.pendingReviews;
  return { ...snap, pendingReviews: rest };
}

export function enqueuePendingOp(snap: OfflineSnapshot, op: SyncOperation): OfflineSnapshot {
  return {
    ...snap,
    pendingOps: [...snap.pendingOps, op],
  };
}

export function removePendingOps(snap: OfflineSnapshot, opIds: string[]): OfflineSnapshot {
  if (opIds.length === 0) return snap;
  const excluded = new Set(opIds);
  return {
    ...snap,
    pendingOps: snap.pendingOps.filter((op) => !excluded.has(op.opId)),
  };
}

export function replacePendingOp(snap: OfflineSnapshot, nextOp: SyncOperation): OfflineSnapshot {
  return {
    ...snap,
    pendingOps: snap.pendingOps.map((op) => (op.opId === nextOp.opId ? nextOp : op)),
  };
}

/**
 * Карточки к повторению: dueDate <= now, порядок как на сервере — dueDate, id.
 */
export function pickDueCardsFromSnapshot(
  snap: OfflineSnapshot,
  deckId: string | 'all',
  now: number
): Card[] {
  const rows = Object.values(snap.cardsById).filter((c) => {
    if (c.status === 'new') return false;
    if (c.dueDate > now) return false;
    if (deckId !== 'all' && c.deckId !== deckId) return false;
    return true;
  });
  rows.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
    return a.id.localeCompare(b.id);
  });
  return rows;
}

export function dueCountForDeckInSnapshot(snap: OfflineSnapshot, deckId: string, now: number): number {
  return pickDueCardsFromSnapshot(snap, deckId, now).length;
}

export function recomputeDeckDueCounts(snap: OfflineSnapshot, now: number): Deck[] {
  return snap.decks.map((d) => ({
    ...d,
    dueCount: dueCountForDeckInSnapshot(snap, d.id, now),
  }));
}

/**
 * Набор карточек для офлайн-тренировки:
 * 1) сначала due (без new), 2) затем остальные (включая new) до нужного лимита.
 */
export function pickTrainingCardsFromSnapshot(
  snap: OfflineSnapshot,
  deckId: string | 'all',
  now: number,
  limit: number
): Card[] {
  const all = Object.values(snap.cardsById).filter((c) => deckId === 'all' || c.deckId === deckId);

  const due = all
    .filter((c) => c.status !== 'new' && c.dueDate <= now)
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
      return a.id.localeCompare(b.id);
    });

  const dueIds = new Set(due.map((c) => c.id));
  const rest = all
    .filter((c) => !dueIds.has(c.id))
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
      return a.id.localeCompare(b.id);
    });

  return [...due, ...rest].slice(0, Math.max(0, limit));
}
