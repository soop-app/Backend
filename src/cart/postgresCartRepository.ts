import type pg from 'pg';
import {
  CART_MAX,
  DEFAULT_CART_SETTINGS,
  sameSet,
  type CartItem,
  type CartRepository,
  type CartSettings,
  type PlaceSnapshot,
  type Transport,
} from './cartRepository.js';

interface SettingsRow {
  start_name: string | null;
  start_lat: number | null;
  start_lng: number | null;
  transport: Transport;
  budget_min: number | null;
  budget_max: number | null;
}

interface CartRow {
  place_key: string;
  place_snapshot: PlaceSnapshot;
  pinned: boolean;
  added_at: Date;
}

const toItem = (r: CartRow): CartItem => ({
  placeId: r.place_key,
  place: r.place_snapshot,
  pinned: r.pinned,
  addedAt: r.added_at.toISOString(),
});

export class PostgresCartRepository implements CartRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(userId: string): Promise<CartItem[]> {
    const { rows } = await this.pool.query<CartRow>(
      `SELECT place_key, place_snapshot, pinned, added_at FROM cart_items
       WHERE user_id = $1 ORDER BY position, added_at`,
      [userId],
    );
    return rows.map(toItem);
  }

  async add(userId: string, item: CartItem) {
    return this.tx(async (c) => {
      // 같은 사용자의 동시 요청이 최대 개수를 넘기지 않도록 잠금
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      const { rows } = await c.query<{ place_key: string; position: number }>(
        'SELECT place_key, position FROM cart_items WHERE user_id = $1',
        [userId],
      );
      if (rows.some((r) => r.place_key === item.placeId)) return 'exists' as const;
      if (rows.length >= CART_MAX) return 'full' as const;
      const next = rows.reduce((m, r) => Math.max(m, r.position + 1), 0);
      await c.query(
        `INSERT INTO cart_items (user_id, place_key, place_snapshot, position, pinned, added_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, item.placeId, JSON.stringify(item.place), next, item.pinned, item.addedAt],
      );
      return 'added' as const;
    });
  }

  async remove(userId: string, placeId: string) {
    const r = await this.pool.query('DELETE FROM cart_items WHERE user_id = $1 AND place_key = $2', [userId, placeId]);
    return (r.rowCount ?? 0) > 0;
  }

  async setPinned(userId: string, placeId: string, pinned: boolean) {
    const r = await this.pool.query('UPDATE cart_items SET pinned = $3 WHERE user_id = $1 AND place_key = $2', [
      userId,
      placeId,
      pinned,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async reorder(userId: string, placeIds: string[]) {
    return this.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      const { rows } = await c.query<{ place_key: string }>('SELECT place_key FROM cart_items WHERE user_id = $1', [
        userId,
      ]);
      if (!sameSet(placeIds, rows.map((r) => r.place_key))) return false;
      for (const [i, id] of placeIds.entries()) {
        await c.query('UPDATE cart_items SET position = $3 WHERE user_id = $1 AND place_key = $2', [userId, id, i]);
      }
      return true;
    });
  }

  async getSettings(userId: string): Promise<CartSettings> {
    const { rows } = await this.pool.query<SettingsRow>(
      `SELECT start_name, start_lat, start_lng, transport, budget_min, budget_max
       FROM cart_settings WHERE user_id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) return structuredClone(DEFAULT_CART_SETTINGS);
    return {
      start:
        r.start_name !== null && r.start_lat !== null && r.start_lng !== null
          ? { name: r.start_name, lat: r.start_lat, lng: r.start_lng }
          : null,
      transport: r.transport,
      budgetMin: r.budget_min,
      budgetMax: r.budget_max,
    };
  }

  async saveSettings(userId: string, s: CartSettings): Promise<void> {
    await this.pool.query(
      `INSERT INTO cart_settings (user_id, start_name, start_lat, start_lng, transport, budget_min, budget_max, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_id) DO UPDATE SET
         start_name = EXCLUDED.start_name, start_lat = EXCLUDED.start_lat, start_lng = EXCLUDED.start_lng,
         transport = EXCLUDED.transport, budget_min = EXCLUDED.budget_min, budget_max = EXCLUDED.budget_max,
         updated_at = now()`,
      [userId, s.start?.name ?? null, s.start?.lat ?? null, s.start?.lng ?? null, s.transport, s.budgetMin, s.budgetMax],
    );
  }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
}
