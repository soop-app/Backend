import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryPlaceRepository } from '../src/places/inMemoryPlaceRepository.js';
import { SEED_PLACES } from '../src/places/seedData.js';
import { KakaoTravelTimes, PARKING_MINUTES, type FetchLike, type TravelTimes } from '../src/routing/travelTimes.js';
import type { LatLng } from '../src/types.js';

const A = { lat: 37.5446, lng: 127.0557 };
const B = { lat: 37.545, lng: 127.0545 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(respond: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const fetchImpl: FetchLike = async (url) => {
    const u = new URL(url);
    calls.push(u);
    return respond(u);
  };
  const fallbacks: string[] = [];
  const c = new KakaoTravelTimes('test-key', fetchImpl, 1000, Date.now, (r) => fallbacks.push(r));
  return { c, calls, fallbacks };
}

describe('KakaoTravelTimes', () => {
  it('도보: dapi 도보 경로, 좌표는 경도,위도 순서, 초 → 분 올림', async () => {
    const { c, calls } = client(() => json({ routes: [{ result_code: 0, summary: { distance: 812, duration: 601 } }] }));
    const leg = await c.leg(A, B, 'walk');
    expect(leg).toEqual({ minutes: 11, distanceMeters: 812, estimated: false });
    expect(calls[0]!.origin + calls[0]!.pathname).toBe('https://dapi.kakao.com/v2/routing/walk');
    expect(calls[0]!.searchParams.get('origin')).toBe('127.0557,37.5446');
    expect(calls[0]!.searchParams.get('destination')).toBe('127.0545,37.545');
  });

  it('도보: 다른 응답 모양(summary 최상위)도 읽음', async () => {
    const { c } = client(() => json({ summary: { distance: 100, duration: 60 } }));
    expect(await c.leg(A, B, 'walk')).toEqual({ minutes: 1, distanceMeters: 100, estimated: false });
  });

  it('자동차: 카카오모빌리티 길찾기 + 주차 시간', async () => {
    const { c, calls } = client(() => json({ routes: [{ result_code: 0, summary: { distance: 3200, duration: 540 } }] }));
    const leg = await c.leg(A, B, 'car');
    expect(leg).toEqual({ minutes: 9 + PARKING_MINUTES, distanceMeters: 3200, estimated: false });
    expect(calls[0]!.host).toBe('apis-navi.kakaomobility.com');
  });

  it('자동차: 너무 가까우면(104) 0분', async () => {
    const { c } = client(() => json({ routes: [{ result_code: 104 }] }));
    expect(await c.leg(A, B, 'car')).toEqual({ minutes: 0, distanceMeters: 0, estimated: false });
  });

  it.each([
    ['형식이 다른 응답', () => json({ what: 1 })],
    ['경로 없음', () => json({ routes: [{ result_code: 1 }] })],
    ['쿼터 초과', () => json({}, 429)],
  ])('%s → 직선거리 추정으로 대신 (estimated: true)', async (_n, respond) => {
    const { c, fallbacks } = client(respond);
    const leg = await c.leg(A, B, 'walk');
    expect(leg.estimated).toBe(true);
    expect(leg.minutes).toBeGreaterThan(0);
    expect(fallbacks).toHaveLength(1);
  });

  it('네트워크 실패도 추정으로 대신', async () => {
    const c = new KakaoTravelTimes('k', async () => { throw new Error('ECONNRESET'); }, 1000, Date.now, () => {});
    expect((await c.leg(A, B, 'walk')).estimated).toBe(true);
  });

  it('같은 구간은 다시 부르지 않음 (캐시)', async () => {
    const { c, calls } = client(() => json({ routes: [{ result_code: 0, summary: { distance: 10, duration: 60 } }] }));
    await c.leg(A, B, 'walk');
    await c.leg(A, B, 'walk');
    await c.leg(B, A, 'walk'); // 반대 방향은 다른 구간
    expect(calls).toHaveLength(2);
  });
});

describe('최적 경로 + 실제 길찾기', () => {
  const USER = 'route-user-0001';
  /** 가짜 길찾기: 구간마다 정해 둔 시간 (모르면 10분) */
  const fakeTravel = (minutes: (from: LatLng, to: LatLng) => number) => {
    const leg = vi.fn(async (from: LatLng, to: LatLng) => ({ minutes: minutes(from, to), distanceMeters: 500, estimated: false }));
    return { leg } satisfies TravelTimes;
  };
  const appWithTravel = (travel: TravelTimes) =>
    createApp({ places: new InMemoryPlaceRepository(SEED_PLACES), kakao: null, travel, rateLimitPerMinute: 10_000 });

  const body = {
    date: '2026-11-14',
    startTime: '13:00',
    start: { name: '성수역 3번 출구', lat: 37.5446, lng: 127.0557 },
    transport: 'walk',
  };

  it('길찾기 값을 쓰면 estimated: false, 추정 안내 문구 없음, 도착 시각에 반영', async () => {
    const travel = fakeTravel(() => 7);
    const app = appWithTravel(travel);
    for (const id of ['db:1', 'db:8']) {
      await request(app).post('/api/cart/items').set('X-User-Id', USER).send({ placeId: id });
    }
    const res = await request(app).post('/api/courses/optimize').set('X-User-Id', USER).send(body);
    expect(res.status).toBe(200);
    for (const s of res.body.stops) expect(s.travelFromPrevious).toMatchObject({ minutes: 7, estimated: false });
    expect(res.body.stops[0].arriveAt).toBe('13:07');
    expect(res.body.summary.travelMinutes).toBe(14);
    expect(res.body.warnings.join(' ')).not.toMatch(/추정치/);
    // 순서가 정해진 구간만 길찾기 (모든 조합을 다 부르지 않음)
    expect(travel.leg.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('길찾기로 보니 더 오래 걸리는 순서면 다른 순서로 바꿈', async () => {
    // 직선거리로는 카페(db:1)가 가깝지만, 실제 길은 출발지 → 카페가 아주 오래 걸린다고 가정
    const cafe = SEED_PLACES.find((p) => p.id === 1)!;
    const travel = fakeTravel((from, to) => (from.lat === body.start.lat && to.lat === cafe.lat && to.lng === cafe.lng ? 60 : 5));
    const app = appWithTravel(travel);
    for (const id of ['db:1', 'db:8']) {
      await request(app).post('/api/cart/items').set('X-User-Id', USER).send({ placeId: id });
    }
    const res = await request(app).post('/api/courses/optimize').set('X-User-Id', USER).send(body);
    expect(res.body.stops.map((s: { placeId: string }) => s.placeId)).toEqual(['db:8', 'db:1']);
    for (const s of res.body.stops) expect(s.travelFromPrevious.estimated).toBe(false);
  });
});
