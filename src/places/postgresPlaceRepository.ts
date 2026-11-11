import type pg from 'pg';
import { distanceMeters } from '../geo.js';
import type { Category, LatLng, Place } from '../types.js';
import type { PlaceRepository } from './placeRepository.js';
import { normalizeRegion } from './region.js';

interface PlaceRow {
  id: string; // BIGSERIAL 은 문자열로 옴
  kakao_place_id: string | null;
  name: string;
  category: Category;
  region: string;
  address: string;
  lat: number;
  lng: number;
  price_min: number;
  price_max: number;
  stay_minutes: number;
  tags: string[];
  sub_category: string | null;
  description: string | null;
  image_url: string | null;
  is_indoor: boolean | null;
  station_name: string | null;
  station_walk_minutes: number | null;
  hours: Array<{ day: number; open: string; close: string }>;
}

// 장소 + 영업시간을 한 번에 가져오는 공통 SELECT
const SELECT_PLACES = `
  SELECT p.id, p.kakao_place_id, p.name, p.category, p.region, p.address,
         p.lat, p.lng, p.price_min, p.price_max, p.stay_minutes, p.tags,
         p.sub_category, p.description, p.image_url, p.is_indoor, p.station_name, p.station_walk_minutes,
         COALESCE(
           json_agg(json_build_object(
             'day', h.day_of_week,
             'open', to_char(h.open_time, 'HH24:MI'),
             'close', CASE WHEN h.close_time = '24:00' THEN '24:00'
                           ELSE to_char(h.close_time, 'HH24:MI') END
           )) FILTER (WHERE h.place_id IS NOT NULL),
           '[]'
         ) AS hours
  FROM places p
  LEFT JOIN place_hours h ON h.place_id = p.id
`;

/** LIKE 검색에서 %, _ 를 글자 그대로 찾도록 이스케이프 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toPlace(r: PlaceRow): Place {
  return {
    id: Number(r.id),
    kakaoPlaceId: r.kakao_place_id,
    name: r.name,
    category: r.category,
    subCategory: r.sub_category,
    description: r.description,
    imageUrl: r.image_url,
    isIndoor: r.is_indoor,
    region: r.region,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    priceMin: r.price_min,
    priceMax: r.price_max,
    stayMinutes: r.stay_minutes,
    tags: r.tags,
    nearestStation:
      r.station_name && r.station_walk_minutes !== null
        ? { name: r.station_name, walkMinutes: r.station_walk_minutes }
        : null,
    hours: r.hours,
  };
}

export class PostgresPlaceRepository implements PlaceRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findActiveByRegion(region: string): Promise<Place[]> {
    const { rows } = await this.pool.query<PlaceRow>(
      `${SELECT_PLACES} WHERE p.is_active AND p.region = $1 GROUP BY p.id ORDER BY p.id`,
      [normalizeRegion(region)],
    );
    return rows.map(toPlace);
  }

  async findActiveNear(center: LatLng, radiusMeters: number): Promise<Place[]> {
    // 1) 사각형 범위로 대략 거르고(인덱스 활용 가능) 2) 정확한 거리는 코드에서 계산
    const dLat = radiusMeters / 111_320;
    const dLng = radiusMeters / (111_320 * Math.cos((center.lat * Math.PI) / 180));
    const { rows } = await this.pool.query<PlaceRow>(
      `${SELECT_PLACES}
       WHERE p.is_active AND p.lat BETWEEN $1 AND $2 AND p.lng BETWEEN $3 AND $4
       GROUP BY p.id ORDER BY p.id`,
      [center.lat - dLat, center.lat + dLat, center.lng - dLng, center.lng + dLng],
    );
    return rows.map(toPlace).filter((p) => distanceMeters(center, p) <= radiusMeters);
  }

  async findActiveByName(keyword: string, region?: string): Promise<Place[]> {
    const { rows } = await this.pool.query<PlaceRow>(
      `${SELECT_PLACES}
       WHERE p.is_active AND p.name ILIKE '%' || $1 || '%' AND ($2::text IS NULL OR p.region = $2)
       GROUP BY p.id ORDER BY p.id LIMIT 5`,
      [escapeLike(keyword), region === undefined ? null : normalizeRegion(region)],
    );
    return rows.map(toPlace);
  }

  async findActiveById(id: number): Promise<Place | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const { rows } = await this.pool.query<PlaceRow>(
      `${SELECT_PLACES} WHERE p.is_active AND p.id = $1 GROUP BY p.id`,
      [id],
    );
    return rows[0] ? toPlace(rows[0]) : null;
  }
}
