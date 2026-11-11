import { describe, expect, it } from 'vitest';
import { KakaoApiError, KakaoLocalClient, type FetchLike } from '../src/kakao/kakaoLocalClient.js';

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init: RequestInit }> = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

const sampleDoc = {
  id: '123',
  place_name: '테스트 카페',
  category_group_code: 'CE7',
  category_name: '음식점 > 카페',
  address_name: '서울 성동구 지번 주소',
  road_address_name: '서울 성동구 도로명 주소',
  x: '127.0557',
  y: '37.5446',
  place_url: 'http://place.map.kakao.com/123',
  phone: '',
};

describe('KakaoLocalClient', () => {
  it('카테고리 검색: x=경도, y=위도, 인증 헤더를 올바르게 보냄', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new KakaoLocalClient('test-key', fakeFetch(200, { documents: [sampleDoc], meta: {} }, calls));

    const result = await client.searchCategory('cafe', { center: { lat: 37.5, lng: 127.1 }, radiusMeters: 1000 });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v2/local/search/category.json');
    expect(url.searchParams.get('category_group_code')).toBe('CE7');
    expect(url.searchParams.get('x')).toBe('127.1');
    expect(url.searchParams.get('y')).toBe('37.5');
    expect(url.searchParams.get('radius')).toBe('1000');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('KakaoAK test-key');

    expect(result).toEqual([
      {
        kakaoPlaceId: '123',
        name: '테스트 카페',
        category: 'cafe',
        subCategory: '카페',
        address: '서울 성동구 도로명 주소',
        lat: 37.5446,
        lng: 127.0557,
        placeUrl: 'http://place.map.kakao.com/123',
      },
    ]);
  });

  it('반경은 0~20000 으로 제한', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new KakaoLocalClient('k', fakeFetch(200, { documents: [] }, calls));
    await client.searchKeyword('성수', { center: { lat: 37, lng: 127 }, radiusMeters: 99999 });
    expect(new URL(calls[0]!.url).searchParams.get('radius')).toBe('20000');
  });

  it('데이트 카테고리가 아니면 category 는 null', async () => {
    const client = new KakaoLocalClient('k', fakeFetch(200, { documents: [{ ...sampleDoc, category_group_code: 'BK9' }] }));
    const [p] = await client.searchKeyword('은행');
    expect(p!.category).toBeNull();
  });

  it('429 는 쿼터 초과 에러', async () => {
    const client = new KakaoLocalClient('k', fakeFetch(429, { msg: 'limit' }));
    await expect(client.searchKeyword('성수')).rejects.toThrow(/쿼터/);
    await expect(client.searchKeyword('성수')).rejects.toBeInstanceOf(KakaoApiError);
  });

  it('응답 모양이 이상하면 에러', async () => {
    const client = new KakaoLocalClient('k', fakeFetch(200, { nope: true }));
    await expect(client.searchKeyword('성수')).rejects.toBeInstanceOf(KakaoApiError);
  });

  it('네트워크 실패도 KakaoApiError 로 감쌈', async () => {
    const client = new KakaoLocalClient('k', async () => {
      throw new Error('ECONNRESET');
    });
    await expect(client.searchKeyword('성수')).rejects.toBeInstanceOf(KakaoApiError);
  });

  it('키가 비어 있으면 생성 단계에서 막음', () => {
    expect(() => new KakaoLocalClient('')).toThrow();
  });
});
