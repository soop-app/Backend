import type { PlaceView } from '../places/placeView.js';

/** 장바구니에 저장해 두는 장소 정보 (화면 표시·경로 계산에 필요한 최소한만) */
export type PlaceSnapshot = Pick<
  PlaceView,
  | 'id'
  | 'source'
  | 'name'
  | 'category'
  | 'categoryLabel'
  | 'subCategory'
  | 'imageUrl'
  | 'address'
  | 'lat'
  | 'lng'
  | 'nearestStation'
  | 'pricePerPerson'
  | 'priceVerified'
  | 'stayMinutes'
  | 'mapUrl'
>;

export interface CartItem {
  placeId: string; // 'db:1' 또는 'kakao:12345'
  place: PlaceSnapshot;
  pinned: boolean; // 필수 장소로 고정
  addedAt: string; // ISO 시각
}

export const CART_MAX = 5;

/**
 * 장바구니 저장소. 메모리 버전(개발용)과 PostgreSQL 버전이 같은 모양을 따릅니다.
 * 목록은 항상 사용자가 정한 순서대로 돌려줍니다.
 */
export interface CartRepository {
  list(userId: string): Promise<CartItem[]>;
  /** 끝에 추가. 이미 있으면 그대로, 꽉 찼으면 'full' */
  add(userId: string, item: CartItem): Promise<'added' | 'exists' | 'full'>;
  /** 없으면 false */
  remove(userId: string, placeId: string): Promise<boolean>;
  /** 없으면 false */
  setPinned(userId: string, placeId: string, pinned: boolean): Promise<boolean>;
  /** placeIds 가 지금 담긴 목록과 정확히 같은 구성이어야 함. 아니면 false */
  reorder(userId: string, placeIds: string[]): Promise<boolean>;
}

export function toSnapshot(v: PlaceView): PlaceSnapshot {
  return {
    id: v.id,
    source: v.source,
    name: v.name,
    category: v.category,
    categoryLabel: v.categoryLabel,
    subCategory: v.subCategory,
    imageUrl: v.imageUrl,
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    nearestStation: v.nearestStation,
    pricePerPerson: v.pricePerPerson,
    priceVerified: v.priceVerified,
    stayMinutes: v.stayMinutes,
    mapUrl: v.mapUrl,
  };
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));

/** DB 없이 돌려볼 때 쓰는 메모리 저장소 */
export class InMemoryCartRepository implements CartRepository {
  private readonly carts = new Map<string, CartItem[]>();

  async list(userId: string) {
    return [...(this.carts.get(userId) ?? [])];
  }

  async add(userId: string, item: CartItem) {
    const cart = this.carts.get(userId) ?? [];
    if (cart.some((i) => i.placeId === item.placeId)) return 'exists' as const;
    if (cart.length >= CART_MAX) return 'full' as const;
    this.carts.set(userId, [...cart, item]);
    return 'added' as const;
  }

  async remove(userId: string, placeId: string) {
    const cart = this.carts.get(userId) ?? [];
    const next = cart.filter((i) => i.placeId !== placeId);
    this.carts.set(userId, next);
    return next.length !== cart.length;
  }

  async setPinned(userId: string, placeId: string, pinned: boolean) {
    const item = (this.carts.get(userId) ?? []).find((i) => i.placeId === placeId);
    if (!item) return false;
    item.pinned = pinned;
    return true;
  }

  async reorder(userId: string, placeIds: string[]) {
    const cart = this.carts.get(userId) ?? [];
    if (!sameSet(placeIds, cart.map((i) => i.placeId))) return false;
    this.carts.set(userId, placeIds.map((id) => cart.find((i) => i.placeId === id)!));
    return true;
  }
}

export { sameSet };
