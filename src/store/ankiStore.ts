import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Card, Deck, DeckFieldSchema, Grade } from '../types';
import { createAnkiApi, defaultApiBase, type SyncOperation, type SyncResult } from '../api/ankiApi';
import { calculateNextReview } from '../utils/sm2';
import {
  emptySnapshot,
  enqueuePendingOp,
  loadSnapshot,
  mergeCardsIntoSnapshot,
  pickDueCardsFromSnapshot,
  pickTrainingCardsFromSnapshot,
  recomputeDeckDueCounts,
  removePendingOps,
  replaceDecksInSnapshot,
  replacePendingOp,
  saveSnapshot,
  upsertCardInSnapshot,
  type OfflineSnapshot,
} from '../offline/ankiOfflineCache';
import { ConnectivityService, type ConnectivityState } from '../offline/connectivity';

const PREFETCH_LIMIT = 100;
const REFILL_THRESHOLD = 20;
const OFFLINE_TRAINING_TARGET = 100;
const FLUSH_BATCH_SIZE = 25;

function isLikelyNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|failed to load|load failed|aborted|timeout/i.test(msg)) return true;
  if (/HTTP\s+5\d\d|HTTP\s+0\b|Service Unavailable|Bad Gateway|Gateway Timeout/i.test(msg)) return true;
  return false;
}

function makeOpId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useAnkiStore = defineStore('ankiStore', () => {
  const authToken = ref<string | null>(null);
  const apiBase = ref(defaultApiBase());
  const decks = ref<Deck[]>([]);
  const trainingQueue = ref<Card[]>([]);
  const dueNextCursor = ref<string | null>(null);
  const trainingDeckId = ref<string | 'all' | null>(null);
  const trainingFetchAll = ref(false);
  const offlineDueBuffer = ref<Card[]>([]);
  const isLoading = ref(false);
  const lastError = ref<string | null>(null);
  const usingOfflineDecks = ref(false);
  const trainingFromCache = ref(false);
  const pendingReviewCount = ref(0);
  const connectivityState = ref<ConnectivityState>('degraded');
  const syncState = ref<'idle' | 'syncing' | 'error'>('idle');
  const isFlushingPendingOps = ref(false);

  const api = computed(() =>
    createAnkiApi(
      () => authToken.value,
      () => apiBase.value
    )
  );

  let connectivity: ConnectivityService | null = null;

  function getSnap(): OfflineSnapshot {
    return loadSnapshot(authToken.value) ?? emptySnapshot();
  }

  function persistSnapshot(next: OfflineSnapshot): void {
    saveSnapshot(authToken.value, next);
    pendingReviewCount.value = next.pendingOps.length;
  }

  function syncPendingCountFromStorage(): void {
    pendingReviewCount.value = getSnap().pendingOps.length;
  }

  function clearError() {
    lastError.value = null;
  }

  const showOfflineHint = computed(
    () =>
      usingOfflineDecks.value ||
      trainingFromCache.value ||
      pendingReviewCount.value > 0 ||
      connectivityState.value !== 'online'
  );

  function queueOp(op: SyncOperation) {
    persistSnapshot(enqueuePendingOp(getSnap(), op));
  }

  function updateDeckIdEverywhere(tempId: string, realId: string) {
    decks.value = decks.value.map((d) => (d.id === tempId ? { ...d, id: realId } : d));
    trainingQueue.value = trainingQueue.value.map((c) =>
      c.deckId === tempId ? { ...c, deckId: realId } : c
    );
    offlineDueBuffer.value = offlineDueBuffer.value.map((c) =>
      c.deckId === tempId ? { ...c, deckId: realId } : c
    );

    const snap = getSnap();
    const cardsById = Object.fromEntries(
      Object.entries(snap.cardsById).map(([id, card]) => [
        id,
        card.deckId === tempId ? { ...card, deckId: realId } : card,
      ])
    );
    const pendingOps = snap.pendingOps.map((op) => {
      const payloadDeckId = typeof op.payload.deckId === 'string' ? op.payload.deckId : '';
      return {
        ...op,
        entityId: op.entityId === tempId ? realId : op.entityId,
        payload: payloadDeckId === tempId ? { ...op.payload, deckId: realId } : op.payload,
      };
    });
    persistSnapshot({ ...snap, cardsById, pendingOps, decks: decks.value });
  }

  function applySyncResult(op: SyncOperation, result: SyncResult) {
    if (result.status !== 'applied') return;
    const data = result.data ?? {};
    if (op.type === 'review-submit' && data.card) {
      persistSnapshot(upsertCardInSnapshot(getSnap(), data.card as Card));
      return;
    }
    if (op.type === 'deck-create' && data.deck) {
      const deck = data.deck as Deck;
      updateDeckIdEverywhere(op.entityId, deck.id);
      if (!decks.value.find((d) => d.id === deck.id)) {
        decks.value.push(deck);
      }
      persistSnapshot(replaceDecksInSnapshot(getSnap(), decks.value));
      return;
    }
    if (op.type === 'deck-update' && data.deck) {
      const deck = data.deck as Deck;
      decks.value = decks.value.map((d) => (d.id === deck.id ? { ...d, ...deck } : d));
      persistSnapshot(replaceDecksInSnapshot(getSnap(), decks.value));
      return;
    }
    if (op.type === 'card-create' && data.card) {
      const card = data.card as Card;
      let snap = getSnap();
      if (snap.cardsById[op.entityId]) {
        const cardsById = { ...snap.cardsById };
        delete cardsById[op.entityId];
        snap = { ...snap, cardsById };
      }
      snap = upsertCardInSnapshot(snap, card);
      persistSnapshot(snap);
      trainingQueue.value = trainingQueue.value.map((c) => (c.id === op.entityId ? card : c));
    }
  }

  async function loadDecks(): Promise<void> {
    clearError();
    isLoading.value = true;
    try {
      const { decks: rows } = await api.value.listDecks();
      decks.value = rows.map((d) => ({
        id: d.id,
        name: d.name,
        fieldSchema: d.fieldSchema,
        createdAt: d.createdAt,
        dueCount: d.dueCount,
      }));
      usingOfflineDecks.value = false;
      persistSnapshot(replaceDecksInSnapshot(getSnap(), decks.value));
    } catch (e) {
      const snap = getSnap();
      if (snap.decks.length > 0) {
        decks.value = recomputeDeckDueCounts(snap, Date.now());
        usingOfflineDecks.value = true;
        lastError.value = null;
        return;
      }
      lastError.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function flushPendingOps(): Promise<void> {
    if (!authToken.value) return;
    if (isFlushingPendingOps.value) return;
    if (connectivityState.value === 'offline') return;

    isFlushingPendingOps.value = true;
    syncState.value = 'syncing';
    connectivity?.markSyncing();
    try {
      while (true) {
        let snap = getSnap();
        if (snap.pendingOps.length === 0) {
          syncState.value = 'idle';
          connectivity?.markOnline();
          break;
        }
        const batch = snap.pendingOps.slice(0, FLUSH_BATCH_SIZE);
        const { results } = await api.value.syncBatch(batch);
        const removeIds: string[] = [];
        let stop = false;

        for (const result of results) {
          const op = batch.find((it) => it.opId === result.opId);
          if (!op) continue;
          if (result.status === 'applied') {
            applySyncResult(op, result);
            removeIds.push(op.opId);
            continue;
          }
          if (result.status === 'rejected') {
            removeIds.push(op.opId);
            lastError.value = result.error ?? 'Операция отклонена сервером';
            continue;
          }
          persistSnapshot(replacePendingOp(getSnap(), { ...op, attempts: (op.attempts ?? 0) + 1 }));
          stop = true;
        }

        snap = removePendingOps(getSnap(), removeIds);
        persistSnapshot(snap);
        if (stop) {
          syncState.value = 'error';
          connectivity?.markDegraded();
          break;
        }
      }
      try {
        await loadDecks();
      } catch {
        /* noop */
      }
    } catch (e) {
      syncState.value = 'error';
      connectivity?.markOffline();
      if (!isLikelyNetworkError(e)) {
        lastError.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      isFlushingPendingOps.value = false;
    }
  }

  async function flushPendingReviews(): Promise<void> {
    await flushPendingOps();
  }

  function startConnectivityLoop() {
    if (typeof window === 'undefined' || !authToken.value) return;
    connectivity?.stop();
    connectivity = new ConnectivityService(
      async () => {
        await api.value.ping();
      },
      (next) => {
        connectivityState.value = next;
        if (next === 'online') {
          void flushPendingOps();
        }
      }
    );
    connectivity.start();
  }

  function setAuth(token: string | null, baseUrl?: string | null) {
    authToken.value = token;
    if (baseUrl !== undefined && baseUrl !== null && String(baseUrl).trim()) {
      apiBase.value = String(baseUrl).replace(/\/$/, '');
    }
    syncPendingCountFromStorage();
    if (token) {
      startConnectivityLoop();
      queueMicrotask(() => {
        void flushPendingOps();
      });
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      connectivity?.start();
      void flushPendingOps();
    });
    window.addEventListener('offline', () => {
      connectivityState.value = 'offline';
    });
    window.addEventListener('focus', () => {
      void flushPendingOps();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void flushPendingOps();
      }
    });
  }

  async function addDeck(name: string, fieldSchema?: DeckFieldSchema): Promise<void> {
    clearError();
    isLoading.value = true;
    try {
      if (connectivityState.value === 'online') {
        const d = await api.value.createDeck(name, fieldSchema);
        decks.value.push({ ...d, dueCount: 0 });
        persistSnapshot(replaceDecksInSnapshot(getSnap(), decks.value));
        return;
      }
      const tempId = `local-deck-${makeOpId('deck')}`;
      const createdAt = Date.now();
      decks.value.push({ id: tempId, name, fieldSchema, createdAt, dueCount: 0 });
      queueOp({
        opId: makeOpId('deck-create'),
        type: 'deck-create',
        entityId: tempId,
        payload: { name, fieldSchema },
        clientTs: createdAt,
      });
      persistSnapshot(replaceDecksInSnapshot(getSnap(), decks.value));
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateDeck(deckId: string, payload: { name?: string; fieldSchema?: DeckFieldSchema }): Promise<void> {
    clearError();
    isLoading.value = true;
    try {
      if (connectivityState.value === 'online') {
        await api.value.updateDeck(deckId, payload);
      } else {
        queueOp({
          opId: makeOpId('deck-update'),
          type: 'deck-update',
          entityId: deckId,
          payload: { ...payload, deckId },
          clientTs: Date.now(),
        });
      }
      const d = decks.value.find((x) => x.id === deckId);
      if (d && payload.name) d.name = payload.name;
      if (d && payload.fieldSchema) d.fieldSchema = payload.fieldSchema;
      persistSnapshot(replaceDecksInSnapshot(getSnap(), decks.value));
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function addCard(deckId: string, fields: Record<string, string>): Promise<void> {
    clearError();
    isLoading.value = true;
    try {
      if (connectivityState.value === 'online') {
        const created = await api.value.createCard(deckId, fields);
        persistSnapshot(mergeCardsIntoSnapshot(getSnap(), [created]));
        await loadDecks();
        return;
      }

      const tempId = `local-card-${makeOpId('card')}`;
      const local: Card = {
        id: tempId,
        deckId,
        front: fields.front ?? '',
        back: fields.back ?? '',
        fields: { ...fields },
        status: 'new',
        step: 0,
        dueDate: 0,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
      };
      persistSnapshot(mergeCardsIntoSnapshot(getSnap(), [local]));
      queueOp({
        opId: makeOpId('card-create'),
        type: 'card-create',
        entityId: tempId,
        payload: { deckId, fields },
        clientTs: Date.now(),
      });
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  function resetTrainingQueue() {
    trainingQueue.value = [];
    dueNextCursor.value = null;
    offlineDueBuffer.value = [];
    trainingFromCache.value = false;
  }

  function buildOfflineTrainingQueues(deckId: string | 'all'): { initial: Card[]; rest: Card[] } {
    const snap = getSnap();
    const now = Date.now();
    const due =
      deckId === 'all'
        ? pickTrainingCardsFromSnapshot(snap, deckId, now, OFFLINE_TRAINING_TARGET)
        : pickDueCardsFromSnapshot(snap, deckId, now);
    return {
      initial: due.slice(0, PREFETCH_LIMIT),
      rest: due.slice(PREFETCH_LIMIT),
    };
  }

  async function beginTrainingSession(deckId: string | 'all', opts?: { fetchAllDue?: boolean }): Promise<void> {
    clearError();
    trainingDeckId.value = deckId;
    trainingFetchAll.value = !!opts?.fetchAllDue;
    resetTrainingQueue();
    isLoading.value = true;
    trainingFromCache.value = false;

    const tryNetwork = async (): Promise<boolean> => {
      if (connectivityState.value !== 'online') return false;
      try {
        const queue: Card[] = [];
        const queueIds = new Set<string>();
        const target = deckId === 'all' ? OFFLINE_TRAINING_TARGET : PREFETCH_LIMIT;
        const page = await api.value.fetchTrainingCards({
          deckId: deckId === 'all' ? null : deckId,
          limit: target,
        });
        for (const card of page.cards) {
          if (queueIds.has(card.id)) continue;
          queue.push(card);
          queueIds.add(card.id);
        }

        let snap = mergeCardsIntoSnapshot(getSnap(), queue);
        if (deckId === 'all' && queue.length < OFFLINE_TRAINING_TARGET) {
          const fallback = pickTrainingCardsFromSnapshot(snap, 'all', Date.now(), OFFLINE_TRAINING_TARGET);
          for (const card of fallback) {
            if (queueIds.has(card.id)) continue;
            queue.push(card);
            queueIds.add(card.id);
          }
          snap = mergeCardsIntoSnapshot(snap, queue);
        }
        persistSnapshot(snap);
        trainingQueue.value = queue.slice(0, target);
        dueNextCursor.value = null;
        offlineDueBuffer.value = [];
        try {
          await flushPendingOps();
        } catch {
          /* noop */
        }
        return true;
      } catch (e) {
        if (!isLikelyNetworkError(e)) {
          lastError.value = e instanceof Error ? e.message : String(e);
          throw e;
        }
        return false;
      }
    };

    try {
      const ok = await tryNetwork();
      if (ok) return;
      const { initial, rest } = buildOfflineTrainingQueues(deckId);
      if (initial.length === 0) {
        const msg = 'Нет сохранённых карточек для оффлайна. Откройте приложение онлайн хотя бы раз, чтобы загрузить колоду.';
        lastError.value = msg;
        throw new Error(msg);
      }
      trainingQueue.value = initial;
      offlineDueBuffer.value = rest;
      dueNextCursor.value = null;
      trainingFromCache.value = true;
      lastError.value = null;
    } finally {
      isLoading.value = false;
    }
  }

  async function maybeRefillTrainingQueue(): Promise<void> {
    if (trainingDeckId.value === 'all') return;
    if (trainingQueue.value.length > REFILL_THRESHOLD) return;

    if (offlineDueBuffer.value.length > 0) {
      const chunk = offlineDueBuffer.value.splice(0, Math.min(PREFETCH_LIMIT, offlineDueBuffer.value.length));
      trainingQueue.value = [...trainingQueue.value, ...chunk];
      return;
    }

    if (connectivityState.value !== 'online') return;
    clearError();
    try {
      const deckId = trainingDeckId.value;
      const loaded = dueNextCursor.value
        ? await api.value.fetchDueCards({
            deckId: deckId && deckId !== 'all' ? deckId : null,
            limit: PREFETCH_LIMIT,
            cursor: dueNextCursor.value,
            all: trainingFetchAll.value,
          })
        : {
            cards: (
              await api.value.fetchTrainingCards({
                deckId: deckId && deckId !== 'all' ? deckId : null,
                limit: PREFETCH_LIMIT,
              })
            ).cards,
            nextCursor: null,
          };
      persistSnapshot(mergeCardsIntoSnapshot(getSnap(), loaded.cards));
      const existing = new Set(trainingQueue.value.map((c) => c.id));
      for (const c of loaded.cards) {
        if (!existing.has(c.id)) {
          trainingQueue.value.push(c);
          existing.add(c.id);
        }
      }
      dueNextCursor.value = loaded.nextCursor;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
    }
  }

  const currentTrainingCard = computed(() => trainingQueue.value[0] ?? null);

  function applyLocalReview(card: Card, grade: Grade): Card {
    const partial = calculateNextReview(card, grade);
    return { ...card, ...partial };
  }

  async function reviewCardInSession(cardId: string, grade: Grade): Promise<void> {
    clearError();
    isLoading.value = true;
    try {
      const fromQueue = trainingQueue.value.find((c) => c.id === cardId) ?? getSnap().cardsById[cardId];
      if (!fromQueue) throw new Error('Карточка не найдена');

      if (connectivityState.value === 'online') {
        try {
          const { card: updated } = await api.value.submitReview(cardId, grade);
          persistSnapshot(upsertCardInSnapshot(getSnap(), updated));
          if (trainingQueue.value[0]?.id === cardId) {
            trainingQueue.value = trainingQueue.value.slice(1);
          } else {
            trainingQueue.value = trainingQueue.value.filter((c) => c.id !== cardId);
          }
          await maybeRefillTrainingQueue();
          try {
            await loadDecks();
          } catch {
            decks.value = recomputeDeckDueCounts(getSnap(), Date.now());
            usingOfflineDecks.value = true;
          }
          await flushPendingOps();
          return;
        } catch (e) {
          if (!isLikelyNetworkError(e)) {
            lastError.value = e instanceof Error ? e.message : String(e);
            throw e;
          }
        }
      }

      const updated = applyLocalReview(fromQueue, grade);
      persistSnapshot(upsertCardInSnapshot(getSnap(), updated));
      queueOp({
        opId: makeOpId('review-submit'),
        type: 'review-submit',
        entityId: cardId,
        payload: { cardId, grade },
        clientTs: Date.now(),
      });
      if (trainingQueue.value[0]?.id === cardId) {
        trainingQueue.value = trainingQueue.value.slice(1);
      } else {
        trainingQueue.value = trainingQueue.value.filter((c) => c.id !== cardId);
      }
      await maybeRefillTrainingQueue();
      decks.value = recomputeDeckDueCounts(getSnap(), Date.now());
      usingOfflineDecks.value = true;
      if (connectivityState.value === 'online') {
        void flushPendingOps();
      }
    } finally {
      isLoading.value = false;
    }
  }

  function dueCountForDeck(deckId: string): number {
    const d = decks.value.find((x) => x.id === deckId);
    return d?.dueCount ?? 0;
  }

  return {
    authToken,
    apiBase,
    decks,
    trainingQueue,
    dueNextCursor,
    trainingDeckId,
    trainingFetchAll,
    offlineDueBuffer,
    isLoading,
    lastError,
    usingOfflineDecks,
    trainingFromCache,
    pendingReviewCount,
    connectivityState,
    syncState,
    isFlushingPendingOps,
    showOfflineHint,
    setAuth,
    clearError,
    loadDecks,
    addDeck,
    updateDeck,
    addCard,
    beginTrainingSession,
    maybeRefillTrainingQueue,
    currentTrainingCard,
    reviewCardInSession,
    dueCountForDeck,
    resetTrainingQueue,
    flushPendingOps,
    flushPendingReviews,
  };
});
