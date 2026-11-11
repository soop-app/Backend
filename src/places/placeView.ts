import { estimateTravel } from '../geo.js';
import type { KakaoPlace } from '../kakao/kakaoLocalClient.js';
import { isOpenDuring } from '../time.js';
import {
  CATEGORY_LABEL,
  DEFAULT_STAY_MINUTES,
  type Category,
  type LatLng,
  type NearestStation,
  type OpeningHours,
  type Place,
} from '../types.js';

/**
 * 앱 화면(검색 결과·상세·장바구니)에 내려주는 장소 모양
 * 우리 DB 장소와 카카오 장소를 같은 모양으로 맞춥니다.
 */
export interface PlaceView {
  id: string; // 'db:1' 또는 'kakao:12345'
  source: 'db' | 'kakao';
  name: string;
  category: Category;
  categoryLabel: string; // 식당·카페·전시·영화·체험
  subCategory: string | null; // 예: 소품샵
  description: string | null;
  imageUrl: string | null; // null 이면 앱에서 카테고리별 기본 이미지
  address: string;
  lat: number;
  lng: number;
  nearestStation: NearestStation | null;
  pricePerPerson: number | null; // 1인 예상 비용(원). 모르면 null
  priceVerified: boolean;
  isIndoor: boolean | null; // 모르면 null
  stayMinutes: number; // 보통 머무는 시간(분)
  /** 선택한 날짜의 영업시간. 쉬는 날이면 null, 모르면 undefined 대신 hoursVerified=false */
  hoursOnDate: { open: string; close: string } | null;
  hoursVerified: boolean;
  /** 선택한 날짜(와 시간대)에 영업 중인지: open / closed / unknown */
  openStatus: 'open' | 'closed' | 'unknown';
  /** 취향 일치율(%). 취향 정보가 없으면 null */
  matchPercent: number | null;
  tags: string[];
  mapUrl: string; // 카카오맵에서 보기
  inCart: boolean;
}

export interface ViewContext {
  day?: number; // 0=일 ... 6=토
  window?: { start: number; end: number }; // 자정부터의 분
  tasteTags: string[];
  cartKeys: Set<string>;
}

export const dbKey = (id: number) => `db:${id}`;
export const kakaoKey = (id: string) => `kakao:${id}`;

export function kakaoMapUrl(name: string, at: LatLng): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${at.lat},${at.lng}`;
}

/**
 * 취향 일치율(임시 계산식): 내 취향 태그 중 이 장소가 가진 태그 비율
 * 취향 조사(로그인 후)가 생기면 계산식을 다시 정합니다.
 */
export function matchPercent(placeTags: string[], tasteTags: string[]): number | null {
  if (tasteTags.length === 0 || placeTags.length === 0) return null;
  const set = new Set(placeTags);
  const hit = tasteTags.filter((t) => set.has(t)).length;
  return Math.round((hit / tasteTags.length) * 100);
}

/** 그 요일의 영업시간 한 줄 (쉬는 날이면 null) */
function hoursOn(hours: OpeningHours[], day: number): { open: string; close: string } | null {
  const h = hours.find((x) => x.day === day);
  return h ? { open: h.open, close: h.close } : null;
}

function openStatusFor(hours: OpeningHours[], ctx: ViewContext): 'open' | 'closed' | 'unknown' {
  if (ctx.day === undefined) return 'unknown';
  if (ctx.window) return isOpenDuring(hours, ctx.day, ctx.window.start, ctx.window.end) ? 'open' : 'closed';
  return hoursOn(hours, ctx.day) ? 'open' : 'closed';
}

export function viewFromPlace(p: Place, ctx: ViewContext): PlaceView {
  return {
    id: dbKey(p.id),
    source: 'db',
    name: p.name,
    category: p.category,
    categoryLabel: CATEGORY_LABEL[p.category],
    subCategory: p.subCategory,
    description: p.description,
    imageUrl: p.imageUrl,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    nearestStation: p.nearestStation,
    pricePerPerson: Math.round((p.priceMin + p.priceMax) / 2),
    priceVerified: true,
    isIndoor: p.isIndoor,
    stayMinutes: p.stayMinutes,
    hoursOnDate: ctx.day === undefined ? null : hoursOn(p.hours, ctx.day),
    hoursVerified: true,
    openStatus: openStatusFor(p.hours, ctx),
    matchPercent: matchPercent(p.tags, ctx.tasteTags),
    tags: p.tags,
    mapUrl: p.kakaoPlaceId ? `https://place.map.kakao.com/${p.kakaoPlaceId}` : kakaoMapUrl(p.name, p),
    inCart: ctx.cartKeys.has(dbKey(p.id)),
  };
}

export function viewFromKakao(
  k: KakaoPlace & { category: Category },
  station: { name: string; lat: number; lng: number } | null,
  ctx: ViewContext,
): PlaceView {
  return {
    id: kakaoKey(k.kakaoPlaceId),
    source: 'kakao',
    name: k.name,
    category: k.category,
    categoryLabel: CATEGORY_LABEL[k.category],
    subCategory: k.subCategory,
    description: null,
    imageUrl: null,
    address: k.address,
    lat: k.lat,
    lng: k.lng,
    nearestStation: station ? { name: station.name, walkMinutes: estimateTravel(k, station, 'walk').minutes } : null,
    pricePerPerson: null,
    priceVerified: false,
    isIndoor: null,
    stayMinutes: DEFAULT_STAY_MINUTES[k.category],
    hoursOnDate: null,
    hoursVerified: false,
    openStatus: 'unknown',
    matchPercent: null,
    tags: [],
    mapUrl: k.placeUrl || kakaoMapUrl(k.name, k),
    inCart: ctx.cartKeys.has(kakaoKey(k.kakaoPlaceId)),
  };
}
