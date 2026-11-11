import type { LatLng, Transport } from './types.js';

/** 두 좌표 사이의 직선거리(미터). 하버사인 공식 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 이동 시간 "추정치". 실제 길찾기 API가 아니라 직선거리에 보정값을 곱한 값입니다.
 * - 도보: 길이 구불구불하니 직선거리 × 1.3, 분속 75m(시속 4.5km)
 * - 차량: 직선거리 × 1.4, 시내 평균 시속 25km, 주차 시간 5분 추가
 * TODO(다음 단계): 카카오 길찾기 API로 교체
 */
export function estimateTravel(a: LatLng, b: LatLng, mode: Transport) {
  const straight = distanceMeters(a, b);
  if (straight < 1) return { distanceMeters: 0, minutes: 0 };

  if (mode === 'walk') {
    const road = straight * 1.3;
    return { distanceMeters: Math.round(road), minutes: Math.ceil(road / 75) };
  }
  const road = straight * 1.4;
  return { distanceMeters: Math.round(road), minutes: Math.ceil(road / (25_000 / 60)) + 5 };
}
