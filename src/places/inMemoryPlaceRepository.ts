import { distanceMeters } from '../geo.js';
import type { LatLng, Place } from '../types.js';
import type { PlaceRepository } from './placeRepository.js';
import { normalizeRegion } from './region.js';

/** DB 없이 돌려볼 때 쓰는 메모리 저장소 */
export class InMemoryPlaceRepository implements PlaceRepository {
  constructor(private readonly places: Place[]) {}

  async findActiveByRegion(region: string): Promise<Place[]> {
    const r = normalizeRegion(region);
    return this.places.filter((p) => p.region === r);
  }

  async findActiveNear(center: LatLng, radiusMeters: number): Promise<Place[]> {
    return this.places.filter((p) => distanceMeters(center, p) <= radiusMeters);
  }

  async findActiveByName(keyword: string, region?: string): Promise<Place[]> {
    const k = keyword.toLowerCase();
    const r = region === undefined ? undefined : normalizeRegion(region);
    return this.places.filter((p) => p.name.toLowerCase().includes(k) && (r === undefined || p.region === r));
  }

  async findActiveById(id: number): Promise<Place | null> {
    return this.places.find((p) => p.id === id) ?? null;
  }
}
