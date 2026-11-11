import { vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { KakaoPlace } from '../src/kakao/kakaoLocalClient.js';
import { InMemoryPlaceRepository } from '../src/places/inMemoryPlaceRepository.js';
import type { KakaoPlaces } from '../src/places/placeSearch.js';
import { SEED_PLACES } from '../src/places/seedData.js';
import type { Category } from '../src/types.js';

export const USER = 'test-user-0001';
export const OTHER_USER = 'test-user-0002';

export const kakaoPlace = (id: string, name: string, category: Category | null, lat = 37.5135, lng = 127.1): KakaoPlace => ({
  kakaoPlaceId: id,
  name,
  category,
  subCategory: category === 'movie' ? '영화관' : null,
  address: '서울 송파구 (카카오 주소)',
  lat,
  lng,
  placeUrl: `http://place.map.kakao.com/${id}`,
});

/** 카카오 가짜: 카테고리마다 정해 둔 장소를 돌려줌 */
export function fakeKakao(byCategory: Partial<Record<Category, KakaoPlace[]>> = {}, keyword: KakaoPlace[] = []) {
  return {
    searchCategory: vi.fn(async (c: Category) => byCategory[c] ?? []),
    searchKeyword: vi.fn(async () => keyword),
    findNearestStation: vi.fn(async (at: { lat: number; lng: number }) => ({
      name: '잠실역',
      lat: at.lat + 0.003,
      lng: at.lng,
    })),
  } satisfies KakaoPlaces;
}

export const appWith = (kakao: KakaoPlaces | null = null) =>
  createApp({ places: new InMemoryPlaceRepository(SEED_PLACES), kakao, rateLimitPerMinute: 10_000 });
