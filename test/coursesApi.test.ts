import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryPlaceRepository } from '../src/places/inMemoryPlaceRepository.js';
import { SEED_PLACES } from '../src/places/seedData.js';
import type { KakaoSearch } from '../src/recommend/recommendCourse.js';
import { dayOfWeek, isOpenDuring, parseHHmm } from '../src/time.js';
import type { CourseResult } from '../src/recommend/recommendCourse.js';

const places = new InMemoryPlaceRepository(SEED_PLACES);
const appWith = (kakao: KakaoSearch | null = null, rateLimitPerMinute = 1000) =>
  createApp({ places, kakao: kakao && { ...kakao, findNearestStation: async () => null }, rateLimitPerMinute });

const base = {
  region: '성수',
  date: '2026-11-14', // 토요일
  startTime: '13:00',
  endTime: '19:00',
  budget: 120000,
  transport: 'walk',
};

/** 어떤 코스든 지켜야 하는 규칙 */
function expectValidCourse(body: CourseResult, req: typeof base) {
  const start = parseHHmm(req.startTime)!;
  const end = parseHHmm(req.endTime)!;
  const day = dayOfWeek(req.date)!;
  let t = start;
  const cats = new Set<string>();
  for (const s of body.stops) {
    const arrive = parseHHmm(s.arriveAt)!;
    const leave = parseHHmm(s.leaveAt)!;
    expect(arrive).toBeGreaterThanOrEqual(t); // 시간 순서
    expect(leave - arrive).toBe(s.stayMinutes);
    expect(leave).toBeLessThanOrEqual(end); // 종료 시간 안
    if (!s.isMustVisit) {
      expect(cats.has(s.category)).toBe(false); // 같은 종류 반복 없음
    }
    cats.add(s.category);
    if (s.source === 'db') {
      const seed = SEED_PLACES.find((p) => p.name === s.name)!;
      expect(isOpenDuring(seed.hours, day, arrive, leave)).toBe(true); // 영업 중
    }
    t = leave;
  }
  const knownCost = body.stops.reduce((sum, s) => sum + (s.costForTwo ?? 0), 0);
  expect(knownCost).toBe(body.summary.estimatedCostForTwo);
  expect(knownCost).toBeLessThanOrEqual(req.budget); // 예산 안
}

describe('POST /api/courses/recommend', () => {
  it('토요일 오후 성수 도보 코스: 규칙을 모두 지킴', async () => {
    const res = await request(appWith()).post('/api/courses/recommend').send(base);
    expect(res.status).toBe(200);
    expect(res.body.stops.length).toBeGreaterThanOrEqual(3);
    expect(res.body.stops[0].travelFromPrevious).toBeNull();
    expect(res.body.stops[1].travelFromPrevious).toMatchObject({ mode: 'walk', estimated: true });
    expect(res.body.stops.every((s: { region?: string; source: string }) => s.source === 'db')).toBe(true);
    expectValidCourse(res.body, base);
  });

  it('식사 시간이 끼면 식당이 들어감', async () => {
    const req = { ...base, startTime: '17:00', endTime: '22:00' };
    const res = await request(appWith()).post('/api/courses/recommend').send(req);
    expect(res.body.stops.some((s: { category: string }) => s.category === 'restaurant')).toBe(true);
    expectValidCourse(res.body, req);
  });

  it('월요일: 월요일 휴무인 장소는 빠짐', async () => {
    const req = { ...base, date: '2026-11-16' };
    const res = await request(appWith()).post('/api/courses/recommend').send(req);
    expect(res.status).toBe(200);
    const names: string[] = res.body.stops.map((s: { name: string }) => s.name);
    for (const closed of ['[예시] 성수 루프탑 카페', '[예시] 성수 파스타집', '[예시] 성수 공방 체험']) {
      expect(names).not.toContain(closed);
    }
    expectValidCourse(res.body, req);
  });

  it('예산 0원이면 무료 장소만', async () => {
    const req = { ...base, budget: 0 };
    const res = await request(appWith()).post('/api/courses/recommend').send(req);
    expect(res.status).toBe(200);
    for (const s of res.body.stops) expect(s.costForTwo).toBe(0);
    expectValidCourse(res.body, req);
  });

  it('조건이 너무 빡빡하면 빈 코스 + 안내 문구', async () => {
    const req = { ...base, startTime: '07:00', endTime: '08:00', budget: 0, region: '홍대' };
    const res = await request(appWith()).post('/api/courses/recommend').send(req);
    expect(res.status).toBe(200);
    expect(res.body.stops).toEqual([]);
    expect(res.body.warnings.join(' ')).toMatch(/찾지 못했어요/);
  });

  it('꼭 가고 싶은 장소가 코스에 들어감', async () => {
    const req = { ...base, mustVisit: '공방' };
    const res = await request(appWith()).post('/api/courses/recommend').send(req);
    const must = res.body.stops.find((s: { isMustVisit: boolean }) => s.isMustVisit);
    expect(must?.name).toBe('[예시] 성수 공방 체험');
    expectValidCourse(res.body, req);
  });

  it('꼭 가고 싶은 장소가 없으면 안내 문구', async () => {
    const res = await request(appWith()).post('/api/courses/recommend').send({ ...base, mustVisit: '없는가게' });
    expect(res.status).toBe(200);
    expect(res.body.warnings.join(' ')).toMatch(/없는가게/);
  });

  it('center 좌표만 보내도 동작', async () => {
    const req = { ...base, region: undefined, center: { lat: 37.5446, lng: 127.056 } };
    const res = await request(appWith()).post('/api/courses/recommend').send(req);
    expect(res.status).toBe(200);
    expect(res.body.stops.length).toBeGreaterThan(0);
  });

  it('취향 태그가 결과에 반영됨', async () => {
    const quiet = await request(appWith()).post('/api/courses/recommend').send({ ...base, startTime: '15:00', endTime: '16:30', preferredTags: ['야외', '뷰'] });
    expect(quiet.body.stops[0].name).toBe('[예시] 성수 루프탑 카페');
  });
});

describe('카카오 보충', () => {
  const kakaoCafe = {
    kakaoPlaceId: '999', name: '카카오에서 찾은 카페', category: 'cafe' as const, subCategory: '카페',
    address: '서울 마포구 어딘가', lat: 37.5565, lng: 126.924, placeUrl: 'http://place.map.kakao.com/999',
  };

  it('우리 DB에 카페가 없는 홍대 → 카카오 카페로 보충, 가격 미확인 표시', async () => {
    const kakao: KakaoSearch = {
      searchKeyword: vi.fn(async () => []),
      searchCategory: vi.fn(async (cat) => (cat === 'cafe' ? [kakaoCafe] : [])),
    };
    const req = { ...base, region: '홍대', startTime: '12:00', endTime: '18:00' };
    const res = await request(appWith(kakao)).post('/api/courses/recommend').send(req);
    expect(res.status).toBe(200);
    const k = res.body.stops.find((s: { source: string }) => s.source === 'kakao');
    expect(k).toMatchObject({ name: '카카오에서 찾은 카페', priceVerified: false, hoursVerified: false, costForTwo: null });
    expect(res.body.warnings.join(' ')).toMatch(/확인되지 않아/);
    expectValidCourse(res.body, req);
  });

  it('카카오가 실패해도 DB 장소로 추천 + 안내 문구', async () => {
    const kakao: KakaoSearch = {
      searchKeyword: vi.fn(async () => { throw new Error('down'); }),
      searchCategory: vi.fn(async () => { throw new Error('down'); }),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(appWith(kakao)).post('/api/courses/recommend').send({ ...base, region: '홍대' });
    expect(res.status).toBe(200);
    expect(res.body.stops.length).toBeGreaterThan(0);
    expect(res.body.warnings.join(' ')).toMatch(/카카오 장소 검색에 실패/);
  });

  it('DB에 없는 지역은 카카오로 위치를 찾음', async () => {
    const kakao: KakaoSearch = {
      searchKeyword: vi.fn(async () => [{ ...kakaoCafe, name: '잠실', category: null }]),
      searchCategory: vi.fn(async (cat) => (cat === 'cafe' ? [kakaoCafe] : [])),
    };
    const res = await request(appWith(kakao)).post('/api/courses/recommend').send({ ...base, region: '잠실' });
    expect(res.status).toBe(200);
    expect(kakao.searchKeyword).toHaveBeenCalledWith('잠실');
  });

  it('카카오 없고 DB에도 없는 지역은 404', async () => {
    const res = await request(appWith()).post('/api/courses/recommend').send({ ...base, region: '제주' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REGION_NOT_FOUND');
  });
});

describe('입력 검증과 보안', () => {
  const post = (body: unknown) => request(appWith()).post('/api/courses/recommend').send(body as object);

  it.each([
    ['날짜 형식 틀림', { ...base, date: '2026/11/14' }, 'date'],
    ['없는 날짜', { ...base, date: '2026-02-30' }, 'date'],
    ['시간 형식 틀림', { ...base, startTime: '1pm' }, 'startTime'],
    ['종료가 시작보다 앞', { ...base, startTime: '19:00', endTime: '13:00' }, 'endTime'],
    ['음수 예산', { ...base, budget: -1 }, 'budget'],
    ['소수 예산', { ...base, budget: 1000.5 }, 'budget'],
    ['이동수단 틀림', { ...base, transport: 'bike' }, 'transport'],
    ['지역·좌표 둘 다 없음', { ...base, region: undefined }, 'region'],
    ['모르는 필드', { ...base, isAdmin: true }, ''],
  ])('%s → 400', async (_name, body, field) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
    if (field) expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('에러 메시지는 모두 한글', async () => {
    const res = await post({
      region: 123, center: { lat: 999, lng: 'x' }, date: 5, startTime: 13, endTime: '25:00',
      budget: '많이', transport: 'bike', mustVisit: '', preferredTags: 'a', isAdmin: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(9);
    for (const d of res.body.error.details) expect(d.message).toMatch(/[가-힣]/);
    expect(res.body.error.details.at(-1).message).toContain('isAdmin');
  });

  it('JSON 이 깨지면 400', async () => {
    const res = await request(appWith()).post('/api/courses/recommend').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('LIKE 특수문자(%, _)로 모든 장소가 걸리지 않음', async () => {
    const res = await post({ ...base, mustVisit: '%' });
    expect(res.body.stops.some((s: { isMustVisit: boolean }) => s.isMustVisit)).toBe(false);
  });

  it('요청이 너무 많으면 429', async () => {
    const app = appWith(null, 2);
    await request(app).post('/api/courses/recommend').send(base);
    await request(app).post('/api/courses/recommend').send(base);
    const res = await request(app).post('/api/courses/recommend').send(base);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('없는 주소는 404, 서버 정보 헤더 숨김', async () => {
    const res = await request(appWith()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
