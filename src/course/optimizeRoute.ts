import { estimateTravel } from '../geo.js';
import type { Leg } from '../routing/travelTimes.js';
import { isOpenDuring, parseHHmm } from '../time.js';
import type { LatLng, OpeningHours, Transport } from '../types.js';

/** 경로 최적화에 들어가는 장소 하나 */
export interface RoutePlace {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  stayMinutes: number;
  pinned: boolean; // 필수 장소: 반드시 코스에 들어가야 함
  hours: OpeningHours[] | null; // null = 영업시간 모름 (카카오 장소)
  userOrder: number; // 사용자가 장바구니에서 정한 순서 (0부터)
}

export interface RouteInput {
  start: LatLng & { name: string };
  day: number; // 0=일 ... 6=토
  startMinutes: number; // 출발 시각 (자정부터 분)
  endMinutes?: number; // 이 시각까지 끝나야 함 (없으면 제한 없음, 단 자정 전)
  transport: Transport;
  places: RoutePlace[];
  /**
   * 두 지점 사이 이동 정보. fromId 는 'start' 또는 장소 id.
   * 없으면 직선거리 추정 (길찾기 결과를 미리 구해 두고 여기서 꺼내 씀)
   */
  travel?: (fromId: string, from: LatLng, to: RoutePlace) => Leg;
}

export interface PlannedStop {
  place: RoutePlace;
  travel: Leg;
  arrive: number;
  wait: number; // 문 열 때까지 기다린 시간(분)
  begin: number; // 실제 시작 시각
  leave: number;
}

export interface RoutePlan {
  stops: PlannedStop[];
  dropped: Array<{ place: RoutePlace; reason: string }>;
  travelMinutes: number;
  waitMinutes: number;
}

export class RouteNotPossibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteNotPossibleError';
  }
}

const DAY_END = 24 * 60;

/** 도착한 뒤 머무는 동안 계속 영업 중인 가장 이른 시작 시각 (없으면 null) */
function earliestStart(hours: OpeningHours[] | null, day: number, arrive: number, stay: number, limit: number) {
  if (hours === null) return arrive + stay <= limit ? arrive : null; // 모르면 그대로
  const opens = hours
    .filter((h) => h.day === day)
    .map((h) => parseHHmm(h.open))
    .filter((m): m is number => m !== null && m > arrive);
  for (const t of [arrive, ...opens.sort((a, b) => a - b)]) {
    if (t + stay > limit) return null;
    if (isOpenDuring(hours, day, t, t + stay)) return t;
  }
  return null;
}

/** 정해진 순서대로 돌았을 때의 일정 (불가능하면 null) */
function simulate(order: RoutePlace[], input: RouteInput): Omit<RoutePlan, 'dropped'> | null {
  const limit = Math.min(input.endMinutes ?? DAY_END, DAY_END);
  const travelOf =
    input.travel ?? ((_id: string, from: LatLng, to: RoutePlace) => ({ ...estimateTravel(from, to, input.transport), estimated: true }));
  let atId = 'start';
  let at: LatLng = input.start;
  let now = input.startMinutes;
  let travelMinutes = 0;
  let waitMinutes = 0;
  const stops: PlannedStop[] = [];
  for (const p of order) {
    const travel = travelOf(atId, at, p);
    const arrive = now + travel.minutes;
    const begin = earliestStart(p.hours, input.day, arrive, p.stayMinutes, limit);
    if (begin === null) return null;
    const leave = begin + p.stayMinutes;
    stops.push({ place: p, travel, arrive, wait: begin - arrive, begin, leave });
    travelMinutes += travel.minutes;
    waitMinutes += begin - arrive;
    at = p;
    atId = p.placeId;
    now = leave;
  }
  return { stops, travelMinutes, waitMinutes };
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i]!, ...p];
  }
}

function* subsets<T>(items: T[], size: number, startAt = 0): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = startAt; i <= items.length - size; i++) {
    for (const rest of subsets(items, size - 1, i + 1)) yield [items[i]!, ...rest];
  }
}

/** 사용자 순서와 얼마나 다른지 (작을수록 사용자 순서에 가까움) */
function inversions(order: RoutePlace[]): number {
  let n = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) if (order[i]!.userOrder > order[j]!.userOrder) n++;
  return n;
}

/**
 * 방문 순서 최적화 (장소 최대 5개 → 모든 순서를 다 계산해도 325가지라 충분히 빠름)
 * 1) 필수 장소는 반드시 포함
 * 2) 가능한 한 많은 장소를 포함
 * 3) 이동 + 대기 시간이 가장 짧은 순서
 * 4) 같으면 사용자가 정한 순서에 가까운 쪽
 */
export function optimizeRoute(input: RouteInput): RoutePlan {
  if (input.places.length > 8) throw new RouteNotPossibleError('장소가 너무 많아요.');
  const pinned = input.places.filter((p) => p.pinned);
  const optional = input.places.filter((p) => !p.pinned);

  for (let extra = optional.length; extra >= 0; extra--) {
    let best: (Omit<RoutePlan, 'dropped'> & { cost: number; inv: number }) | null = null;
    for (const chosen of subsets(optional, extra)) {
      for (const order of permutations([...pinned, ...chosen])) {
        const sim = simulate(order, input);
        if (!sim) continue;
        const cost = sim.travelMinutes + sim.waitMinutes;
        const inv = inversions(order);
        if (!best || cost < best.cost || (cost === best.cost && inv < best.inv)) best = { ...sim, cost, inv };
      }
    }
    if (best) {
      const used = new Set(best.stops.map((s) => s.place.placeId));
      const dropped = input.places
        .filter((p) => !used.has(p.placeId))
        .map((p) => ({ place: p, reason: dropReason(p, input) }));
      return { stops: best.stops, travelMinutes: best.travelMinutes, waitMinutes: best.waitMinutes, dropped };
    }
  }

  // 필수 장소만으로도 안 됨 → 왜 안 되는지 알려줌
  const lonely = pinned.find((p) => simulate([p], input) === null);
  throw new RouteNotPossibleError(
    lonely
      ? `필수 장소 '${lonely.name}'이(가) 선택한 날짜·시간에 영업하지 않아요.`
      : '필수 장소를 모두 시간 안에 넣을 수 없어요. 시간을 늘리거나 필수 고정을 풀어 주세요.',
  );
}

function dropReason(p: RoutePlace, input: RouteInput): string {
  return simulate([p], input) === null
    ? '선택한 날짜·시간에 영업하지 않아서 뺐어요.'
    : '시간 안에 모두 넣을 수 없어서 뺐어요.';
}

