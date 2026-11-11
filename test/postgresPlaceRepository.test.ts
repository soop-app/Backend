/**
 * 실제 PostgreSQL 연동 테스트.
 * TEST_DATABASE_URL 이 있을 때만 실행됩니다. (npm run db:setup 으로 예시 데이터를 넣은 DB)
 */
import pg from 'pg';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryPlaceRepository } from '../src/places/inMemoryPlaceRepository.js';
import { PostgresPlaceRepository } from '../src/places/postgresPlaceRepository.js';
import { SEED_PLACES } from '../src/places/seedData.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgresPlaceRepository (실제 DB)', () => {
  const pool = new pg.Pool({ connectionString: url });
  const pgRepo = new PostgresPlaceRepository(pool);
  const memRepo = new InMemoryPlaceRepository(SEED_PLACES);
  afterAll(() => pool.end());

  const strip = (ps: Array<{ id: number }>) =>
    ps.map(({ id: _id, ...rest }) => ({ ...rest, hours: [...(rest as { hours: { day: number }[] }).hours].sort((a, b) => a.day - b.day) }));

  it('지역 검색 결과가 메모리 버전과 같음 (영업시간 24:00 포함)', async () => {
    for (const region of ['성수', '홍대', '제주']) {
      expect(strip(await pgRepo.findActiveByRegion(region))).toEqual(strip(await memRepo.findActiveByRegion(region)));
    }
  });

  it('반경 검색 결과가 메모리 버전과 같음', async () => {
    const center = { lat: 37.5446, lng: 127.056 };
    for (const r of [300, 1500, 5000]) {
      expect(strip(await pgRepo.findActiveNear(center, r))).toEqual(strip(await memRepo.findActiveNear(center, r)));
    }
  });

  it('이름 검색: 부분 일치, %/_ 는 글자 그대로', async () => {
    expect((await pgRepo.findActiveByName('공방')).map((p) => p.name)).toEqual(['[예시] 성수 공방 체험']);
    expect(await pgRepo.findActiveByName('%')).toEqual([]);
    expect(await pgRepo.findActiveByName('_')).toEqual([]);
    expect(await pgRepo.findActiveByName('공방', '홍대')).toEqual([]);
  });

  it('SQL 인젝션 시도가 그냥 문자열로 처리됨', async () => {
    expect(await pgRepo.findActiveByName("' OR 1=1 --")).toEqual([]);
    expect(await pgRepo.findActiveByRegion("성수' OR '1'='1")).toEqual([]);
  });

  it('API 결과가 메모리 저장소와 똑같음', async () => {
    const body = { region: '성수', date: '2026-11-14', startTime: '13:00', endTime: '19:00', budget: 120000, transport: 'walk' };
    const a = await request(createApp({ places: pgRepo, kakao: null })).post('/api/courses/recommend').send(body);
    const b = await request(createApp({ places: memRepo, kakao: null })).post('/api/courses/recommend').send(body);
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });
});

describe.skipIf(!url)('PostgresCartRepository (실제 DB)', async () => {
  const { PostgresCartRepository } = await import('../src/cart/postgresCartRepository.js');
  const pool = new pg.Pool({ connectionString: url });
  const repo = new PostgresCartRepository(pool);
  const user = `pgtest-${Date.now()}`;
  afterAll(async () => {
    await pool.query('DELETE FROM cart_items WHERE user_id = $1', [user]);
    await pool.end();
  });
  const item = (n: number) => ({
    placeId: `db:${n}`,
    place: { id: `db:${n}`, name: `장소 ${n}` } as never,
    pinned: false,
    addedAt: new Date().toISOString(),
  });

  it('담기·중복·최대 5개·순서·고정·빼기', async () => {
    for (const n of [1, 2, 3, 4, 5]) expect(await repo.add(user, item(n))).toBe('added');
    expect(await repo.add(user, item(1))).toBe('exists');
    expect(await repo.add(user, item(6))).toBe('full');
    expect(await repo.reorder(user, ['db:5', 'db:4', 'db:3', 'db:2', 'db:1'])).toBe(true);
    expect(await repo.reorder(user, ['db:5'])).toBe(false);
    expect(await repo.setPinned(user, 'db:3', true)).toBe(true);
    expect(await repo.remove(user, 'db:4')).toBe(true);
    const list = await repo.list(user);
    expect(list.map((i) => i.placeId)).toEqual(['db:5', 'db:3', 'db:2', 'db:1']);
    expect(list[1]!.pinned).toBe(true);
    expect(list[0]!.place.name).toBe('장소 5');
  });

  it('동시에 6개를 담아도 5개까지만 들어감', async () => {
    const u = `${user}-race`;
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => repo.add(u, item(n))));
    expect(results.filter((r) => r === 'added')).toHaveLength(5);
    expect(results.filter((r) => r === 'full')).toHaveLength(1);
    await pool.query('DELETE FROM cart_items WHERE user_id = $1', [u]);
  });
});
