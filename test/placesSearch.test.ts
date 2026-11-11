import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { classifyKakaoCategory } from '../src/kakao/kakaoLocalClient.js';
import { normalizeRegion } from '../src/places/region.js';
import { appWith, fakeKakao, kakaoPlace, USER } from './helpers.js';

const search = (app: ReturnType<typeof appWith>, q: Record<string, string>) =>
  request(app).get('/api/places/search').query(q);

describe('GET /api/places/search', () => {
  it('"성수동"으로 검색해도 성수 장소가 나오고, 화면에 필요한 값이 다 있음', async () => {
    const res = await search(appWith(), { region: '성수동' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(9);
    const p = res.body.places.find((x: { id: string }) => x.id === 'db:8');
    expect(p).toMatchObject({
      source: 'db',
      name: '[예시] 성수 소품샵',
      category: 'activity',
      categoryLabel: '체험',
      subCategory: '소품샵',
      description: expect.any(String),
      imageUrl: null,
      nearestStation: { name: '성수역', walkMinutes: 6 },
      pricePerPerson: 12500,
      priceVerified: true,
      isIndoor: true,
      openStatus: 'unknown', // 날짜를 안 보냈으니
      inCart: false,
    });
    expect(p.mapUrl).toMatch(/^https:\/\/map\.kakao\.com\/link\/map\//);
  });

  it('카테고리 칩: 전시·영화', async () => {
    const res = await search(appWith(), { region: '성수', categories: 'exhibition,movie' });
    const cats = new Set(res.body.places.map((p: { category: string }) => p.category));
    expect(cats).toEqual(new Set(['exhibition', 'movie']));
  });

  it('실내 필터', async () => {
    const res = await search(appWith(), { region: '성수', indoor: 'false' });
    expect(res.body.places.map((p: { name: string }) => p.name).sort()).toEqual(
      ['[예시] 서울숲 산책 코스', '[예시] 성수 루프탑 카페'].sort(),
    );
  });

  it('가격대 필터: 무료 / 1만원 이하', async () => {
    const free = await search(appWith(), { region: '성수', priceMax: '0' });
    expect(free.body.places.map((p: { id: string }) => p.id)).toEqual(['db:7']);
    const cheap = await search(appWith(), { region: '성수', priceMax: '10000' });
    for (const p of cheap.body.places) expect(p.pricePerPerson).toBeLessThanOrEqual(10000);
  });

  it('날짜·시간 + 영업 중만: 월요일 휴무 장소가 빠지고, 그날 영업시간이 나옴', async () => {
    const res = await search(appWith(), {
      region: '성수', date: '2026-11-16', startTime: '13:00', endTime: '14:00', openOnly: 'true',
    });
    const ids = res.body.places.map((p: { id: string }) => p.id);
    for (const closed of ['db:2', 'db:3', 'db:6']) expect(ids).not.toContain(closed);
    expect(ids).not.toContain('db:4'); // 17시에 여는 주점
    const cafe = res.body.places.find((p: { id: string }) => p.id === 'db:1');
    expect(cafe).toMatchObject({ openStatus: 'open', hoursOnDate: { open: '10:00', close: '22:00' } });
  });

  it('정렬: 가격순', async () => {
    const res = await search(appWith(), { region: '성수', sort: 'price' });
    const prices = res.body.places.map((p: { pricePerPerson: number }) => p.pricePerPerson);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('취향 일치율: 태그를 보내면 계산되고 추천순 맨 앞', async () => {
    const res = await search(appWith(), { region: '성수', tags: '조용함,감성' });
    expect(res.body.places[0]).toMatchObject({ id: 'db:1', matchPercent: 100 });
    const noTags = await search(appWith(), { region: '성수' });
    expect(noTags.body.places[0].matchPercent).toBeNull();
  });

  it('검색어', async () => {
    const res = await search(appWith(), { region: '성수', q: '파스타' });
    expect(res.body.places.map((p: { id: string }) => p.id)).toEqual(['db:3']);
  });

  it('카카오 결과 합치기: 가까운 역 계산, 가격·영업시간 미확인, 안내 문구', async () => {
    const kakao = fakeKakao({ cafe: [kakaoPlace('111', '카카오 카페', 'cafe')] }, [kakaoPlace('0', '잠실', null)]);
    const res = await search(appWith(kakao), { region: '잠실' });
    expect(res.status).toBe(200);
    expect(res.body.places[0]).toMatchObject({
      id: 'kakao:111',
      source: 'kakao',
      category: 'cafe',
      nearestStation: { name: '잠실역' },
      pricePerPerson: null,
      priceVerified: false,
      openStatus: 'unknown',
      isIndoor: null,
    });
    expect(res.body.places[0].nearestStation.walkMinutes).toBeGreaterThan(0);
    expect(res.body.warnings.join(' ')).toMatch(/확인되지 않았어요/);
  });

  it('가격 필터를 걸면 가격을 모르는 카카오 장소는 빠짐', async () => {
    const kakao = fakeKakao({ cafe: [kakaoPlace('111', '카카오 카페', 'cafe', 37.5446, 127.056)] });
    const res = await search(appWith(kakao), { region: '성수', priceMax: '20000' });
    expect(res.body.places.some((p: { source: string }) => p.source === 'kakao')).toBe(false);
  });

  it('카카오가 실패해도 등록 장소로 응답', async () => {
    const kakao = fakeKakao();
    kakao.searchCategory.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await search(appWith(kakao), { region: '성수' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(9);
    expect(res.body.warnings.join(' ')).toMatch(/실패/);
  });

  it('카카오 없고 등록 장소도 없는 지역 → 404', async () => {
    const res = await search(appWith(), { region: '제주' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REGION_NOT_FOUND');
  });

  it.each([
    [{}, 'region'],
    [{ region: '성수', categories: 'culture' }, 'categories.0'],
    [{ region: '성수', priceMin: '30000', priceMax: '10000' }, 'priceMin'],
    [{ region: '성수', startTime: '13:00' }, 'endTime'],
    [{ region: '성수', openOnly: 'true' }, 'date'],
    [{ region: '성수', sort: 'popular' }, 'sort'],
    [{ region: '성수', hack: '1' }, ''],
  ])('잘못된 쿼리 %j → 400 (%s)', async (q, field) => {
    const res = await search(appWith(), q as Record<string, string>);
    expect(res.status).toBe(400);
    for (const d of res.body.error.details) expect(d.message).toMatch(/[가-힣]/);
    if (field) expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('장바구니에 담은 장소는 inCart: true', async () => {
    const app = appWith();
    await request(app).post('/api/cart/items').set('X-User-Id', USER).send({ placeId: 'db:1' });
    const res = await search(app, { region: '성수' }).set('X-User-Id', USER);
    expect(res.body.places.find((p: { id: string }) => p.id === 'db:1').inCart).toBe(true);
    const anon = await search(app, { region: '성수' });
    expect(anon.body.places.find((p: { id: string }) => p.id === 'db:1').inCart).toBe(false);
  });
});

describe('GET /api/places/:id', () => {
  it('등록 장소 상세 + 날짜별 영업시간', async () => {
    const res = await request(appWith()).get('/api/places/db:3').query({ date: '2026-11-16' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'db:3', hoursOnDate: null, openStatus: 'closed' }); // 월요일 휴무
  });

  it('카카오 장소: 최근 검색 결과에 있으면 상세 가능, 아니면 404', async () => {
    const app = appWith(fakeKakao({ cafe: [kakaoPlace('111', '카카오 카페', 'cafe')] }, [kakaoPlace('0', '잠실', null)]));
    expect((await request(app).get('/api/places/kakao:111')).status).toBe(404);
    await search(app, { region: '잠실' });
    const res = await request(app).get('/api/places/kakao:111');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('카카오 카페');
  });

  it('없는 장소·이상한 id → 404', async () => {
    expect((await request(appWith()).get('/api/places/db:999')).status).toBe(404);
    expect((await request(appWith()).get('/api/places/abc')).status).toBe(404);
  });
});

describe('도우미 함수', () => {
  it('카카오 카테고리 분류: 문화시설은 영화관/그 외로 나눔', () => {
    expect(classifyKakaoCategory('CT1', '문화,예술 > 영화,영상 > 영화관')).toBe('movie');
    expect(classifyKakaoCategory('CT1', '문화,예술 > 문화시설 > 미술관')).toBe('exhibition');
    expect(classifyKakaoCategory('FD6', '음식점 > 양식')).toBe('restaurant');
    expect(classifyKakaoCategory('BK9', '금융 > 은행')).toBeNull();
  });

  it('지역 이름 정리', () => {
    expect(normalizeRegion(' 성수동 ')).toBe('성수');
    expect(normalizeRegion('성수')).toBe('성수');
    expect(normalizeRegion('동')).toBe('동');
  });
});
