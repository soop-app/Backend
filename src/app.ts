import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { InMemoryCartRepository, type CartRepository } from './cart/cartRepository.js';
import { CartService } from './cart/cartService.js';
import { CourseService } from './course/courseService.js';
import { ConflictError, PlaceNotFoundError, RegionNotFoundError } from './errors.js';
import type { PlaceRepository } from './places/placeRepository.js';
import { PlaceSearchService, type KakaoPlaces } from './places/placeSearch.js';
import { cartRouter } from './routes/cart.js';
import { coursesRouter } from './routes/courses.js';
import { placesRouter } from './routes/places.js';
import type { TravelTimes } from './routing/travelTimes.js';

export interface AppOptions {
  places: PlaceRepository;
  /** 카카오 키가 없으면 null (우리 DB 장소만 사용) */
  kakao: KakaoPlaces | null;
  /** 없으면 메모리 장바구니 (서버를 끄면 사라짐) */
  carts?: CartRepository;
  /** 이동 시간 계산기 (없으면 직선거리 추정) */
  travel?: TravelTimes;
  /** 1분에 IP 하나당 허용할 API 요청 수 (카카오 쿼터 보호) */
  rateLimitPerMinute?: number;
}

export function createApp(opts: AppOptions) {
  const search = new PlaceSearchService(opts.places, opts.kakao);
  const cart = new CartService(opts.carts ?? new InMemoryCartRepository(), opts.places, search);
  const course = new CourseService(cart, opts.places, opts.kakao, opts.travel);

  const app = express();
  app.disable('x-powered-by'); // 서버 종류를 굳이 알리지 않음
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, kakao: opts.kakao !== null });
  });

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: opts.rateLimitPerMinute ?? 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'TOO_MANY_REQUESTS', message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' } },
    }),
  );
  app.use('/api/places', placesRouter({ places: opts.places, search, cart }));
  app.use('/api/cart', cartRouter(cart));
  app.use('/api/courses', coursesRouter({ places: opts.places, kakao: opts.kakao, course }));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } });
  });

  // 에러 처리: 사용자에게는 내부 정보(스택 등)를 보여주지 않음
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof RegionNotFoundError) {
      res.status(404).json({ error: { code: 'REGION_NOT_FOUND', message: err.message } });
      return;
    }
    if (err instanceof PlaceNotFoundError) {
      res.status(404).json({ error: { code: 'PLACE_NOT_FOUND', message: err.message } });
      return;
    }
    if (err instanceof ConflictError) {
      res.status(409).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON 형식이 올바르지 않아요.' } });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: '요청이 너무 커요.' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '서버에 문제가 생겼어요.' } });
  };
  app.use(onError);

  return app;
}
