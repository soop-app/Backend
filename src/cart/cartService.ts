import { ConflictError, PlaceNotFoundError } from '../errors.js';
import type { PlaceRepository } from '../places/placeRepository.js';
import type { PlaceSearchService } from '../places/placeSearch.js';
import { viewFromPlace } from '../places/placeView.js';
import { CART_MAX, toSnapshot, type CartItem, type CartRepository } from './cartRepository.js';

export interface CartView {
  items: Array<CartItem & { order: number }>;
  count: number;
  max: number;
  /** 가격을 아는 장소만 더한 1인 비용(원) */
  costPerPerson: number;
  costForTwo: number;
  unknownPriceCount: number;
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
    return {
      items: fresh.map((i, idx) => ({ ...i, order: idx + 1 })),
      count: fresh.length,
      max: CART_MAX,
      costPerPerson,
      costForTwo: costPerPerson * 2,
      unknownPriceCount: fresh.length - known.length,
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

  async items(userId: string): Promise<CartItem[]> {
    return this.carts.list(userId);
  }
}
