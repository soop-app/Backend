import { Router } from 'express';
import { z } from 'zod';
import type { CartService } from '../cart/cartService.js';
import { parseOr400, requireUserId } from './common.js';

const placeId = z
  .string({ error: 'placeId를 넣어 주세요 (예: "db:1")' })
  .regex(/^(db|kakao):[A-Za-z0-9]{1,30}$/, { error: 'placeId 형식이 올바르지 않아요 (예: "db:1", "kakao:12345")' });

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

  return router;
}
