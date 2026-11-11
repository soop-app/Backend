import type { Place } from '../types.js';

/**
 * 개발·테스트용 예시 장소입니다. 모두 지어낸 가게이며 실제 장소가 아닙니다.
 * 실제 서비스 전에는 직접 확인한 장소로 바꿔 넣으세요.
 * imageUrl 은 직접 찍었거나 사용 허락을 받은 사진만 넣습니다. (없으면 앱에서 카테고리별 기본 이미지)
 */
const everyDay = (open: string, close: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));
const exceptMonday = (open: string, close: string) =>
  [0, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));

export const SEED_PLACES: Place[] = [
  {
    id: 1, kakaoPlaceId: null, name: '[예시] 성수 숲속 카페', category: 'cafe', subCategory: '카페',
    description: '창가 자리가 넓은 조용한 숲 콘셉트 카페', imageUrl: null, isIndoor: true, region: '성수',
    address: '서울 성동구 (예시 주소 1)', lat: 37.5446, lng: 127.0560,
    priceMin: 6000, priceMax: 9000, stayMinutes: 60, tags: ['조용함', '감성', '카페'],
    nearestStation: { name: '성수역', walkMinutes: 6 }, hours: everyDay('10:00', '22:00'),
  },
  {
    id: 2, kakaoPlaceId: null, name: '[예시] 성수 루프탑 카페', category: 'cafe', subCategory: '루프탑 카페',
    description: '서울숲이 보이는 루프탑 자리', imageUrl: null, isIndoor: false, region: '성수',
    address: '서울 성동구 (예시 주소 2)', lat: 37.5432, lng: 127.0575,
    priceMin: 8000, priceMax: 12000, stayMinutes: 60, tags: ['야외', '뷰', '카페'],
    nearestStation: { name: '성수역', walkMinutes: 8 }, hours: exceptMonday('12:00', '23:00'),
  },
  {
    id: 3, kakaoPlaceId: null, name: '[예시] 성수 파스타집', category: 'restaurant', subCategory: '양식',
    description: '제철 재료로 만드는 파스타 다이닝', imageUrl: null, isIndoor: true, region: '성수',
    address: '서울 성동구 (예시 주소 3)', lat: 37.5450, lng: 127.0545,
    priceMin: 18000, priceMax: 25000, stayMinutes: 80, tags: ['양식', '감성'],
    nearestStation: { name: '뚝섬역', walkMinutes: 5 }, hours: exceptMonday('11:30', '21:30'),
  },
  {
    id: 4, kakaoPlaceId: null, name: '[예시] 성수 한식 주점', category: 'restaurant', subCategory: '한식 주점',
    description: '늦게까지 여는 한식 안주 주점', imageUrl: null, isIndoor: true, region: '성수',
    address: '서울 성동구 (예시 주소 4)', lat: 37.5425, lng: 127.0590,
    priceMin: 15000, priceMax: 22000, stayMinutes: 90, tags: ['한식', '시끌벅적'],
    nearestStation: { name: '성수역', walkMinutes: 9 }, hours: everyDay('17:00', '02:00'), // 새벽 2시까지
  },
  {
    id: 5, kakaoPlaceId: null, name: '[예시] 성수 팝업 전시관', category: 'exhibition', subCategory: '팝업 전시',
    description: '사진과 미디어 아트를 함께 보는 몰입형 전시', imageUrl: null, isIndoor: true, region: '성수',
    address: '서울 성동구 (예시 주소 5)', lat: 37.5460, lng: 127.0530,
    priceMin: 10000, priceMax: 15000, stayMinutes: 70, tags: ['전시', '사진'],
    nearestStation: { name: '서울숲역', walkMinutes: 4 }, hours: everyDay('11:00', '20:00'),
  },
  {
    id: 6, kakaoPlaceId: null, name: '[예시] 성수 공방 체험', category: 'activity', subCategory: '공방',
    description: '반지·향수를 직접 만드는 원데이 클래스', imageUrl: null, isIndoor: true, region: '성수',
    address: '서울 성동구 (예시 주소 6)', lat: 37.5418, lng: 127.0550,
    priceMin: 25000, priceMax: 35000, stayMinutes: 90, tags: ['체험', '조용함'],
    nearestStation: { name: '성수역', walkMinutes: 7 }, hours: exceptMonday('13:00', '21:00'),
  },
  {
    id: 7, kakaoPlaceId: null, name: '[예시] 서울숲 산책 코스', category: 'activity', subCategory: '산책',
    description: '서울숲을 한 바퀴 도는 무료 산책 코스', imageUrl: null, isIndoor: false, region: '성수',
    address: '서울 성동구 (예시 주소 7)', lat: 37.5444, lng: 127.0374,
    priceMin: 0, priceMax: 0, stayMinutes: 60, tags: ['야외', '산책'],
    nearestStation: { name: '서울숲역', walkMinutes: 3 }, hours: everyDay('00:00', '00:00'), // 24시간
  },
  {
    id: 8, kakaoPlaceId: null, name: '[예시] 성수 소품샵', category: 'activity', subCategory: '소품샵',
    description: '감각적인 문구와 작은 선물을 구경하는 셀렉트숍', imageUrl: null, isIndoor: true, region: '성수',
    address: '서울 성동구 (예시 주소 8)', lat: 37.5440, lng: 127.0552,
    priceMin: 10000, priceMax: 15000, stayMinutes: 40, tags: ['소품', '감성'],
    nearestStation: { name: '성수역', walkMinutes: 6 }, hours: everyDay('11:00', '20:00'),
  },
  {
    id: 9, kakaoPlaceId: null, name: '[예시] 성수 독립영화관', category: 'movie', subCategory: '독립영화관',
    description: '작은 상영관에서 보는 독립·예술 영화', imageUrl: null, isIndoor: true, region: '성수',
    address: '서울 성동구 (예시 주소 9)', lat: 37.5428, lng: 127.0538,
    priceMin: 12000, priceMax: 12000, stayMinutes: 130, tags: ['영화', '실내'],
    nearestStation: { name: '뚝섬역', walkMinutes: 7 }, hours: everyDay('10:00', '24:00'),
  },
  {
    id: 10, kakaoPlaceId: null, name: '[예시] 홍대 보드게임 카페', category: 'activity', subCategory: '보드게임',
    description: '200종 넘는 보드게임이 있는 카페', imageUrl: null, isIndoor: true, region: '홍대',
    address: '서울 마포구 (예시 주소 10)', lat: 37.5563, lng: 126.9236,
    priceMin: 5000, priceMax: 8000, stayMinutes: 120, tags: ['실내', '게임'],
    nearestStation: { name: '홍대입구역', walkMinutes: 5 }, hours: everyDay('12:00', '24:00'),
  },
  {
    id: 11, kakaoPlaceId: null, name: '[예시] 홍대 덮밥집', category: 'restaurant', subCategory: '일식',
    description: '혼밥·데이트 모두 좋은 덮밥 전문점', imageUrl: null, isIndoor: true, region: '홍대',
    address: '서울 마포구 (예시 주소 11)', lat: 37.5570, lng: 126.9250,
    priceMin: 10000, priceMax: 14000, stayMinutes: 50, tags: ['일식'],
    nearestStation: { name: '홍대입구역', walkMinutes: 4 }, hours: everyDay('11:00', '21:00'),
  },
];
