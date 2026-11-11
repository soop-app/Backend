-- 데이트 코스 앱: 데이터 구조
-- 우리 DB에는 "직접 고르고 확인한" 장소만 넣습니다.
-- (카카오 로컬 API 결과는 대량 수집·저장하지 않고 요청 시점에만 사용)
-- 이 파일은 여러 번 실행해도 안전합니다. (이미 있는 DB는 아래 ALTER 로 새 칸이 추가됨)

CREATE TABLE IF NOT EXISTS places (
  id              BIGSERIAL PRIMARY KEY,
  kakao_place_id  TEXT UNIQUE,                       -- 카카오 장소와 연결 (없어도 됨)
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  region          TEXT NOT NULL,                     -- 예: '성수' ('동'은 빼고 저장)
  address         TEXT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng             DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  price_min       INTEGER NOT NULL CHECK (price_min >= 0),          -- 1인당, 원
  price_max       INTEGER NOT NULL CHECK (price_max >= price_min),  -- 1인당, 원
  stay_minutes    INTEGER NOT NULL CHECK (stay_minutes BETWEEN 10 AND 600),
  tags            TEXT[] NOT NULL DEFAULT '{}',      -- 예: {'조용함','야외'}
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,     -- 폐업 시 FALSE
  verified_at     DATE,                              -- 마지막으로 정보 확인한 날
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v0.2: 디자인(검색 결과·상세 화면)에 필요한 칸
ALTER TABLE places ADD COLUMN IF NOT EXISTS sub_category TEXT;          -- 화면 표시용 세부 분류 (예: 소품샵)
ALTER TABLE places ADD COLUMN IF NOT EXISTS description TEXT;           -- 한 줄 소개
ALTER TABLE places ADD COLUMN IF NOT EXISTS image_url TEXT;             -- 직접 찍었거나 허락받은 사진만
ALTER TABLE places ADD COLUMN IF NOT EXISTS is_indoor BOOLEAN;          -- 실내 여부 (모르면 NULL)
ALTER TABLE places ADD COLUMN IF NOT EXISTS station_name TEXT;          -- 가장 가까운 역 (예: 성수역)
ALTER TABLE places ADD COLUMN IF NOT EXISTS station_walk_minutes INTEGER CHECK (station_walk_minutes >= 0);

-- v0.2: 카테고리를 디자인 필터 칩에 맞춤 (culture → exhibition)
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_category_check;
UPDATE places SET category = 'exhibition' WHERE category = 'culture';
ALTER TABLE places ADD CONSTRAINT places_category_check
  CHECK (category IN ('restaurant', 'cafe', 'exhibition', 'movie', 'activity'));

CREATE INDEX IF NOT EXISTS idx_places_region_active ON places (region) WHERE is_active;

-- 영업시간: 요일마다 한 줄. day_of_week 0=일요일 ... 6=토요일
-- close_time <= open_time 이면 "다음 날 새벽까지 영업"으로 해석합니다. (예: 18:00 ~ 02:00)
-- 그날 쉬면 줄을 넣지 않습니다.
CREATE TABLE IF NOT EXISTS place_hours (
  place_id     BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time    TIME NOT NULL,
  close_time   TIME NOT NULL,
  PRIMARY KEY (place_id, day_of_week)
);

-- v0.2: 장바구니 ("내 코스"에 담은 장소, 최대 5개)
-- user_id 는 로그인 전까지 앱이 만든 임시 ID, 로그인 후에는 실제 계정 ID 를 넣습니다.
-- 카카오 장소는 사용자가 직접 담은 것만, 화면에 필요한 최소 정보(place_snapshot)만 저장합니다.
CREATE TABLE IF NOT EXISTS cart_items (
  user_id         TEXT NOT NULL,
  place_key       TEXT NOT NULL,                     -- 'db:1' 또는 'kakao:12345'
  place_snapshot  JSONB NOT NULL,
  position        SMALLINT NOT NULL,                 -- 사용자가 정한 순서 (0부터)
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,    -- 필수 장소로 고정
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, place_key)
);

-- v0.3: 내 코스 화면의 "코스 설정" (사용자마다 1줄)
-- 출발 위치는 이름·좌표를 함께 저장해야 경로 계산에 바로 쓸 수 있습니다.
CREATE TABLE IF NOT EXISTS cart_settings (
  user_id     TEXT PRIMARY KEY,
  start_name  TEXT,
  start_lat   DOUBLE PRECISION CHECK (start_lat BETWEEN -90 AND 90),
  start_lng   DOUBLE PRECISION CHECK (start_lng BETWEEN -180 AND 180),
  transport   TEXT NOT NULL DEFAULT 'walk' CHECK (transport IN ('walk', 'car')),
  budget_min  INTEGER CHECK (budget_min >= 0),
  budget_max  INTEGER CHECK (budget_max >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 출발 위치는 이름·위도·경도가 모두 있거나 모두 없어야 함
  CHECK ((start_name IS NULL) = (start_lat IS NULL) AND (start_lat IS NULL) = (start_lng IS NULL)),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);
