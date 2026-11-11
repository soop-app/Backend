import { Router } from 'express';
import { z } from 'zod';
import type { CartService } from '../cart/cartService.js';
import type { PlaceRepository } from '../places/placeRepository.js';
import type { PlaceSearchService } from '../places/placeSearch.js';
import type { ViewContext } from '../places/placeView.js';
import { dayOfWeek, parseHHmm } from '../time.js';
import { CATEGORIES } from '../types.js';
import { commaList, dateStr, hhmm, optionalUserId, parseOr400, queryBool } from './common.js';

const won = (name: string) =>
  z.coerce
    .number({ error: `${name}은(는) 숫자여야 해요` })
    .int({ error: `${name}은(는) 소수점 없는 숫자여야 해요` })
    .min(0, { error: `${name}은(는) 0원 이상이어야 해요` })
    .max(10_000_000, { error: `${name}이(가) 너무 커요` });

/** GET /api/places/search 쿼리 규칙 */
export const searchQuerySchema = z
  .object({
    region: z.string().trim().min(1, { error: 'region이 비어 있어요' }).max(30, { error: 'region은 30글자까지만 돼요' }).optional(),
    lat: z.coerce.number({ error: 'lat은 숫자여야 해요' }).min(-90).max(90).optional(),
    lng: z.coerce.number({ error: 'lng은 숫자여야 해요' }).min(-180).max(180).optional(),
    q: z.string().trim().min(1, { error: 'q(검색어)가 비어 있어요' }).max(50, { error: '검색어는 50글자까지만 돼요' }).optional(),
    categories: commaList(z.enum(CATEGORIES, { error: `카테고리는 ${CATEGORIES.join(', ')} 중에서 골라 주세요` }))
      .optional()
      .default([]),
    indoor: queryBool.optional(),
    priceMin: won('priceMin').optional(),
    priceMax: won('priceMax').optional(),
    date: dateStr.optional(),
    startTime: hhmm.optional(),
    endTime: hhmm.optional(),
    openOnly: queryBool.optional().default(false),
    transport: z.enum(['walk', 'car'], { error: 'transport는 "walk" 또는 "car"여야 해요' }).optional().default('walk'),
    sort: z
      .enum(['recommended', 'price', 'distance'], { error: 'sort는 recommended, price, distance 중 하나예요' })
      .optional()
      .default('recommended'),
    tags: commaList(z.string().trim().min(1).max(20)).optional().default([]),
    limit: z.coerce.number().int().min(1).max(50).optional().default(30),
  })
  .strict()
  .refine((q) => q.region !== undefined || (q.lat !== undefined && q.lng !== undefined), {
    error: 'region 또는 lat·lng 중 하나는 꼭 보내야 해요',
    path: ['region'],
  })
  .refine((q) => q.priceMin === undefined || q.priceMax === undefined || q.priceMin <= q.priceMax, {
    error: 'priceMin은 priceMax보다 클 수 없어요',
    path: ['priceMin'],
  })
  .refine((q) => (q.startTime === undefined) === (q.endTime === undefined), {
    error: 'startTime과 endTime은 함께 보내야 해요',
    path: ['endTime'],
  })
  .refine((q) => !q.startTime || !q.endTime || parseHHmm(q.endTime)! > parseHHmm(q.startTime)!, {
    error: '종료 시간은 시작 시간보다 뒤여야 해요',
    path: ['endTime'],
  })
  .refine((q) => q.date !== undefined || (q.startTime === undefined && !q.openOnly), {
    error: '시간이나 openOnly를 쓰려면 date도 보내야 해요',
    path: ['date'],
  });

const detailQuerySchema = z
  .object({
    date: dateStr.optional(),
    tags: commaList(z.string().trim().min(1).max(20)).optional().default([]),
  })
  .strict();

export function placesRouter(deps: {
  places: PlaceRepository;
  search: PlaceSearchService;
  cart: CartService;
}): Router {
  const router = Router();

  const contextFor = async (
    userId: string | null,
    date: string | undefined,
    tags: string[],
    start?: string,
    end?: string,
  ): Promise<ViewContext> => ({
    day: date === undefined ? undefined : dayOfWeek(date)!,
    window: start && end ? { start: parseHHmm(start)!, end: parseHHmm(end)! } : undefined,
    tasteTags: tags,
    cartKeys: userId ? await deps.cart.keys(userId) : new Set(),
  });

  /** 장소 검색 (검색 결과 화면) */
  router.get('/search', async (req, res) => {
    const q = parseOr400(searchQuerySchema, req.query, res);
    if (!q) return;
    const ctx = await contextFor(optionalUserId(req), q.date, q.tags, q.startTime, q.endTime);
    const result = await deps.search.search(
      {
        region: q.region,
        center: q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined,
        keyword: q.q,
        categories: q.categories,
        indoor: q.indoor,
        priceMin: q.priceMin,
        priceMax: q.priceMax,
        openOnly: q.openOnly,
        day: ctx.day,
        window: ctx.window,
        transport: q.transport,
        sort: q.sort,
        limit: q.limit,
      },
      ctx,
    );
    res.json(result);
  });

  /** 장소 상세 (id: db:1 또는 kakao:12345) */
  router.get('/:id', async (req, res) => {
    const q = parseOr400(detailQuerySchema, req.query, res);
    if (!q) return;
    const ctx = await contextFor(optionalUserId(req), q.date, q.tags);
    res.json(await deps.search.getById(req.params.id, ctx));
  });

  /** (예전 연습용) 지역별 등록 장소 목록 */
  router.get('/', async (req, res) => {
    const q = parseOr400(
      z.object({
        region: z
          .string({ error: 'region을 넣어 주세요. 예: /api/places?region=성수' })
          .trim()
          .min(1, { error: 'region이 비어 있어요.' })
          .max(30, { error: 'region은 30글자까지만 돼요.' }),
      }),
      req.query,
      res,
    );
    if (!q) return;
    const list = await deps.places.findActiveByRegion(q.region);
    res.json({
      count: list.length,
      places: list.map((p) => ({ id: p.id, name: p.name, category: p.category })),
    });
  });

  return router;
}
