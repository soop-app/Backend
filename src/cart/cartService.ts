import { ConflictError, PlaceNotFoundError } from '../errors.js';
import type { PlaceRepository } from '../places/placeRepository.js';
import type { PlaceSearchService } from '../places/placeSearch.js';
import { viewFromPlace } from '../places/placeView.js';
import { CART_MAX, toSnapshot, type CartItem, type CartRepository, type CartSettings } from './cartRepository.js';

export interface CartView {
  items: Array<CartItem & { order: number }>;
  count: number;
  max: number;
  /** 가격을 아는 장소만 더한 1인 비용(원) */
  costPerPerson: number;
  costForTwo: number;
  unknownPriceCount: number;
  /** 코스 설정 (출발 위치 · 이동 수단 · 예산) */
  settings: CartSettings;
  /** 예산 비교. 비용·예산 모두 두 사람 기준(원) */
  budget: {
    costForTwo: number;
    budgetMax: number | null;
    /** budgetMax - costForTwo. 예산을 안 정했으면 null, 넘으면 음수 */
    remaining: number | null;
    overBudget: boolean;
  };
}

/**
 * 경로 최적화(4주차)에 넘기는 묶음.
 * 장바구니 + 코스 설정에서 계산에 필요한 값만 뽑아 한 번에 줍니다.
 */
export interface RouteInput {
  /** 바로 경로 계산을 돌릴 수 있는지 */
  ready: boolean;
  /** 모자란 값: 'places'(장소 없음), 'start'(출발 위치 없음) */
  missing: Array<'places' | 'start'>;
  start: CartSettings['start'];
  transport: CartSettings['transport'];
  budgetMin: number | null;
  budgetMax: number | null;
  places: Array<{
    order: number;
    placeId: string;
    name: string;
    category: string;
    lat: number;
    lng: number;
    pinned: boolean;
    stayMinutes: number;
    pricePerPerson: number | null;
  }>;
}

export class CartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly places: PlaceRepository,
    private readonly search: PlaceSearchService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(userId: string): Promise<CartView> {
    const items = await this.carts.list(userId);
    // 우리 DB 장소는 가격 등이 바뀌었을 수 있으니 최신 정보로 다시 채움
    const fresh = await Promise.all(
      items.map(async (i) => {
        const m = /^db:(\d+)$/.exec(i.placeId);
        if (!m) return i;
        const p = await this.places.findActiveById(Number(m[1]));
        return p ? { ...i, place: toSnapshot(viewFromPlace(p, { tasteTags: [], cartKeys: new Set() })) } : i;
      }),
    );
    const known = fresh.filter((i) => i.place.pricePerPerson !== null);
    const costPerPerson = known.reduce((s, i) => s + i.place.pricePerPerson!, 0);
    const costForTwo = costPerPerson * 2;
    const settings = await this.carts.getSettings(userId);
    const remaining = settings.budgetMax === null ? null : settings.budgetMax - costForTwo;
    return {
      items: fresh.map((i, idx) => ({ ...i, order: idx + 1 })),
      count: fresh.length,
      max: CART_MAX,
      costPerPerson,
      costForTwo,
      unknownPriceCount: fresh.length - known.length,
      settings,
      budget: { costForTwo, budgetMax: settings.budgetMax, remaining, overBudget: remaining !== null && remaining < 0 },
    };
  }

  async keys(userId: string): Promise<Set<string>> {
    return new Set((await this.carts.list(userId)).map((i) => i.placeId));
  }

  async add(userId: string, placeId: string): Promise<CartView> {
    const view = await this.search.getById(placeId, { tasteTags: [], cartKeys: new Set() });
    const r = await this.carts.add(userId, {
      placeId: view.id,
      place: toSnapshot(view),
      pinned: false,
      addedAt: this.now().toISOString(),
    });
    if (r === 'full') throw new ConflictError('CART_FULL', `장소는 최대 ${CART_MAX}개까지 담을 수 있어요.`);
    return this.get(userId);
  }

  async remove(userId: string, placeId: string): Promise<CartView> {
    if (!(await this.carts.remove(userId, placeId))) throw new PlaceNotFoundError('장바구니에 없는 장소예요.');
    return this.get(userId);
  }

  async setPinned(userId: string, placeId: string, pinned: boolean): Promise<CartView> {
    if (!(await this.carts.setPinned(userId, placeId, pinned))) {
      throw new PlaceNotFoundError('장바구니에 없는 장소예요.');
    }
    return this.get(userId);
  }

  async reorder(userId: string, placeIds: string[]): Promise<CartView> {
    if (!(await this.carts.reorder(userId, placeIds))) {
      throw new ConflictError('CART_CHANGED', '장바구니에 담긴 장소와 순서 목록이 달라요. 새로고침 후 다시 시도해 주세요.');
    }
    return this.get(userId);
  }

  /** 코스 설정 저장 (통째로 바꿈) */
  async saveSettings(userId: string, settings: CartSettings): Promise<CartView> {
    await this.carts.saveSettings(userId, settings);
    return this.get(userId);
  }

  async routeInput(userId: string): Promise<RouteInput> {
    const view = await this.get(userId);
    const missing: RouteInput['missing'] = [];
    if (view.count === 0) missing.push('places');
    if (!view.settings.start) missing.push('start');
    return {
      ready: missing.length === 0,
      missing,
      start: view.settings.start,
      transport: view.settings.transport,
      budgetMin: view.settings.budgetMin,
      budgetMax: view.settings.budgetMax,
      places: view.items.map((i) => ({
        order: i.order,
        placeId: i.placeId,
        name: i.place.name,
        category: i.place.category,
        lat: i.place.lat,
        lng: i.place.lng,
        pinned: i.pinned,
        stayMinutes: i.place.stayMinutes,
        pricePerPerson: i.place.pricePerPerson,
      })),
    };
  }

  async items(userId: string): Promise<CartItem[]> {
    return this.carts.list(userId);
  }
}
