import { Router } from 'express';
import { z } from 'zod';
import type { CartService } from '../cart/cartService.js';
import { parseOr400, requireUserId } from './common.js';

const placeId = z
  .string({ error: 'placeId를 넣어 주세요 (예: "db:1")' })
  .regex(/^(db|kakao):[A-Za-z0-9]{1,30}$/, { error: 'placeId 형식이 올바르지 않아요 (예: "db:1", "kakao:12345")' });

const won = (name: string) =>
  z
    .number({ error: `${name}은(는) 숫자로 보내 주세요 (예: 80000)` })
    .int({ error: `${name}은(는) 소수점 없는 숫자여야 해요` })
    .min(0, { error: `${name}은(는) 0원 이상이어야 해요` })
    .max(10_000_000, { error: `${name}은(는) 1,000만 원까지만 돼요` })
    .nullable();

const settingsSchema = z
  .object({
    start: z
      .object(
        {
          name: z
            .string({ error: '출발 위치 이름을 넣어 주세요 (예: "성수역 3번 출구")' })
            .trim()
            .min(1, { error: '출발 위치 이름이 비어 있어요' })
            .max(50, { error: '출발 위치 이름은 50글자까지만 돼요' }),
          lat: z.number({ error: 'lat(위도)은 숫자여야 해요' }).min(-90).max(90),
          lng: z.number({ error: 'lng(경도)은 숫자여야 해요' }).min(-180).max(180),
        },
        { error: 'start는 {"name": "성수역 3번 출구", "lat": 숫자, "lng": 숫자} 또는 null이어야 해요' },
      )
      .strict()
      .nullable(),
    transport: z.enum(['walk', 'car'], { error: 'transport는 "walk" 또는 "car"여야 해요' }),
    budgetMin: won('budgetMin(2인 최소 예산)'),
    budgetMax: won('budgetMax(2인 최대 예산)'),
  })
  .strict()
  .refine((b) => b.budgetMin === null || b.budgetMax === null || b.budgetMin <= b.budgetMax, {
    error: 'budgetMin은 budgetMax보다 클 수 없어요',
    path: ['budgetMin'],
  });

/** 장바구니 ("내 코스"에 담은 장소). 모든 요청에 X-User-Id 헤더 필요 */
export function cartRouter(cart: CartService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    res.json(await cart.get(userId));
  });

  /** 담기 */
  router.post('/items', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const body = parseOr400(z.object({ placeId }).strict(), req.body, res);
    if (!body) return;
    res.status(201).json(await cart.add(userId, body.placeId));
  });

  /** 빼기 */
  router.delete('/items/:placeId', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const id = parseOr400(placeId, req.params.placeId, res);
    if (!id) return;
    res.json(await cart.remove(userId, id));
  });

  /** 필수 장소로 고정 / 해제 */
  router.patch('/items/:placeId', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const id = parseOr400(placeId, req.params.placeId, res);
    if (!id) return;
    const body = parseOr400(
      z.object({ pinned: z.boolean({ error: 'pinned는 true 또는 false여야 해요' }) }).strict(),
      req.body,
      res,
    );
    if (!body) return;
    res.json(await cart.setPinned(userId, id, body.pinned));
  });

  /** 순서 바꾸기 (화면의 ▲▼ 버튼) — 담긴 장소 전체를 원하는 순서대로 보냄 */
  router.put('/order', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const body = parseOr400(
      z.object({ placeIds: z.array(placeId, { error: 'placeIds는 목록이어야 해요' }).max(5) }).strict(),
      req.body,
      res,
    );
    if (!body) return;
    res.json(await cart.reorder(userId, body.placeIds));
  });

  /** 코스 설정 저장 (출발 위치 · 이동 수단 · 예산). 매번 네 값을 모두 보냄 */
  router.put('/settings', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const body = parseOr400(settingsSchema, req.body, res);
    if (!body) return;
    res.json(
      await cart.saveSettings(userId, {
        start: body.start,
        transport: body.transport,
        budgetMin: body.budgetMin,
        budgetMax: body.budgetMax,
      }),
    );
  });

  /** 경로 최적화(4주차)에 넘길 값 묶음 */
  router.get('/route-input', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    res.json(await cart.routeInput(userId));
  });

  return router;
}
