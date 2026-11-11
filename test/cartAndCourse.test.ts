import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { optimizeRoute, RouteNotPossibleError, type RoutePlace } from '../src/course/optimizeRoute.js';
import { parseHHmm } from '../src/time.js';
import { appWith, fakeKakao, kakaoPlace, OTHER_USER, USER } from './helpers.js';

const add = (app: ReturnType<typeof appWith>, placeId: string, user = USER) =>
  request(app).post('/api/cart/items').set('X-User-Id', user).send({ placeId });

describe('장바구니 /api/cart', () => {
  it('담기 → 목록(순서·합계) → 빼기', async () => {
    const app = appWith();
    await add(app, 'db:1');
    const res = await add(app, 'db:3');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ count: 2, max: 5, costPerPerson: 7500 + 21500, costForTwo: 58000, unknownPriceCount: 0 });
    expect(res.body.items.map((i: { placeId: string; order: number }) => [i.placeId, i.order])).toEqual([
      ['db:1', 1],
      ['db:3', 2],
    ]);
    const del = await request(app).delete('/api/cart/items/db:1').set('X-User-Id', USER);
    expect(del.body.items.map((i: { placeId: string }) => i.placeId)).toEqual(['db:3']);
  });

  it('같은 장소를 두 번 담아도 한 번만', async () => {
    const app = appWith();
    await add(app, 'db:1');
    const res = await add(app, 'db:1');
    expect(res.body.count).toBe(1);
  });

  it('최대 5개 → 6번째는 409 CART_FULL', async () => {
    const app = appWith();
    for (const id of [1, 2, 3, 4, 5]) await add(app, `db:${id}`);
    const res = await add(app, 'db:6');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CART_FULL');
  });

  it('사용자마다 장바구니가 따로', async () => {
    const app = appWith();
    await add(app, 'db:1');
    const other = await request(app).get('/api/cart').set('X-User-Id', OTHER_USER);
    expect(other.body.count).toBe(0);
  });

  it('필수 고정, 순서 바꾸기', async () => {
    const app = appWith();
    await add(app, 'db:1');
    await add(app, 'db:3');
    const pin = await request(app).patch('/api/cart/items/db:3').set('X-User-Id', USER).send({ pinned: true });
    expect(pin.body.items[1]).toMatchObject({ placeId: 'db:3', pinned: true });
    const re = await request(app).put('/api/cart/order').set('X-User-Id', USER).send({ placeIds: ['db:3', 'db:1'] });
    expect(re.body.items.map((i: { placeId: string }) => i.placeId)).toEqual(['db:3', 'db:1']);
    const bad = await request(app).put('/api/cart/order').set('X-User-Id', USER).send({ placeIds: ['db:3'] });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('CART_CHANGED');
  });

  it('카카오 장소는 최근 검색한 것만 담을 수 있음', async () => {
    const app = appWith(fakeKakao({ cafe: [kakaoPlace('111', '카카오 카페', 'cafe')] }, [kakaoPlace('0', '잠실', null)]));
    expect((await add(app, 'kakao:111')).status).toBe(404);
    await request(app).get('/api/places/search').query({ region: '잠실' });
    const res = await add(app, 'kakao:111');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ count: 1, unknownPriceCount: 1, costPerPerson: 0 });
  });

  it('X-User-Id 가 없거나 이상하면 400', async () => {
    const app = appWith();
    expect((await request(app).get('/api/cart')).body.error.code).toBe('USER_ID_REQUIRED');
    expect((await request(app).get('/api/cart').set('X-User-Id', 'a b')).status).toBe(400);
    expect((await request(app).get('/api/cart').set('X-User-Id', "'; DROP TABLE x;--")).status).toBe(400);
  });

  it('잘못된 placeId → 400, 없는 장소 → 404', async () => {
    const app = appWith();
    expect((await add(app, '1')).status).toBe(400);
    expect((await add(app, 'db:999')).status).toBe(404);
    expect((await request(app).delete('/api/cart/items/db:2').set('X-User-Id', USER)).status).toBe(404);
  });
});

const optimize = (app: ReturnType<typeof appWith>, body: object, user = USER) =>
  request(app).post('/api/courses/optimize').set('X-User-Id', user).send(body);

const base = {
  date: '2026-11-14', // 토요일
  startTime: '13:00',
  start: { name: '성수역 3번 출구', lat: 37.5446, lng: 127.0557 },
  transport: 'walk',
};

describe('장바구니 코스 설정 · 경로 입력 묶음', () => {
  const settings = {
    start: { name: '성수역 3번 출구', lat: 37.5447, lng: 127.0557 },
    transport: 'walk',
    budgetMin: 30000,
    budgetMax: 80000,
  };
  const put = (app: ReturnType<typeof appWith>, body: object, user = USER) =>
    request(app).put('/api/cart/settings').set('X-User-Id', user).send(body);

  it('처음엔 기본값(도보, 출발 위치·예산 없음)', async () => {
    const res = await request(appWith()).get('/api/cart').set('X-User-Id', USER);
    expect(res.body.settings).toEqual({ start: null, transport: 'walk', budgetMin: null, budgetMax: null });
    expect(res.body.budget).toEqual({ costForTwo: 0, budgetMax: null, remaining: null, overBudget: false });
  });

  it('설정 저장 → 예산 비교(2인 기준)', async () => {
    const app = appWith();
    await add(app, 'db:1'); // 1인 7,500
    await add(app, 'db:3'); // 1인 21,500
    const res = await put(app, settings);
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual(settings);
    expect(res.body.budget).toEqual({ costForTwo: 58000, budgetMax: 80000, remaining: 22000, overBudget: false });
    const over = await put(app, { ...settings, budgetMax: 50000 });
    expect(over.body.budget).toMatchObject({ remaining: -8000, overBudget: true });
    // 다른 사용자에게는 영향 없음
    const other = await request(app).get('/api/cart').set('X-User-Id', OTHER_USER);
    expect(other.body.settings.start).toBeNull();
  });

  it('출발 위치를 지울 수 있음(null)', async () => {
    const app = appWith();
    await put(app, settings);
    const res = await put(app, { ...settings, start: null, transport: 'car' });
    expect(res.body.settings).toMatchObject({ start: null, transport: 'car' });
  });

  it('잘못된 설정은 400', async () => {
    const app = appWith();
    expect((await put(app, { ...settings, transport: 'bus' })).status).toBe(400);
    expect((await put(app, { ...settings, budgetMin: 90000 })).status).toBe(400); // 최소 > 최대
    expect((await put(app, { ...settings, start: { name: '성수역' } })).status).toBe(400); // 좌표 없음
    expect((await put(app, { ...settings, extra: 1 })).status).toBe(400); // 모르는 필드
    const { budgetMax: _omit, ...missing } = settings;
    expect((await put(app, missing)).status).toBe(400); // 네 값 모두 필요
    expect((await request(app).put('/api/cart/settings').send(settings)).status).toBe(400); // X-User-Id 없음
  });

  it('route-input: 비었으면 ready=false + 모자란 값 알려줌', async () => {
    const res = await request(appWith()).get('/api/cart/route-input').set('X-User-Id', USER);
    expect(res.body).toMatchObject({ ready: false, missing: ['places', 'start'], places: [] });
  });

  it('route-input: 순서·좌표·필수 고정·설정을 한 번에', async () => {
    const app = appWith();
    await add(app, 'db:1');
    await add(app, 'db:3');
    await request(app).patch('/api/cart/items/db:3').set('X-User-Id', USER).send({ pinned: true });
    await request(app).put('/api/cart/order').set('X-User-Id', USER).send({ placeIds: ['db:3', 'db:1'] });
    await put(app, settings);
    const res = await request(app).get('/api/cart/route-input').set('X-User-Id', USER);
    expect(res.body).toMatchObject({
      ready: true,
      missing: [],
      start: settings.start,
      transport: 'walk',
      budgetMin: 30000,
      budgetMax: 80000,
    });
    expect(res.body.places.map((p: { order: number; placeId: string; pinned: boolean }) => [p.order, p.placeId, p.pinned])).toEqual([
      [1, 'db:3', true],
      [2, 'db:1', false],
    ]);
    const first = res.body.places[0];
    expect(typeof first.lat).toBe('number');
    expect(typeof first.lng).toBe('number');
    expect(first).toHaveProperty('stayMinutes');
    expect(first).toHaveProperty('pricePerPerson', 21500);
  });
});

describe('POST /api/courses/optimize', () => {
  it('담은 장소로 최적 경로: 시간이 이어지고, 영업시간 안, 비용·소요시간 합계', async () => {
    const app = appWith();
    for (const id of ['db:3', 'db:1', 'db:8']) await add(app, id);
    const res = await optimize(app, { ...base, budgetMin: 50000, budgetMax: 80000 });
    expect(res.status).toBe(200);
    const { stops, summary } = res.body;
    expect(stops).toHaveLength(3);
    let t = parseHHmm('13:00')!;
    let travel = 0;
    for (const s of stops) {
      const arrive = parseHHmm(s.arriveAt)!;
      expect(arrive).toBe(t + s.travelFromPrevious.minutes);
      expect(parseHHmm(s.leaveAt)! - parseHHmm(s.startAt)!).toBe(s.stayMinutes);
      expect(s.directionsUrl).toMatch(/^https:\/\/map\.kakao\.com\/link\/from\//);
      travel += s.travelFromPrevious.minutes;
      t = parseHHmm(s.leaveAt)!;
    }
    expect(summary).toMatchObject({
      startAt: '13:00',
      endAt: stops[2].leaveAt,
      totalMinutes: t - parseHHmm('13:00')!,
      travelMinutes: travel,
      placeCount: 3,
      costPerPerson: 21500 + 7500 + 12500,
      costForTwo: 83000,
      budgetMax: 80000,
      budgetLeft: -3000,
    });
    expect(res.body.warnings.join(' ')).toMatch(/예산을 넘어요/);
    expect(res.body.start).toMatchObject({ name: '성수역 3번 출구', departAt: '13:00' });
  });

  it('영업 안 하는 장소는 빠지고 이유를 알려줌 (월요일 휴무)', async () => {
    const app = appWith();
    for (const id of ['db:1', 'db:3']) await add(app, id);
    const res = await optimize(app, { ...base, date: '2026-11-16' });
    expect(res.body.stops.map((s: { placeId: string }) => s.placeId)).toEqual(['db:1']);
    expect(res.body.dropped).toEqual([
      { placeId: 'db:3', name: '[예시] 성수 파스타집', reason: '선택한 날짜·시간에 영업하지 않아서 뺐어요.' },
    ]);
  });

  it('필수 장소가 영업을 안 하면 409 COURSE_NOT_POSSIBLE', async () => {
    const app = appWith();
    await add(app, 'db:3');
    await request(app).patch('/api/cart/items/db:3').set('X-User-Id', USER).send({ pinned: true });
    const res = await optimize(app, { ...base, date: '2026-11-16' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'COURSE_NOT_POSSIBLE' });
    expect(res.body.error.message).toMatch(/파스타집/);
  });

  it('문 열기 전에 도착하면 기다렸다가 시작 (주점 17시 오픈)', async () => {
    const app = appWith();
    await add(app, 'db:4');
    const res = await optimize(app, { ...base, startTime: '16:30' });
    expect(res.body.stops[0]).toMatchObject({ startAt: '17:00' });
    expect(res.body.stops[0].waitMinutes).toBeGreaterThan(0);
    expect(res.body.warnings.join(' ')).toMatch(/기다려야/);
  });

  it('종료 시간 안에 다 못 넣으면 일부를 빼되 필수 장소는 남김', async () => {
    const app = appWith();
    for (const id of ['db:1', 'db:5', 'db:6']) await add(app, id);
    await request(app).patch('/api/cart/items/db:6').set('X-User-Id', USER).send({ pinned: true });
    const res = await optimize(app, { ...base, startTime: '14:00', endTime: '16:00' });
    const ids = res.body.stops.map((s: { placeId: string }) => s.placeId);
    expect(ids).toContain('db:6');
    expect(ids.length).toBeLessThan(3);
    expect(res.body.dropped.length).toBe(3 - ids.length);
  });

  it('출발 위치 이름만 보내면 카카오에서 찾음, 못 찾으면 404', async () => {
    const app = appWith(fakeKakao({}, [kakaoPlace('9', '성수역 3번출구', null, 37.5447, 127.0558)]));
    await add(app, 'db:1');
    const ok = await optimize(app, { ...base, start: { name: '성수역 3번 출구' } });
    expect(ok.status).toBe(200);
    expect(ok.body.start).toMatchObject({ lat: 37.5447, lng: 127.0558 });

    const noKakao = appWith();
    await add(noKakao, 'db:1');
    const fail = await optimize(noKakao, { ...base, start: { name: '어딘가' } });
    expect(fail.status).toBe(404);
  });

  it('장바구니가 비면 409 CART_EMPTY, 사용자 ID 없으면 400', async () => {
    const app = appWith();
    expect((await optimize(app, base)).body.error.code).toBe('CART_EMPTY');
    expect((await request(app).post('/api/courses/optimize').send(base)).status).toBe(400);
  });

  it.each([
    [{ ...base, date: '2026-02-30' }, 'date'],
    [{ ...base, endTime: '12:00' }, 'endTime'],
    [{ ...base, start: { name: '성수', lat: 37.5 } }, 'start'],
    [{ ...base, budgetMin: 90000, budgetMax: 80000 }, 'budgetMin'],
    [{ ...base, transport: 'bike' }, 'transport'],
  ])('잘못된 요청 → 400 (%#)', async (body, field) => {
    const app = appWith();
    await add(app, 'db:1');
    const res = await optimize(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).join(',')).toContain(field);
    for (const d of res.body.error.details) expect(d.message).toMatch(/[가-힣]/);
  });
});

describe('optimizeRoute (순서 계산)', () => {
  const place = (id: string, lat: number, lng: number, extra: Partial<RoutePlace> = {}): RoutePlace => ({
    placeId: id, name: id, lat, lng, stayMinutes: 30, pinned: false, hours: null, userOrder: 0, ...extra,
  });
  const input = (places: RoutePlace[]) => ({
    start: { name: '출발', lat: 37.5, lng: 127.0 }, day: 6, startMinutes: 600, transport: 'walk' as const, places,
  });

  it('일직선 위의 장소는 가까운 순서로 방문', () => {
    const far = place('far', 37.5, 127.03, { userOrder: 0 });
    const mid = place('mid', 37.5, 127.02, { userOrder: 1 });
    const near = place('near', 37.5, 127.01, { userOrder: 2 });
    const plan = optimizeRoute(input([far, mid, near]));
    expect(plan.stops.map((s) => s.place.placeId)).toEqual(['near', 'mid', 'far']);
  });

  it('이동 시간이 같으면 사용자 순서를 지킴', () => {
    const a = place('a', 37.5, 127.0, { userOrder: 1 });
    const b = place('b', 37.5, 127.0, { userOrder: 0 });
    expect(optimizeRoute(input([a, b])).stops.map((s) => s.place.placeId)).toEqual(['b', 'a']);
  });

  it('필수 장소가 불가능하면 에러', () => {
    const closed = place('closed', 37.5, 127.0, { pinned: true, hours: [] });
    expect(() => optimizeRoute(input([closed]))).toThrow(RouteNotPossibleError);
  });
});
