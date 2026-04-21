import type { Card, Deck, Grade } from '../types';

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

export type DecksResponse = {
  decks: Array<Deck & { dueCount?: number }>;
};

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function createAnkiApi(getToken: () => string | null, getBase: () => string) {
  async function request<T>(
    path: string,
    init: RequestInit & { parse?: 'json' | 'none' } = {}
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
    const res = await fetch(url, { ...init, headers });
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
    async listDecks(): Promise<DecksResponse> {
      return request<DecksResponse>('/decks');
    },

    async createDeck(name: string): Promise<Deck> {
      const r = await request<{ id: string; name: string; createdAt: number }>('/decks', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      return { id: r.id, name: r.name, createdAt: r.createdAt };
    },

    async updateDeck(id: string, name: string): Promise<void> {
      await request(`/decks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
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

    async createCard(deckId: string, front: string, back: string): Promise<Card> {
      return request<Card>('/cards', {
        method: 'POST',
        body: JSON.stringify({ deckId, front, back }),
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
