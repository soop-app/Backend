import { distanceMeters, estimateTravel } from '../geo.js';
import type { KakaoLocalClient, KakaoPlace } from '../kakao/kakaoLocalClient.js';
import type { PlaceRepository } from '../places/placeRepository.js';
import { formatMinutes, isOpenDuring } from '../time.js';
import {
  CATEGORIES,
  DEFAULT_STAY_MINUTES,
  type Candidate,
  type Category,
  type LatLng,
  type Place,
  type Transport,
} from '../types.js';

/** 추천 요청 (검증이 끝난 값) */
export interface CourseRequest {
  region?: string;
  center?: LatLng;
  day: number; // 0=일 ... 6=토
  date: string;
  startMinutes: number;
  endMinutes: number;
  budget: number; // 두 사람 합산, 원
  transport: Transport;
  mustVisit?: string;
  preferredTags: string[];
}

export interface CourseStop {
  order: number;
  name: string;
  category: Category;
  address: string;
  lat: number;
  lng: number;
  source: 'db' | 'kakao';
  kakaoPlaceUrl: string | null;
  arriveAt: string;
  leaveAt: string;
  stayMinutes: number;
  costForTwo: number | null; // 모르면 null
  priceVerified: boolean;
  hoursVerified: boolean;
  isMustVisit: boolean;
  travelFromPrevious: { mode: Transport; minutes: number; distanceMeters: number; estimated: true } | null;
}

export interface CourseResult {
  stops: CourseStop[];
  summary: {
    date: string;
    startAt: string;
    endAt: string;
    totalMinutes: number;
    estimatedCostForTwo: number; // 가격을 아는 장소만 합산
    budget: number;
    budgetLeft: number;
  };
  warnings: string[];
}

export { RegionNotFoundError } from '../errors.js';
import { RegionNotFoundError } from '../errors.js';

export type KakaoSearch = Pick<KakaoLocalClient, 'searchKeyword' | 'searchCategory'>;

export interface RecommendDeps {
  places: PlaceRepository;
  kakao: KakaoSearch | null; // 키가 없으면 null
}

/** 카테고리별 우리 DB 후보가 이보다 적으면 카카오로 보충 */
const MIN_DB_PER_CATEGORY = 2;
const SEARCH_RADIUS: Record<Transport, number> = { walk: 1500, car: 5000 };
const MEAL_WINDOWS: Array<[number, number]> = [
  [11 * 60, 14 * 60], // 점심
  [17 * 60, 20 * 60 + 30], // 저녁
];

function fromPlace(p: Place): Candidate {
  return {
    key: `db:${p.id}`,
    source: 'db',
    name: p.name,
    category: p.category,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    pricePerPerson: Math.round((p.priceMin + p.priceMax) / 2),
    stayMinutes: p.stayMinutes,
    tags: p.tags,
    hours: p.hours,
    kakaoPlaceUrl: p.kakaoPlaceId ? `https://place.map.kakao.com/${p.kakaoPlaceId}` : null,
  };
}

function fromKakao(k: KakaoPlace, category: Category): Candidate {
  return {
    key: `kakao:${k.kakaoPlaceId}`,
    source: 'kakao',
    name: k.name,
    category,
    address: k.address,
    lat: k.lat,
    lng: k.lng,
    pricePerPerson: null,
    stayMinutes: DEFAULT_STAY_MINUTES[category],
    tags: [],
    hours: null,
    kakaoPlaceUrl: k.placeUrl || null,
  };
}

/** 데이트 시간이 길수록 들를 곳을 늘림 */
function maxStopsFor(minutes: number): number {
  if (minutes < 150) return 2;
  if (minutes < 270) return 3;
  return 4;
}

const inMealTime = (t: number) => MEAL_WINDOWS.some(([s, e]) => s <= t && t <= e);

/**
 * 코스 추천 (규칙 기반, AI 없음)
 * 1) 후보 모으기: 우리 DB → 모자라면 카카오 실시간 검색으로 보충
 * 2) 앞에서부터 한 곳씩: 영업시간·남은 시간·예산을 만족하는 후보 중 점수가 가장 높은 곳 선택
 */
export async function recommendCourse(req: CourseRequest, deps: RecommendDeps): Promise<CourseResult> {
  const warnings: string[] = [];
  const kakaoFailed = (err: unknown) => {
    const msg = '카카오 장소 검색에 실패해서 우리 DB 장소만으로 추천했어요.';
    if (!warnings.includes(msg)) warnings.push(msg);
    console.warn('[kakao]', (err as Error).message);
  };

  // ── 1. 후보 모으기 ─────────────────────────────
  const dbPlaces = req.region
    ? await deps.places.findActiveByRegion(req.region)
    : await deps.places.findActiveNear(req.center!, SEARCH_RADIUS[req.transport]);

  const center = req.center ?? (await resolveCenter(req.region!, dbPlaces, deps, kakaoFailed));

  const candidates: Candidate[] = dbPlaces.map(fromPlace);
  const linkedKakaoIds = new Set(dbPlaces.map((p) => p.kakaoPlaceId).filter(Boolean));

  if (deps.kakao) {
    const lacking = CATEGORIES.filter(
      (c) => candidates.filter((x) => x.category === c).length < MIN_DB_PER_CATEGORY,
    );
    const results = await Promise.allSettled(
      lacking.map((c) =>
        deps.kakao!.searchCategory(c, { center, radiusMeters: SEARCH_RADIUS[req.transport] * 0.7, size: 5 }),
      ),
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') return kakaoFailed(r.reason);
      for (const k of r.value) {
        if (linkedKakaoIds.has(k.kakaoPlaceId)) continue; // 이미 우리 DB에 있는 장소
        candidates.push(fromKakao(k, lacking[i]!));
      }
    });
  }

  // 꼭 가고 싶은 장소 찾기
  let mustVisit: Candidate | null = null;
  if (req.mustVisit) {
    mustVisit = await findMustVisit(req.mustVisit, req.region, center, deps, kakaoFailed);
    if (!mustVisit) warnings.push(`'${req.mustVisit}' 장소를 찾지 못해서 코스에 넣지 못했어요.`);
    else if (!candidates.some((c) => c.key === mustVisit!.key)) candidates.push(mustVisit);
  }

  // ── 2. 코스 짜기 ───────────────────────────────
  const maxStops = maxStopsFor(req.endMinutes - req.startMinutes);
  const stops: CourseStop[] = [];
  const used = new Set<string>();
  const usedCategories = new Set<Category>();
  let now = req.startMinutes;
  let spent = 0;
  let prev: Candidate | null = null;

  const evaluate = (c: Candidate) => {
    if (used.has(c.key)) return null;
    const travel = prev ? estimateTravel(prev, c, req.transport) : { minutes: 0, distanceMeters: 0 };
    const arrive = now + travel.minutes;
    const leave = arrive + c.stayMinutes;
    if (leave > req.endMinutes) return null;
    if (c.hours && !isOpenDuring(c.hours, req.day, arrive, leave)) return null;
    const cost = c.pricePerPerson === null ? null : c.pricePerPerson * 2;
    if (cost !== null && spent + cost > req.budget) return null;
    return { travel, arrive, leave, cost };
  };

  const score = (c: Candidate, e: NonNullable<ReturnType<typeof evaluate>>) => {
    let s = 0;
    s += 3 * c.tags.filter((t) => req.preferredTags.includes(t)).length; // 취향 일치
    if (c.category === 'restaurant') s += inMealTime(e.arrive) ? 5 : -2; // 식사 시간엔 식당
    if (prev?.category === 'restaurant' && c.category === 'cafe') s += 2; // 밥 먹고 카페
    s -= e.travel.minutes * 0.2; // 가까울수록 좋음
    if (e.cost !== null && req.budget > 0) s -= (e.cost / req.budget) * 3; // 한 곳에 예산 몰빵 방지
    if (c.source === 'kakao') s -= 2; // 직접 확인한 장소 우선
    return s;
  };

  while (stops.length < maxStops) {
    let pick: { c: Candidate; e: NonNullable<ReturnType<typeof evaluate>> } | null = null;

    // 꼭 가고 싶은 장소는 들어갈 수 있는 가장 이른 순서에 넣음
    const mustEval = mustVisit && !used.has(mustVisit.key) ? evaluate(mustVisit) : null;
    if (mustVisit && mustEval) {
      pick = { c: mustVisit, e: mustEval };
    } else {
      let best = -Infinity;
      for (const c of candidates) {
        if (usedCategories.has(c.category)) continue; // 같은 종류는 한 번씩만
        const e = evaluate(c);
        if (!e) continue;
        const s = score(c, e);
        if (s > best || (s === best && pick && c.key < pick.c.key)) {
          best = s;
          pick = { c, e };
        }
      }
    }
    if (!pick) break;

    const { c, e } = pick;
    stops.push({
      order: stops.length + 1,
      name: c.name,
      category: c.category,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      source: c.source,
      kakaoPlaceUrl: c.kakaoPlaceUrl,
      arriveAt: formatMinutes(e.arrive),
      leaveAt: formatMinutes(e.leave),
      stayMinutes: c.stayMinutes,
      costForTwo: e.cost,
      priceVerified: c.pricePerPerson !== null,
      hoursVerified: c.hours !== null,
      isMustVisit: c.key === mustVisit?.key,
      travelFromPrevious: prev
        ? { mode: req.transport, minutes: e.travel.minutes, distanceMeters: e.travel.distanceMeters, estimated: true }
        : null,
    });
    used.add(c.key);
    usedCategories.add(c.category);
    spent += e.cost ?? 0;
    now = e.leave;
    prev = c;
  }

  // ── 3. 안내 문구 ───────────────────────────────
  if (mustVisit && !used.has(mustVisit.key)) {
    warnings.push(`'${mustVisit.name}'은(는) 영업시간·예산·시간 조건이 맞지 않아 코스에 넣지 못했어요.`);
  }
  if (stops.length === 0) warnings.push('조건에 맞는 장소를 찾지 못했어요. 시간이나 예산을 늘려 보세요.');
  else if (stops.length === 1) warnings.push('조건에 맞는 장소가 1곳뿐이에요. 시간이나 예산을 늘려 보세요.');
  if (stops.some((s) => !s.priceVerified || !s.hoursVerified)) {
    warnings.push('카카오에서 찾은 장소는 가격·영업시간이 확인되지 않아 예산 계산에서 빠졌어요. 방문 전 꼭 확인하세요.');
  }
  if (stops.length > 1) warnings.push('이동 시간은 직선거리로 계산한 추정치예요.');

  const first = stops[0];
  const last = stops[stops.length - 1];
  return {
    stops,
    summary: {
      date: req.date,
      startAt: first?.arriveAt ?? formatMinutes(req.startMinutes),
      endAt: last?.leaveAt ?? formatMinutes(req.startMinutes),
      totalMinutes: last ? now - req.startMinutes : 0,
      estimatedCostForTwo: spent,
      budget: req.budget,
      budgetLeft: req.budget - spent,
    },
    warnings,
  };
}

/** 지역 이름만 왔을 때 기준 좌표 정하기: 우리 DB 장소들의 가운데 → 없으면 카카오 검색 */
async function resolveCenter(
  region: string,
  dbPlaces: Place[],
  deps: RecommendDeps,
  onKakaoError: (e: unknown) => void,
): Promise<LatLng> {
  if (dbPlaces.length > 0) {
    return {
      lat: dbPlaces.reduce((s, p) => s + p.lat, 0) / dbPlaces.length,
      lng: dbPlaces.reduce((s, p) => s + p.lng, 0) / dbPlaces.length,
    };
  }
  if (deps.kakao) {
    try {
      const [hit] = await deps.kakao.searchKeyword(region);
      if (hit) return { lat: hit.lat, lng: hit.lng };
    } catch (e) {
      onKakaoError(e);
    }
  }
  throw new RegionNotFoundError(region);
}

async function findMustVisit(
  keyword: string,
  region: string | undefined,
  center: LatLng,
  deps: RecommendDeps,
  onKakaoError: (e: unknown) => void,
): Promise<Candidate | null> {
  const [db] = await deps.places.findActiveByName(keyword, region);
  if (db) return fromPlace(db);
  if (!deps.kakao) return null;
  try {
    const hits = await deps.kakao.searchKeyword(keyword, { center, radiusMeters: 20000, size: 5 });
    // 너무 먼 곳(20km 밖)이나 데이트 카테고리가 아닌 곳은 제외
    const hit = hits.find((h) => h.category !== null && distanceMeters(center, h) <= 20000);
    return hit ? fromKakao(hit, hit.category!) : null;
  } catch (e) {
    onKakaoError(e);
    return null;
  }
}
