import type { Card, Deck, DeckFieldSchema, Grade } from '../types';

export function defaultApiBase(): string {
  const v = import.meta.env.VITE_ANKI_API_BASE;
  if (typeof v === 'string' && v.trim()) return v.replace(/\/$/, '');
  if (import.meta.env.DEV) return '/api/v1';
  return 'https://172.20.10.3:8787/api/v1';
}

export type DueCardsResponse = {
  cards: Card[];
  nextCursor: string | null;
};

export type TrainingCardsResponse = {
  cards: Card[];
};

export type DecksResponse = {
  decks: Array<Deck & { dueCount?: number }>;
};

export type SyncOpType = 'review-submit' | 'deck-create' | 'deck-update' | 'card-create';
export type SyncOperation = {
  opId: string;
  type: SyncOpType;
  entityId: string;
  payload: Record<string, unknown>;
  clientTs: number;
  attempts?: number;
};
export type SyncResultStatus = 'applied' | 'rejected' | 'retryable';
export type SyncResult = {
  opId: string;
  status: SyncResultStatus;
  error?: string;
  data?: Record<string, unknown>;
};

const REQUEST_TIMEOUT_MS = 8000;

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function createAnkiApi(getToken: () => string | null, getBase: () => string) {
  async function request<T>(
    path: string,
    init: RequestInit & { parse?: 'json' | 'none'; timeoutMs?: number } = {}
  ): Promise<T> {
    const token = getToken();
    if (!token) {
      throw new Error('Не задан токен авторизации');
    }
    const base = getBase().replace(/\/$/, '');
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: HeadersInit = {
      ...((init.headers as Record<string, string>) ?? {}),
      Authorization: `Bearer ${token}`,
    };
    if (init.body !== undefined && !('Content-Type' in (headers as Record<string, string>))) {
      (headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
    const timeoutMs =
      typeof (init as { timeoutMs?: number }).timeoutMs === 'number'
        ? Math.max(1, Number((init as { timeoutMs?: number }).timeoutMs))
        : REQUEST_TIMEOUT_MS;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('Request timeout')), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal: ctl.signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error('Network timeout');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const err = (await res.json()) as { message?: string; error?: string };
        msg = err.message ?? err.error ?? msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg || `HTTP ${res.status}`);
    }
    if (init.parse === 'none') {
      return undefined as T;
    }
    return parseJson<T>(res);
  }

  return {
    async ping(): Promise<{ ok: boolean; ts: number }> {
      return request<{ ok: boolean; ts: number }>('/sync/ping', { timeoutMs: 3000 });
    },

    async syncBatch(operations: SyncOperation[]): Promise<{ results: SyncResult[] }> {
      return request<{ results: SyncResult[] }>('/sync/batch', {
        method: 'POST',
        body: JSON.stringify({ operations }),
      });
    },

    async listDecks(): Promise<DecksResponse> {
      return request<DecksResponse>('/decks');
    },

    async createDeck(name: string, fieldSchema?: DeckFieldSchema): Promise<Deck> {
      const r = await request<{ id: string; name: string; fieldSchema?: DeckFieldSchema; createdAt: number }>('/decks', {
        method: 'POST',
        body: JSON.stringify({ name, fieldSchema }),
      });
      return { id: r.id, name: r.name, fieldSchema: r.fieldSchema, createdAt: r.createdAt };
    },

    async updateDeck(id: string, payload: { name?: string; fieldSchema?: DeckFieldSchema }): Promise<void> {
      await request(`/decks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },

    async fetchDueCards(params: {
      deckId?: string | null;
      limit: number;
      cursor?: string | null;
      all?: boolean;
    }): Promise<DueCardsResponse> {
      const q = new URLSearchParams();
      if (params.deckId && params.deckId !== 'all') {
        q.set('deckId', params.deckId);
      }
      q.set('limit', String(params.limit));
      if (params.cursor) q.set('cursor', params.cursor);
      if (params.all) q.set('all', 'true');
      const qs = q.toString();
      return request<DueCardsResponse>(`/cards/due${qs ? `?${qs}` : ''}`);
    },

    async fetchTrainingCards(params: {
      deckId?: string | null;
      limit: number;
    }): Promise<TrainingCardsResponse> {
      const q = new URLSearchParams();
      if (params.deckId && params.deckId !== 'all') {
        q.set('deckId', params.deckId);
      }
      q.set('limit', String(params.limit));
      const qs = q.toString();
      return request<TrainingCardsResponse>(`/cards/training${qs ? `?${qs}` : ''}`);
    },

    async createCard(deckId: string, fields: Record<string, string>): Promise<Card> {
      return request<Card>('/cards', {
        method: 'POST',
        body: JSON.stringify({ deckId, fields }),
      });
    },

    async submitReview(cardId: string, grade: Grade): Promise<{ card: Card }> {
      return request<{ card: Card }>('/reviews', {
        method: 'POST',
        body: JSON.stringify({ cardId, grade }),
      });
    },
  };
}

export type AnkiApi = ReturnType<typeof createAnkiApi>;
