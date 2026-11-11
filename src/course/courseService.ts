import type { CartService } from '../cart/cartService.js';
import { ConflictError, PlaceNotFoundError } from '../errors.js';
import type { PlaceRepository } from '../places/placeRepository.js';
import type { KakaoPlaces } from '../places/placeSearch.js';
import { kakaoMapUrl } from '../places/placeView.js';
import { estimatedTravelTimes, type Leg, type TravelTimes } from '../routing/travelTimes.js';
import { formatMinutes } from '../time.js';
import type { Category, LatLng, Transport } from '../types.js';
import { estimateTravel } from '../geo.js';
import { optimizeRoute, RouteNotPossibleError, type RoutePlace } from './optimizeRoute.js';

export interface OptimizeRequest {
  userId: string;
  date: string;
  day: number;
  startMinutes: number;
  endMinutes?: number;
  start: { name: string; lat?: number; lng?: number };
  transport: Transport;
  budgetMin?: number; // 2인 총예산 범위 (원)
  budgetMax?: number;
}

export interface CourseStop {
  order: number;
  placeId: string;
  name: string;
  category: Category;
  categoryLabel: string;
  subCategory: string | null;
  imageUrl: string | null;
  address: string;
  lat: number;
  lng: number;
  pinned: boolean;
  arriveAt: string;
  startAt: string; // 문 열 때까지 기다리면 arriveAt 보다 늦음
  leaveAt: string;
  waitMinutes: number;
  stayMinutes: number;
  costPerPerson: number | null;
  priceVerified: boolean;
  hoursVerified: boolean;
  travelFromPrevious: { mode: Transport; minutes: number; distanceMeters: number; estimated: boolean };
  mapUrl: string;
  /** 이전 위치 → 이 장소 길찾기 (카카오맵) */
  directionsUrl: string;
}

export interface CourseResult {
  date: string;
  transport: Transport;
  start: { name: string; lat: number; lng: number; departAt: string };
  stops: CourseStop[];
  dropped: Array<{ placeId: string; name: string; reason: string }>;
  summary: {
    startAt: string;
    endAt: string;
    totalMinutes: number; // 출발부터 마지막 장소를 나올 때까지
    travelMinutes: number;
    waitMinutes: number;
    placeCount: number;
    /** 가격을 아는 장소만 더한 값 */
    costPerPerson: number;
    costForTwo: number;
    unknownPriceCount: number;
    budgetMin: number | null;
    budgetMax: number | null;
    /** 2인 비용 기준 남은 예산 (budgetMax 가 없으면 null) */
    budgetLeft: number | null;
  };
  warnings: string[];
}

const directions = (from: LatLng & { name: string }, to: LatLng & { name: string }) =>
  `https://map.kakao.com/link/from/${encodeURIComponent(from.name)},${from.lat},${from.lng}` +
  `/to/${encodeURIComponent(to.name)},${to.lat},${to.lng}`;

export class CourseService {
  constructor(
    private readonly cart: CartService,
    private readonly places: PlaceRepository,
    private readonly kakao: KakaoPlaces | null,
    private readonly travel: TravelTimes = estimatedTravelTimes,
  ) {}

  /** 길찾기로 구한 구간을 기억해 두고, 아직 모르는 구간은 직선거리 추정으로 */
  private planWithRealLegs(base: Omit<Parameters<typeof optimizeRoute>[0], 'travel'>) {
    const known = new Map<string, Leg>();
    const keyOf = (fromId: string, toId: string) => `${fromId}>${toId}`;
    const pointOf = (id: string) => (id === 'start' ? base.start : base.places.find((p) => p.placeId === id)!);
    const run = () =>
      optimizeRoute({
        ...base,
        travel: (fromId, from, to) =>
          known.get(keyOf(fromId, to.placeId)) ?? {
            ...estimateTravel(from, to, base.transport),
            estimated: true,
          },
      });
    return async () => {
      // 1) 추정치로 순서를 정하고 2) 그 순서의 구간만 길찾기로 실제 값을 구해 3) 다시 계산 (최대 3번)
      for (let round = 0; round < 3; round++) {
        const plan = run();
        const missing: Array<[string, string]> = [];
        let prev = 'start';
        for (const st of plan.stops) {
          if (!known.has(keyOf(prev, st.place.placeId))) missing.push([prev, st.place.placeId]);
          prev = st.place.placeId;
        }
        if (missing.length === 0) return plan;
        const legs = await Promise.all(
          missing.map(([a, b]) => this.travel.leg(pointOf(a), pointOf(b), base.transport)),
        );
        missing.forEach(([a, b], i) => known.set(keyOf(a, b), legs[i]!));
      }
      return run();
    };
  }

  async optimize(req: OptimizeRequest): Promise<CourseResult> {
    const items = await this.cart.items(req.userId);
    if (items.length === 0) throw new ConflictError('CART_EMPTY', '내 코스에 담긴 장소가 없어요. 장소를 먼저 담아 주세요.');

    const start = await this.resolveStart(req.start);

    // 우리 DB 장소는 영업시간을 함께 가져옴
    const routePlaces: RoutePlace[] = await Promise.all(
      items.map(async (i, idx) => {
        const m = /^db:(\d+)$/.exec(i.placeId);
        const p = m ? await this.places.findActiveById(Number(m[1])) : null;
        return {
          placeId: i.placeId,
          name: p?.name ?? i.place.name,
          lat: p?.lat ?? i.place.lat,
          lng: p?.lng ?? i.place.lng,
          stayMinutes: p?.stayMinutes ?? i.place.stayMinutes,
          pinned: i.pinned,
          hours: p ? p.hours : null,
          userOrder: idx,
        };
      }),
    );

    let plan;
    try {
      plan = await this.planWithRealLegs({
        start,
        day: req.day,
        startMinutes: req.startMinutes,
        endMinutes: req.endMinutes,
        transport: req.transport,
        places: routePlaces,
      })();
    } catch (e) {
      if (e instanceof RouteNotPossibleError) throw new ConflictError('COURSE_NOT_POSSIBLE', e.message);
      throw e;
    }

    const byId = new Map(items.map((i) => [i.placeId, i]));
    let prev: LatLng & { name: string } = start;
    const stops: CourseStop[] = plan.stops.map((s, idx) => {
      const item = byId.get(s.place.placeId)!;
      const here = { name: s.place.name, lat: s.place.lat, lng: s.place.lng };
      const stop: CourseStop = {
        order: idx + 1,
        placeId: s.place.placeId,
        name: s.place.name,
        category: item.place.category,
        categoryLabel: item.place.categoryLabel,
        subCategory: item.place.subCategory,
        imageUrl: item.place.imageUrl,
        address: item.place.address,
        lat: here.lat,
        lng: here.lng,
        pinned: s.place.pinned,
        arriveAt: formatMinutes(s.arrive),
        startAt: formatMinutes(s.begin),
        leaveAt: formatMinutes(s.leave),
        waitMinutes: s.wait,
        stayMinutes: s.place.stayMinutes,
        costPerPerson: item.place.pricePerPerson,
        priceVerified: item.place.priceVerified,
        hoursVerified: s.place.hours !== null,
        travelFromPrevious: {
          mode: req.transport,
          minutes: s.travel.minutes,
          distanceMeters: s.travel.distanceMeters,
          estimated: s.travel.estimated,
        },
        mapUrl: item.place.mapUrl || kakaoMapUrl(here.name, here),
        directionsUrl: directions(prev, here),
      };
      prev = here;
      return stop;
    });

    const known = stops.filter((s) => s.costPerPerson !== null);
    const costPerPerson = known.reduce((sum, s) => sum + s.costPerPerson!, 0);
    const costForTwo = costPerPerson * 2;
    const last = plan.stops[plan.stops.length - 1]!;

    const warnings: string[] = [];
    if (stops.some((s) => s.travelFromPrevious.estimated)) {
      warnings.push('일부 이동 시간은 길찾기 대신 직선거리로 계산한 추정치예요.');
    }
    if (stops.some((s) => !s.priceVerified || !s.hoursVerified)) {
      warnings.push('카카오에서 찾은 장소는 가격·영업시간이 확인되지 않아 비용·시간 계산이 정확하지 않을 수 있어요.');
    }
    if (stops.some((s) => s.waitMinutes > 0)) warnings.push('문 여는 시간을 기다려야 하는 장소가 있어요.');
    if (req.budgetMax !== undefined && costForTwo > req.budgetMax) {
      warnings.push(`예상 비용(2인 ${costForTwo.toLocaleString('ko-KR')}원)이 예산을 넘어요.`);
    }

    return {
      date: req.date,
      transport: req.transport,
      start: { ...start, departAt: formatMinutes(req.startMinutes) },
      stops,
      dropped: plan.dropped.map((d) => ({ placeId: d.place.placeId, name: d.place.name, reason: d.reason })),
      summary: {
        startAt: formatMinutes(req.startMinutes),
        endAt: formatMinutes(last.leave),
        totalMinutes: last.leave - req.startMinutes,
        travelMinutes: plan.travelMinutes,
        waitMinutes: plan.waitMinutes,
        placeCount: stops.length,
        costPerPerson,
        costForTwo,
        unknownPriceCount: stops.length - known.length,
        budgetMin: req.budgetMin ?? null,
        budgetMax: req.budgetMax ?? null,
        budgetLeft: req.budgetMax === undefined ? null : req.budgetMax - costForTwo,
      },
      warnings,
    };
  }

  /** 출발 위치: 좌표가 오면 그대로, 이름만 오면 카카오에서 찾음 (예: "성수역 3번 출구") */
  private async resolveStart(s: OptimizeRequest['start']): Promise<LatLng & { name: string }> {
    if (s.lat !== undefined && s.lng !== undefined) return { name: s.name, lat: s.lat, lng: s.lng };
    if (this.kakao) {
      const [hit] = await this.kakao.searchKeyword(s.name).catch(() => []);
      if (hit) return { name: s.name, lat: hit.lat, lng: hit.lng };
    }
    throw new PlaceNotFoundError(`출발 위치 '${s.name}'을(를) 찾지 못했어요. 지도에서 위치를 골라 주세요.`);
  }
}
