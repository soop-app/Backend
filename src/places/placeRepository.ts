import type { LatLng, Place } from '../types.js';

/** 장소 저장소. 메모리 버전(개발용)과 PostgreSQL 버전이 같은 모양을 따릅니다. */
export interface PlaceRepository {
  /** 지역 이름으로 영업 중(is_active)인 장소 찾기 ("성수동"과 "성수"는 같은 지역) */
  findActiveByRegion(region: string): Promise<Place[]>;
  /** 중심 좌표에서 radiusMeters 안의 장소 찾기 */
  findActiveNear(center: LatLng, radiusMeters: number): Promise<Place[]>;
  /** 이름에 keyword 가 들어간 장소 찾기 */
  findActiveByName(keyword: string, region?: string): Promise<Place[]>;
  /** 번호로 장소 하나 찾기 (없거나 폐업이면 null) */
  findActiveById(id: number): Promise<Place | null>;
}
