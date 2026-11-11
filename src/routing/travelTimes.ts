import { z } from 'zod';
import { estimateTravel } from '../geo.js';
import type { LatLng, Transport } from '../types.js';

/** 두 지점 사이 이동 정보 */
export interface Leg {
  minutes: number;
  distanceMeters: number;
  /** true = 길찾기 API 대신 직선거리로 추정한 값 */
  estimated: boolean;
}

/** 이동 시간 계산기. 길찾기 API 가 없거나 실패하면 직선거리 추정으로 대신함 */
export interface TravelTimes {
  leg(from: LatLng, to: LatLng, mode: Transport): Promise<Leg>;
}

/** 길찾기 API 없이 직선거리로만 추정 */
export const estimatedTravelTimes: TravelTimes = {
  async leg(from, to, mode) {
    return { ...estimateTravel(from, to, mode), estimated: true };
  },
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 자동차는 도착 후 주차 시간을 더함 (길찾기 API 는 주차 시간을 모름) */
export const PARKING_MINUTES = 5;

/**
 * 카카오 길찾기
 * - 도보: 카카오맵 도보 경로 조회 GET https://dapi.kakao.com/v2/routing/walk (2026-07-21 신규)
 * - 자동차: 카카오모빌리티 GET https://apis-navi.kakaomobility.com/v1/directions
 *   ※ 자동차 길찾기는 상업적으로 쓰면 무료 범위 안이라도 사전 제휴가 필요해요.
 * 좌표는 "경도,위도" 순서입니다.
 *
 * ⚠️ 도보 API 응답 형식은 문서로 최종 확인하지 못했습니다. 형식이 다르면 직선거리 추정으로 대신하니
 *    `npm run test:kakao` 로 실제 응답을 꼭 확인하세요.
 */
export class KakaoTravelTimes implements TravelTimes {
  private readonly cache = new Map<string, { leg: Leg; expiresAt: number }>();

  constructor(
    private readonly restApiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 3000,
    private readonly now: () => number = Date.now,
    private readonly onFallback: (reason: string) => void = (r) => console.warn('[routing]', r),
  ) {
    if (!restApiKey) throw new Error('KAKAO_REST_API_KEY 가 비어 있습니다.');
  }

  async leg(from: LatLng, to: LatLng, mode: Transport): Promise<Leg> {
    const key = `${mode}:${from.lng.toFixed(5)},${from.lat.toFixed(5)}>${to.lng.toFixed(5)},${to.lat.toFixed(5)}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.leg;

    let leg: Leg;
    try {
      const real = mode === 'walk' ? await this.walk(from, to) : await this.car(from, to);
      leg = { ...real, estimated: false };
      this.cache.set(key, { leg, expiresAt: this.now() + 6 * 60 * 60 * 1000 }); // 6시간
      while (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
    } catch (e) {
      this.onFallback((e as Error).message);
      leg = { ...estimateTravel(from, to, mode), estimated: true };
    }
    return leg;
  }

  private async walk(from: LatLng, to: LatLng) {
    const params = new URLSearchParams({ origin: `${from.lng},${from.lat}`, destination: `${to.lng},${to.lat}` });
    const body = await this.get(`https://dapi.kakao.com/v2/routing/walk?${params}`);
    const s = readSummary(body);
    if (!s) throw new Error('도보 경로 응답 형식이 예상과 달라요.');
    return { minutes: Math.max(0, Math.ceil(s.duration / 60)), distanceMeters: Math.round(s.distance) };
  }

  private async car(from: LatLng, to: LatLng) {
    const params = new URLSearchParams({
      origin: `${from.lng},${from.lat}`,
      destination: `${to.lng},${to.lat}`,
      priority: 'RECOMMEND',
      summary: 'true',
    });
    const body = carSchema.safeParse(await this.get(`https://apis-navi.kakaomobility.com/v1/directions?${params}`));
    const route = body.success ? body.data.routes[0] : undefined;
    if (!route) throw new Error('자동차 경로 응답 형식이 예상과 달라요.');
    if (route.result_code === 104) return { minutes: 0, distanceMeters: 0 }; // 출발지와 도착지가 너무 가까움
    if (route.result_code !== 0 || !route.summary) throw new Error(`자동차 경로 없음 (code ${route.result_code})`);
    return {
      minutes: Math.ceil(route.summary.duration / 60) + PARKING_MINUTES,
      distanceMeters: Math.round(route.summary.distance),
    };
  }

  private async get(url: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `KakaoAK ${this.restApiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new Error(`길찾기 API 연결 실패: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`길찾기 API 오류: ${res.status === 429 ? '쿼터 초과' : `HTTP ${res.status}`}`);
    return res.json().catch(() => null);
  }
}

const summarySchema = z.object({ distance: z.number().nonnegative(), duration: z.number().nonnegative() });
const carSchema = z.object({
  routes: z
    .array(z.object({ result_code: z.number(), summary: summarySchema.optional() }))
    .min(1),
});

/** 여러 응답 모양을 너그럽게 읽음: routes[0].summary / summary / 최상위 distance·duration */
function readSummary(body: unknown): { distance: number; duration: number } | null {
  const tries: unknown[] = [];
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const routes = b.routes;
    if (Array.isArray(routes) && routes[0] && typeof routes[0] === 'object') {
      const r = routes[0] as Record<string, unknown>;
      if (typeof r.result_code === 'number' && r.result_code !== 0) return null;
      tries.push(r.summary, r);
    }
    tries.push(b.summary, b);
  }
  for (const t of tries) {
    const p = summarySchema.safeParse(t);
    if (p.success) return p.data;
  }
  return null;
}
