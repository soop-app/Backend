/**
 * DB 준비: 테이블 만들기 + (비어 있으면) 예시 장소 넣기
 * 실행: npm run db:setup   (.env 의 DATABASE_URL 사용)
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { config } from '../src/config.js';
import { SEED_PLACES } from '../src/places/seedData.js';

if (!config.DATABASE_URL) {
  console.error('.env 에 DATABASE_URL 을 먼저 넣어 주세요.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: config.DATABASE_URL });
await client.connect();
try {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await client.query(schema);
  console.log('테이블 준비 완료');

  const { rows } = await client.query<{ n: string }>('SELECT count(*) AS n FROM places');
  if (Number(rows[0]!.n) > 0) {
    console.log('이미 장소가 있어서 예시 데이터는 넣지 않았어요.');
  } else {
    await client.query('BEGIN');
    for (const p of SEED_PLACES) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO places (kakao_place_id, name, category, region, address, lat, lng,
                             price_min, price_max, stay_minutes, tags,
                             sub_category, description, image_url, is_indoor, station_name, station_walk_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [p.kakaoPlaceId, p.name, p.category, p.region, p.address, p.lat, p.lng,
         p.priceMin, p.priceMax, p.stayMinutes, p.tags,
         p.subCategory, p.description, p.imageUrl, p.isIndoor,
         p.nearestStation?.name ?? null, p.nearestStation?.walkMinutes ?? null],
      );
      for (const h of p.hours) {
        await client.query(
          'INSERT INTO place_hours (place_id, day_of_week, open_time, close_time) VALUES ($1,$2,$3,$4)',
          [ins.rows[0]!.id, h.day, h.open, h.close],
        );
      }
    }
    await client.query('COMMIT');
    console.log(`예시 장소 ${SEED_PLACES.length}곳을 넣었어요.`);
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('DB 준비 실패:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
