import pg from 'pg';
import { createApp } from './app.js';
import { InMemoryCartRepository, type CartRepository } from './cart/cartRepository.js';
import { PostgresCartRepository } from './cart/postgresCartRepository.js';
import { config } from './config.js';
import { KakaoLocalClient } from './kakao/kakaoLocalClient.js';
import { InMemoryPlaceRepository } from './places/inMemoryPlaceRepository.js';
import type { PlaceRepository } from './places/placeRepository.js';
import { PostgresPlaceRepository } from './places/postgresPlaceRepository.js';
import { SEED_PLACES } from './places/seedData.js';
import { KakaoTravelTimes } from './routing/travelTimes.js';

let places: PlaceRepository;
let carts: CartRepository;
if (config.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  places = new PostgresPlaceRepository(pool);
  carts = new PostgresCartRepository(pool);
  console.log('저장소: PostgreSQL');
} else {
  places = new InMemoryPlaceRepository(SEED_PLACES);
  carts = new InMemoryCartRepository();
  console.log('저장소: 메모리 (예시 장소, 장바구니는 서버를 끄면 사라짐). DATABASE_URL 을 넣으면 PostgreSQL 사용');
}

const kakao = config.KAKAO_REST_API_KEY ? new KakaoLocalClient(config.KAKAO_REST_API_KEY) : null;
console.log(kakao ? '카카오 장소 검색: 켜짐' : '카카오 장소 검색: 꺼짐 (KAKAO_REST_API_KEY 없음)');

const travel = config.KAKAO_REST_API_KEY ? new KakaoTravelTimes(config.KAKAO_REST_API_KEY) : undefined;
console.log(travel ? '이동 시간: 카카오 길찾기 (실패하면 직선거리 추정)' : '이동 시간: 직선거리 추정');

createApp({ places, kakao, carts, travel }).listen(config.PORT, () => {
  console.log(`서버 실행 중: http://localhost:${config.PORT}`);
});
