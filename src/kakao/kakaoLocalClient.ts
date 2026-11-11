import { z } from 'zod';
import type { Category, LatLng } from '../types.js';

/**
 * 카카오 로컬 API(장소 검색) 클라이언트
 * 문서: https://developers.kakao.com/docs/latest/ko/local/dev-guide
 *
 * 주의
 * - x 는 경도(lng), y 는 위도(lat) 입니다.
 * - 응답에 영업시간·가격 정보가 없습니다.
 * - 결과를 대량으로 수집·저장하면 안 됩니다. 요청이 올 때만 호출합니다.
 * - REST API 키는 서버에만 두고, 앱(프런트)으로 절대 보내지 않습니다.
 */

const BASE_URL = 'https://dapi.kakao.com/v2/local/search';

/**
 * 우리 카테고리 → 카카오 카테고리 그룹 코드
 * 전시·영화는 카카오에서 둘 다 '문화시설(CT1)'이라, 세부 분류 이름(category_name)으로 나눕니다.
 */
export const KAKAO_CATEGORY_CODE: Record<Category, string> = {
  restaurant: 'FD6', // 음식점
  cafe: 'CE7', // 카페
  exhibition: 'CT1', // 문화시설 중 영화관이 아닌 곳 (미술관·전시 등)
  movie: 'CT1', // 문화시설 중 영화관
  activity: 'AT4', // 관광명소
};
const SUBWAY_STATION_CODE = 'SW8';

/** 카카오 카테고리 → 우리 카테고리. 데이트 장소가 아니면 null */
export function classifyKakaoCategory(groupCode: string, categoryName: string): Category | null {
  switch (groupCode) {
    case 'FD6':
      return 'restaurant';
    case 'CE7':
      return 'cafe';
    case 'AT4':
      return 'activity';
    case 'CT1':
      return /영화/.test(categoryName) ? 'movie' : 'exhibition';
    default:
      return null;
  }
}

/** "문화,예술 > 영화,영상 > 영화관" → "영화관" (화면 표시용 세부 분류) */
function lastCategoryPart(categoryName: string): string | null {
  const last = categoryName.split('>').pop()?.trim();
  return last ? last : null;
}

const documentSchema = z.object({
  id: z.string(),
  place_name: z.string(),
  category_group_code: z.string().optional().default(''),
  category_name: z.string().optional().default(''),
  address_name: z.string().optional().default(''),
  road_address_name: z.string().optional().default(''),
  x: z.string(),
  y: z.string(),
  place_url: z.string().optional().default(''),
});
const responseSchema = z.object({ documents: z.array(documentSchema) });

export interface KakaoPlace {
  kakaoPlaceId: string;
  name: string;
  /** 데이트 코스에 쓰는 카테고리가 아니면 null */
  category: Category | null;
  /** 카카오 세부 분류의 마지막 부분 (예: 영화관, 미술관, 이탈리안) */
  subCategory: string | null;
  address: string;
  lat: number;
  lng: number;
  placeUrl: string;
}

export class KakaoApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'KakaoApiError';
  }
}

/** fetch 를 바꿔 끼울 수 있게 해서 테스트에서 가짜 응답을 쓸 수 있도록 함 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface NearbyOptions {
  center: LatLng;
  radiusMeters: number; // 0 ~ 20000
  size?: number; // 1 ~ 15
}

export class KakaoLocalClient {
  constructor(
    private readonly restApiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 3000,
  ) {
    if (!restApiKey) throw new Error('KAKAO_REST_API_KEY 가 비어 있습니다.');
  }

  /** 키워드로 장소 검색 (예: "성수", "○○카페") */
  async searchKeyword(query: string, near?: NearbyOptions): Promise<KakaoPlace[]> {
    const params = new URLSearchParams({ query, size: String(near?.size ?? 5) });
    if (near) this.addNearby(params, near);
    return this.request('keyword', params);
  }

  /** 카테고리로 근처 장소 검색 (가까운 순). 전시·영화는 문화시설 결과에서 골라냄 */
  async searchCategory(category: Category, near: NearbyOptions): Promise<KakaoPlace[]> {
    const size = near.size ?? 5;
    const params = new URLSearchParams({
      category_group_code: KAKAO_CATEGORY_CODE[category],
      // 전시·영화는 같은 그룹에서 나눠 써야 해서 넉넉히(최대 15개) 받아 거름
      size: String(KAKAO_CATEGORY_CODE[category] === 'CT1' ? 15 : size),
      sort: 'distance',
    });
    this.addNearby(params, near);
    const places = await this.request('category', params);
    return places.filter((p) => p.category === category).slice(0, size);
  }

  /** 좌표에서 가장 가까운 지하철역 (반경 안에 없으면 null) */
  async findNearestStation(
    center: LatLng,
    radiusMeters = 2000,
  ): Promise<{ name: string; lat: number; lng: number } | null> {
    const params = new URLSearchParams({ category_group_code: SUBWAY_STATION_CODE, size: '1', sort: 'distance' });
    this.addNearby(params, { center, radiusMeters });
    const [doc] = await this.requestDocuments('category', params);
    if (!doc) return null;
    const lat = Number(doc.y);
    const lng = Number(doc.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // "성수역 2호선" → "성수역"
    const name = /^(\S+?역)/.exec(doc.place_name)?.[1] ?? doc.place_name;
    return { name, lat, lng };
  }

  private addNearby(params: URLSearchParams, near: NearbyOptions) {
    params.set('x', String(near.center.lng)); // x = 경도
    params.set('y', String(near.center.lat)); // y = 위도
    params.set('radius', String(Math.min(20000, Math.max(0, Math.round(near.radiusMeters)))));
  }

  private async request(kind: 'keyword' | 'category', params: URLSearchParams): Promise<KakaoPlace[]> {
    const docs = await this.requestDocuments(kind, params);
    return docs.flatMap((d): KakaoPlace[] => {
      const lng = Number(d.x);
      const lat = Number(d.y);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [
        {
          kakaoPlaceId: d.id,
          name: d.place_name,
          category: classifyKakaoCategory(d.category_group_code, d.category_name),
          subCategory: lastCategoryPart(d.category_name),
          address: d.road_address_name || d.address_name,
          lat,
          lng,
          placeUrl: d.place_url,
        },
      ];
    });
  }

  private async requestDocuments(kind: 'keyword' | 'category', params: URLSearchParams) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE_URL}/${kind}.json?${params}`, {
        headers: { Authorization: `KakaoAK ${this.restApiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new KakaoApiError(`카카오 API 연결 실패: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const reason = res.status === 429 ? '무료 사용량(쿼터) 초과' : `HTTP ${res.status}`;
      throw new KakaoApiError(`카카오 API 오류: ${reason}`, res.status);
    }

    const parsed = responseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new KakaoApiError('카카오 API 응답 형식이 예상과 다릅니다.');
    return parsed.data.documents;
  }
}
