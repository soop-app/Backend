import { PlaceNotFoundError, RegionNotFoundError } from '../errors.js';
import { distanceMeters } from '../geo.js';
import type { KakaoLocalClient, KakaoPlace } from '../kakao/kakaoLocalClient.js';
import { CATEGORIES, type Category, type LatLng, type Transport } from '../types.js';
import type { PlaceRepository } from './placeRepository.js';
import { viewFromKakao, viewFromPlace, type PlaceView, type ViewContext } from './placeView.js';

export type KakaoPlaces = Pick<KakaoLocalClient, 'searchKeyword' | 'searchCategory' | 'findNearestStation'>;

export type SortBy = 'recommended' | 'price' | 'distance';

/** 검색 조건 (검증이 끝난 값) */
export interface SearchQuery {
  region?: string;
  center?: LatLng;
  keyword?: string;
  categories: Category[]; // 비어 있으면 전체
  indoor?: boolean;
  priceMin?: number; // 1인, 원
  priceMax?: number;
  openOnly: boolean; // 선택한 날짜·시간에 영업 중인 곳만 (영업시간을 모르는 곳은 빠짐)
  day?: number;
  window?: { start: number; end: number };
  transport: Transport;
  sort: SortBy;
  limit: number;
}

export interface SearchResult {
  region: string | null;
  center: LatLng;
  total: number;
  places: PlaceView[];
  warnings: string[];
}

const SEARCH_RADIUS: Record<Transport, number> = { walk: 1500, car: 5000 };
/** 카카오 결과 중 가까운 역을 계산해 줄 최대 개수 (카카오 사용량 보호) */
const STATION_LOOKUP_LIMIT = 10;
/** 상세 보기를 위해 검색된 카카오 장소를 잠깐 기억하는 시간 (대량 저장 아님) */
const KAKAO_CACHE_TTL_MS = 30 * 60 * 1000;
const KAKAO_CACHE_MAX = 2000;

interface CachedKakao {
  place: KakaoPlace & { category: Category };
  station: { name: string; lat: number; lng: number } | null;
  expiresAt: number;
}

export class PlaceSearchService {
  /** 카카오 장소 임시 기억: 검색 결과를 눌러 상세를 볼 때·장바구니에 담을 때 사용 */
  private readonly kakaoCache = new Map<string, CachedKakao>();
  /** 카카오 장소 → 가까운 역 계산 결과 재사용 */
  private readonly stationCache = new Map<string, { name: string; lat: number; lng: number } | null>();

  constructor(
    private readonly places: PlaceRepository,
    private readonly kakao: KakaoPlaces | null,
    private readonly now: () => number = Date.now,
  ) {}

  async search(q: SearchQuery, ctx: ViewContext): Promise<SearchResult> {
    const warnings: string[] = [];
    const kakaoFailed = (err: unknown) => {
      const msg = '카카오 장소 검색에 실패해서 등록된 장소만 보여드려요.';
      if (!warnings.includes(msg)) warnings.push(msg);
      console.warn('[kakao]', (err as Error).message);
    };

    // 1. 우리 DB
    const radius = SEARCH_RADIUS[q.transport];
    const dbPlaces = q.region
      ? await this.places.findActiveByRegion(q.region)
      : await this.places.findActiveNear(q.center!, radius);
    const center = q.center ?? (await this.resolveCenter(q.region!, dbPlaces, kakaoFailed));

    const wanted = q.categories.length > 0 ? q.categories : [...CATEGORIES];
    const keyword = q.keyword?.toLowerCase();
    let views: PlaceView[] = dbPlaces
      .filter((p) => wanted.includes(p.category))
      .filter((p) => !keyword || p.name.toLowerCase().includes(keyword) || p.tags.some((t) => t.includes(keyword)))
      .map((p) => viewFromPlace(p, ctx));

    // 2. 카카오 (요청이 올 때만 실시간 조회)
    if (this.kakao) {
      const linked = new Set(dbPlaces.map((p) => p.kakaoPlaceId).filter(Boolean));
      const found = await this.searchKakao(q, wanted, center, radius, kakaoFailed);
      const fresh = found.filter((k) => !linked.has(k.kakaoPlaceId));
      const stations = await this.lookupStations(fresh.slice(0, STATION_LOOKUP_LIMIT), kakaoFailed);
      for (const k of fresh) {
        const station = stations.get(k.kakaoPlaceId) ?? null;
        this.remember(k, station);
        views.push(viewFromKakao(k, station, ctx));
      }
    }

    // 3. 필터 (정보를 모르는 곳은 해당 필터를 걸면 빠짐)
    if (q.indoor !== undefined) views = views.filter((v) => v.isIndoor === q.indoor);
    if (q.priceMin !== undefined) views = views.filter((v) => v.pricePerPerson !== null && v.pricePerPerson >= q.priceMin!);
    if (q.priceMax !== undefined) views = views.filter((v) => v.pricePerPerson !== null && v.pricePerPerson <= q.priceMax!);
    if (q.openOnly) views = views.filter((v) => v.openStatus === 'open');

    // 4. 정렬
    const dist = (v: PlaceView) => distanceMeters(center, v);
    const sorters: Record<SortBy, (a: PlaceView, b: PlaceView) => number> = {
      recommended: (a, b) =>
        (b.matchPercent ?? -1) - (a.matchPercent ?? -1) ||
        Number(b.source === 'db') - Number(a.source === 'db') ||
        dist(a) - dist(b),
      price: (a, b) =>
        (a.pricePerPerson ?? Number.MAX_SAFE_INTEGER) - (b.pricePerPerson ?? Number.MAX_SAFE_INTEGER) || dist(a) - dist(b),
      distance: (a, b) => dist(a) - dist(b),
    };
    views.sort(sorters[q.sort]);

    if (views.some((v) => v.source === 'kakao')) {
      warnings.push('카카오에서 찾은 장소는 가격·영업시간이 확인되지 않았어요. 방문 전 꼭 확인하세요.');
    }

    return {
      region: q.region ?? null,
      center,
      total: views.length,
      places: views.slice(0, q.limit),
      warnings,
    };
  }

  /** 장소 하나 (상세 화면). 카카오 장소는 최근 검색 결과에 있을 때만 */
  async getById(id: string, ctx: ViewContext): Promise<PlaceView> {
    const m = /^(db|kakao):([A-Za-z0-9]{1,30})$/.exec(id);
    if (!m) throw new PlaceNotFoundError();
    if (m[1] === 'db') {
      const p = await this.places.findActiveById(Number(m[2]));
      if (!p) throw new PlaceNotFoundError();
      return viewFromPlace(p, ctx);
    }
    const cached = this.recall(m[2]!);
    if (!cached) throw new PlaceNotFoundError('장소 정보가 만료됐어요. 다시 검색해 주세요.');
    return viewFromKakao(cached.place, cached.station, ctx);
  }

  private async searchKakao(
    q: SearchQuery,
    wanted: Category[],
    center: LatLng,
    radius: number,
    onError: (e: unknown) => void,
  ): Promise<Array<KakaoPlace & { category: Category }>> {
    const near = { center, radiusMeters: radius, size: 5 };
    const jobs: Array<Promise<KakaoPlace[]>> = q.keyword
      ? [this.kakao!.searchKeyword(q.keyword, { ...near, size: 15 })]
      : wanted.map((c) => this.kakao!.searchCategory(c, near));
    const settled = await Promise.allSettled(jobs);
    const seen = new Set<string>();
    const out: Array<KakaoPlace & { category: Category }> = [];
    for (const r of settled) {
      if (r.status === 'rejected') {
        onError(r.reason);
        continue;
      }
      for (const k of r.value) {
        if (k.category === null || !wanted.includes(k.category) || seen.has(k.kakaoPlaceId)) continue;
        seen.add(k.kakaoPlaceId);
        out.push(k as KakaoPlace & { category: Category });
      }
    }
    return out;
  }

  private async lookupStations(list: KakaoPlace[], onError: (e: unknown) => void) {
    const result = new Map<string, { name: string; lat: number; lng: number } | null>();
    await Promise.all(
      list.map(async (k) => {
        if (this.stationCache.has(k.kakaoPlaceId)) {
          result.set(k.kakaoPlaceId, this.stationCache.get(k.kakaoPlaceId)!);
          return;
        }
        try {
          const s = await this.kakao!.findNearestStation(k);
          this.stationCache.set(k.kakaoPlaceId, s);
          if (this.stationCache.size > KAKAO_CACHE_MAX) {
            this.stationCache.delete(this.stationCache.keys().next().value!);
          }
          result.set(k.kakaoPlaceId, s);
        } catch (e) {
          onError(e);
        }
      }),
    );
    return result;
  }

  private remember(place: KakaoPlace & { category: Category }, station: CachedKakao['station']) {
    this.kakaoCache.delete(place.kakaoPlaceId);
    this.kakaoCache.set(place.kakaoPlaceId, { place, station, expiresAt: this.now() + KAKAO_CACHE_TTL_MS });
    while (this.kakaoCache.size > KAKAO_CACHE_MAX) {
      this.kakaoCache.delete(this.kakaoCache.keys().next().value!);
    }
  }

  private recall(kakaoId: string): CachedKakao | null {
    const c = this.kakaoCache.get(kakaoId);
    if (!c) return null;
    if (c.expiresAt < this.now()) {
      this.kakaoCache.delete(kakaoId);
      return null;
    }
    return c;
  }

  private async resolveCenter(
    region: string,
    dbPlaces: Array<{ lat: number; lng: number }>,
    onError: (e: unknown) => void,
  ): Promise<LatLng> {
    if (dbPlaces.length > 0) {
      return {
        lat: dbPlaces.reduce((s, p) => s + p.lat, 0) / dbPlaces.length,
        lng: dbPlaces.reduce((s, p) => s + p.lng, 0) / dbPlaces.length,
      };
    }
    if (this.kakao) {
      try {
        const [hit] = await this.kakao.searchKeyword(region);
        if (hit) return { lat: hit.lat, lng: hit.lng };
      } catch (e) {
        onError(e);
      }
    }
    throw new RegionNotFoundError(region);
  }
}
