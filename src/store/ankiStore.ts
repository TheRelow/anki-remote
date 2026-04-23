// src/store/ankiStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Deck, Card, DeckFieldSchema, Grade } from '../types';
import { createAnkiApi, defaultApiBase } from '../api/ankiApi';
import { calculateNextReview } from '../utils/sm2';
import {
  loadSnapshot,
  saveSnapshot,
  emptySnapshot,
  mergeCardsIntoSnapshot,
  replaceDecksInSnapshot,
  upsertCardInSnapshot,
  enqueueReview,
  shiftPendingReview,
  pickDueCardsFromSnapshot,
  pickTrainingCardsFromSnapshot,
  recomputeDeckDueCounts,
  type OfflineSnapshot,
} from '../offline/ankiOfflineCache';

const PREFETCH_LIMIT = 100;
const REFILL_THRESHOLD = 20;
const OFFLINE_TRAINING_TARGET = 100;

function isLikelyNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|failed to load|load failed|aborted|timeout/i.test(msg)) return true;
  if (/HTTP\s+5\d\d|HTTP\s+0\b|Service Unavailable|Bad Gateway|Gateway Timeout/i.test(msg)) return true;
  return false;
}

export const useAnkiStore = defineStore('ankiStore', () => {
  const authToken = ref<string | null>(null);
  const apiBase = ref(defaultApiBase());

  const decks = ref<Deck[]>([]);
  const trainingQueue = ref<Card[]>([]);
  const dueNextCursor = ref<string | null>(null);
  const trainingDeckId = ref<string | 'all' | null>(null);
  const trainingFetchAll = ref(false);
  /** Остаток due-карточек из кэша для дозаполнения очереди без API */
  const offlineDueBuffer = ref<Card[]>([]);

  const isLoading = ref(false);
  const lastError = ref<string | null>(null);
  /** Список колод взят из localStorage (сеть недоступна) */
  const usingOfflineDecks = ref(false);
  /** Сессия тренировки стартовала с кэша (fetch due не удался) */
  const trainingFromCache = ref(false);
  const pendingReviewCount = ref(0);

  const api = computed(() =>
    createAnkiApi(
      () => authToken.value,
      () => apiBase.value
    )
  );

  function getSnap(): OfflineSnapshot {
    return loadSnapshot(authToken.value) ?? emptySnapshot();
  }

  function persistSnapshot(next: OfflineSnapshot): void {
    saveSnapshot(authToken.value, next);
    pendingReviewCount.value = next.pendingReviews.length;
  }

  function syncPendingCountFromStorage(): void {
    pendingReviewCount.value = getSnap().pendingReviews.length;
  }

  function setAuth(token: string | null, baseUrl?: string | null) {
    authToken.value = token;
    if (baseUrl !== undefined && baseUrl !== null && String(baseUrl).trim()) {
      apiBase.value = String(baseUrl).replace(/\/$/, '');
    }
    syncPendingCountFromStorage();
    if (typeof window !== 'undefined' && token) {
      queueMicrotask(() => {
        void flushPendingReviews();
      });
    }
  }

  function clearError() {
    lastError.value = null;
  }

  const showOfflineHint = computed(
    () => usingOfflineDecks.value || trainingFromCache.value || pendingReviewCount.value > 0
  );

  async function flushPendingReviews(): Promise<void> {
    const token = authToken.value;
    if (!token) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    let snap = getSnap();
    while (snap.pendingReviews.length > 0) {
      const head = snap.pendingReviews[0];
      try {
        const { card } = await api.value.submitReview(head.cardId, head.grade);
        snap = upsertCardInSnapshot(snap, card);
        snap = shiftPendingReview(snap);
        saveSnapshot(token, snap);
        pendingReviewCount.value = snap.pendingReviews.length;
      } catch {
        break;
      }
    }

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
      snap = replaceDecksInSnapshot(getSnap(), decks.value);
      saveSnapshot(token, snap);
    } catch {
      /* оставляем UI как есть */
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void flushPendingReviews();
    });
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
      const snap = replaceDecksInSnapshot(getSnap(), decks.value);
      persistSnapshot(snap);
    } catch (e) {
      const snap = loadSnapshot(authToken.value);
      if (snap && snap.decks.length > 0) {
        const now = Date.now();
        decks.value = recomputeDeckDueCounts(snap, now);
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

  async function addDeck(name: string, fieldSchema?: DeckFieldSchema): Promise<void> {
    clearError();
    isLoading.value = true;
    try {
      const d = await api.value.createDeck(name, fieldSchema);
      decks.value.push({ ...d, dueCount: 0 });
      const snap = replaceDecksInSnapshot(getSnap(), decks.value);
      persistSnapshot(snap);
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
      await api.value.updateDeck(deckId, payload);
      const d = decks.value.find((x) => x.id === deckId);
      if (d && payload.name) d.name = payload.name;
      if (d && payload.fieldSchema) d.fieldSchema = payload.fieldSchema;
      const snap = replaceDecksInSnapshot(getSnap(), decks.value);
      persistSnapshot(snap);
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
      const created = await api.value.createCard(deckId, fields);
      const snap = mergeCardsIntoSnapshot(getSnap(), [created]);
      persistSnapshot(snap);
      await loadDecks();
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

  async function beginTrainingSession(
    deckId: string | 'all',
    opts?: { fetchAllDue?: boolean }
  ): Promise<void> {
    clearError();
    trainingDeckId.value = deckId;
    trainingFetchAll.value = !!opts?.fetchAllDue;
    resetTrainingQueue();
    isLoading.value = true;
    trainingFromCache.value = false;

    const tryNetwork = async (): Promise<boolean> => {
      try {
        const queue: Card[] = [];
        const queueIds = new Set<string>();
        const target =
          deckId === 'all' ? OFFLINE_TRAINING_TARGET : PREFETCH_LIMIT;
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
          const fallback = pickTrainingCardsFromSnapshot(
            snap,
            'all',
            Date.now(),
            OFFLINE_TRAINING_TARGET
          );
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
          await flushPendingReviews();
        } catch {
          /* очередь синхронизации — позже, сессия тренировки уже загружена */
        }
        return true;
      } catch (e) {
        if (!isLikelyNetworkError(e) && !(typeof navigator !== 'undefined' && !navigator.onLine)) {
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
        const msg =
          'Нет сохранённых карточек для оффлайна. Откройте приложение онлайн хотя бы раз, чтобы загрузить колоду.';
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
      const chunk = offlineDueBuffer.value.splice(
        0,
        Math.min(PREFETCH_LIMIT, offlineDueBuffer.value.length)
      );
      trainingQueue.value = [...trainingQueue.value, ...chunk];
      return;
    }

    clearError();
    try {
      const deckId = trainingDeckId.value;
      const loaded =
        dueNextCursor.value
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
      const snap = mergeCardsIntoSnapshot(getSnap(), loaded.cards);
      persistSnapshot(snap);
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
      const fromQueue =
        trainingQueue.value.find((c) => c.id === cardId) ?? getSnap().cardsById[cardId];
      if (!fromQueue) {
        throw new Error('Карточка не найдена');
      }

      const goOffline = typeof navigator !== 'undefined' && !navigator.onLine;

      if (!goOffline) {
        try {
          const { card: updated } = await api.value.submitReview(cardId, grade);
          const snap = upsertCardInSnapshot(getSnap(), updated);
          persistSnapshot(snap);
          if (trainingQueue.value[0]?.id === cardId) {
            trainingQueue.value = trainingQueue.value.slice(1);
          } else {
            trainingQueue.value = trainingQueue.value.filter((c) => c.id !== cardId);
          }
          await maybeRefillTrainingQueue();
          try {
            await loadDecks();
          } catch {
            const s = getSnap();
            const now = Date.now();
            decks.value = recomputeDeckDueCounts(s, now);
            usingOfflineDecks.value = true;
          }
          await flushPendingReviews();
          return;
        } catch (e) {
          if (!isLikelyNetworkError(e)) {
            lastError.value = e instanceof Error ? e.message : String(e);
            throw e;
          }
        }
      }

      const updated = applyLocalReview(fromQueue, grade);
      let snap = upsertCardInSnapshot(getSnap(), updated);
      snap = enqueueReview(snap, cardId, grade);
      persistSnapshot(snap);

      if (trainingQueue.value[0]?.id === cardId) {
        trainingQueue.value = trainingQueue.value.slice(1);
      } else {
        trainingQueue.value = trainingQueue.value.filter((c) => c.id !== cardId);
      }
      await maybeRefillTrainingQueue();

      const s2 = getSnap();
      const now = Date.now();
      decks.value = recomputeDeckDueCounts(s2, now);
      usingOfflineDecks.value = true;

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        void flushPendingReviews();
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
    flushPendingReviews,
  };
});
