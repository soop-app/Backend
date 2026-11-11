/**
 * 장소 카테고리 (디자인의 필터 칩과 1:1)
 * 식당=restaurant, 카페=cafe, 전시=exhibition, 영화=movie, 체험=activity
 * '실내'는 카테고리가 아니라 별도 필터(isIndoor)입니다.
 */
export const CATEGORIES = ['restaurant', 'cafe', 'exhibition', 'movie', 'activity'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  restaurant: '식당',
  cafe: '카페',
  exhibition: '전시',
  movie: '영화',
  activity: '체험',
};

export type Transport = 'walk' | 'car';

/** 영업시간 한 줄. day: 0=일 ... 6=토, open/close: "HH:mm" */
export interface OpeningHours {
  day: number;
  open: string;
  close: string;
}

/** 가장 가까운 지하철역 */
export interface NearestStation {
  name: string; // 예: "성수역"
  walkMinutes: number;
}

/** 우리 DB에 저장된(직접 확인한) 장소 */
export interface Place {
  id: number;
  kakaoPlaceId: string | null;
  name: string;
  category: Category;
  subCategory: string | null; // 화면 표시용 세부 분류 (예: 소품샵)
  description: string | null; // 한 줄 소개
  imageUrl: string | null; // 직접 찍었거나 허락받은 사진만
  isIndoor: boolean | null;
  region: string;
  address: string;
  lat: number;
  lng: number;
  priceMin: number; // 1인당, 원
  priceMax: number;
  stayMinutes: number;
  tags: string[];
  nearestStation: NearestStation | null;
  hours: OpeningHours[];
}

/**
 * 추천 후보. 카카오에서 실시간으로 가져온 장소는 가격·영업시간을 모르므로
 * 값이 null 이고 source 가 'kakao' 입니다.
 */
export interface Candidate {
  key: string; // 'db:1' 또는 'kakao:12345'
  source: 'db' | 'kakao';
  name: string;
  category: Category;
  address: string;
  lat: number;
  lng: number;
  pricePerPerson: number | null;
  stayMinutes: number;
  tags: string[];
  hours: OpeningHours[] | null;
  kakaoPlaceUrl: string | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** 카테고리별 기본 머무는 시간(분) — 카카오 장소처럼 정보가 없을 때 사용 */
export const DEFAULT_STAY_MINUTES: Record<Category, number> = {
  restaurant: 70,
  cafe: 60,
  exhibition: 60,
  movie: 130,
  activity: 90,
};
