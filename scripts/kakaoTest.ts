/**
 * 실제 카카오 API 연결 테스트
 * 실행: npm run test:kakao   (.env 의 KAKAO_REST_API_KEY 사용)
 * 결과는 화면과 kakao-test-result.txt 에 저장됩니다. (API 키는 저장하지 않습니다)
 */
import { writeFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { KakaoLocalClient } from '../src/kakao/kakaoLocalClient.js';
import { InMemoryPlaceRepository } from '../src/places/inMemoryPlaceRepository.js';
import { SEED_PLACES } from '../src/places/seedData.js';
import { recommendCourse } from '../src/recommend/recommendCourse.js';
import { KakaoTravelTimes } from '../src/routing/travelTimes.js';

const lines: string[] = [];
const log = (s = '') => {
  console.log(s);
  lines.push(s);
};
let ok = false;

try {
  if (!config.KAKAO_REST_API_KEY) throw new Error('.env 에 KAKAO_REST_API_KEY 가 없습니다.');
  const kakao = new KakaoLocalClient(config.KAKAO_REST_API_KEY, fetch, 5000);

  log('[1] 카카오 카테고리 검색 (잠실역 근처 카페)');
  const cafes = await kakao.searchCategory('cafe', {
    center: { lat: 37.5133, lng: 127.1001 },
    radiusMeters: 1000,
    size: 3,
  });
  for (const c of cafes) log(`  - ${c.name} | ${c.address} | ${c.lat}, ${c.lng}`);
  if (cafes.length === 0) throw new Error('검색 결과가 0개입니다.');

  log('');
  log('[2] 코스 추천 (우리 DB에 없는 지역: 잠실, 토요일 13:00~19:00, 도보, 12만 원)');
  const result = await recommendCourse(
    {
      region: '잠실',
      date: '2026-11-14',
      day: 6,
      startMinutes: 13 * 60,
      endMinutes: 19 * 60,
      budget: 120000,
      transport: 'walk',
      preferredTags: [],
    },
    { places: new InMemoryPlaceRepository(SEED_PLACES), kakao },
  );
  for (const s of result.stops) {
    log(`  ${s.order}. ${s.arriveAt}-${s.leaveAt} ${s.name} [${s.category}, ${s.source}] 이동 ${s.travelFromPrevious?.minutes ?? 0}분`);
  }
  for (const w of result.warnings) log(`  안내: ${w}`);

  const kakaoStops = result.stops.filter((s) => s.source === 'kakao').length;
  ok = kakaoStops > 0 && !result.warnings.some((w) => w.includes('실패'));

  log('');
  log('[3] 길찾기: 잠실역 → 롯데월드몰 (도보·자동차)');
  const fallbacks: string[] = [];
  const travel = new KakaoTravelTimes(config.KAKAO_REST_API_KEY, fetch, 5000, Date.now, (r) => fallbacks.push(r));
  const from = { lat: 37.5133, lng: 127.1001 };
  const to = { lat: 37.5126, lng: 127.1025 };
  for (const mode of ['walk', 'car'] as const) {
    const leg = await travel.leg(from, to, mode);
    log(`  ${mode === 'walk' ? '도보' : '자동차'}: ${leg.minutes}분, ${leg.distanceMeters}m ${leg.estimated ? '(실패 → 직선거리 추정)' : '(실제 길찾기)'}`);
  }
  for (const f of fallbacks) log(`  길찾기 실패 이유: ${f}`);
  if (fallbacks.length > 0) {
    log('  ※ 장소 검색은 되지만 길찾기는 실패했어요. 위 실패 이유를 Claude에게 보내 주세요.');
  }
  log('');
  log(ok ? `결과: 성공 (카카오 장소 ${kakaoStops}곳으로 코스 생성)` : '결과: 실패 (카카오 장소가 코스에 들어가지 않았습니다)');
} catch (err) {
  log('');
  log(`결과: 실패 - ${(err as Error).message}`);
}

await writeFile(new URL('../kakao-test-result.txt', import.meta.url), lines.join('\n') + '\n', 'utf8');
process.exitCode = ok ? 0 : 1;
