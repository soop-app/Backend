# 데이트 코스 추천 앱: 백엔드 (테스트 버전)

Node.js + TypeScript + Express + PostgreSQL 구조이고, 장소 검색은 카카오 로컬 API를 씁니다.

지금 버전은 **규칙 기반 추천**입니다. AI는 아직 붙이지 않았고, 이동 시간은 **직선거리로 계산한 추정치**예요.

## 1. 실행하기 (Windows)

```powershell
npm install
Copy-Item .env.example .env   # 그다음 .env 를 열어서 값 채우기 (비워 둬도 실행됨)
npm run dev                   # http://localhost:3000
```

- `.env`를 비워 두면 **메모리에 들어 있는 예시 장소 9곳**으로 동작해요. 모두 지어낸 가게예요.
- `KAKAO_REST_API_KEY`를 넣으면 우리 DB에 장소가 부족할 때 카카오에서 찾아서 보충해요.
  - 키는 카카오 디벨로퍼스 > 내 애플리케이션 > 앱 키 > **REST API 키**에서 확인해요.
  - 앱 관리 페이지의 [카카오맵]에서 사용 설정을 **ON**으로 바꿔야 해요.
- `.env`는 GitHub에 올리면 안 돼요. `.gitignore`에 이미 넣어 뒀어요.

### PostgreSQL 쓰기 (선택)

1. PostgreSQL을 설치하고 DB를 만들어요: `psql -U postgres -c "CREATE DATABASE date_app"`
2. `.env`에 연결 주소를 넣어요: `DATABASE_URL=postgres://postgres:비밀번호@localhost:5432/date_app`
3. `npm run db:setup`을 실행해요. 테이블이 만들어지고, DB가 비어 있으면 예시 장소가 들어가요.
4. `npm run dev`

## 2. 요청 보내 보기 (화면 흐름 순서대로)

```powershell
# 1) 검색: 성수동, 토요일 13~19시, 식당·카페
curl.exe "http://localhost:3000/api/places/search?region=%EC%84%B1%EC%88%98%EB%8F%99&date=2026-11-14&startTime=13:00&endTime=19:00&categories=restaurant,cafe" -H "X-User-Id: my-test-user-01"

# 2) 담기 (검색 결과의 id 사용)
curl.exe -X POST http://localhost:3000/api/cart/items -H "X-User-Id: my-test-user-01" -H "Content-Type: application/json" -d "{\"placeId\":\"db:1\"}"
curl.exe -X POST http://localhost:3000/api/cart/items -H "X-User-Id: my-test-user-01" -H "Content-Type: application/json" -d "{\"placeId\":\"db:3\"}"

# 3) 최적 경로 만들기
curl.exe -X POST http://localhost:3000/api/courses/optimize -H "X-User-Id: my-test-user-01" -H "Content-Type: application/json" -d "@examples/optimize.json"
```

`region=` 뒤의 이상한 글자는 "성수동"을 주소용으로 바꾼 거예요. 브라우저 주소창에서는 `region=성수동`으로 그냥 써도 돼요.

## 3. API (v0.2 — 디자인 흐름: 검색 → 담기 → 최적 경로)

로그인 전까지는 앱이 처음 켜질 때 만든 **임시 사용자 ID**를 `X-User-Id` 헤더로 보내요 (영문·숫자·`-`·`_` 8~64자).
로그인을 만들면 로그인 토큰에서 꺼낸 계정 ID로 바뀌어요.

| 메서드 | 주소 | 화면 | 하는 일 |
|---|---|---|---|
| GET | `/api/places/search` | 홈 → 검색 결과 | 장소 검색 (필터·정렬) |
| GET | `/api/places/:id` | 장소 상세 | 장소 하나 (`db:1`, `kakao:12345`) |
| GET | `/api/cart` | 내 코스 | 담은 장소 목록·합계 |
| POST | `/api/cart/items` | 검색 결과 `+ 담기` | `{ "placeId": "db:1" }` |
| DELETE | `/api/cart/items/:placeId` | 내 코스 휴지통 | 빼기 |
| PATCH | `/api/cart/items/:placeId` | 내 코스 `필수로 고정` | `{ "pinned": true }` |
| PUT | `/api/cart/order` | 내 코스 ▲▼ | `{ "placeIds": ["db:3", "db:1"] }` (담긴 전체를 원하는 순서로) |
| POST | `/api/courses/optimize` | `최적 경로 만들기` → 완성된 코스 | 방문 순서·시간·비용 계산 |
| POST | `/api/courses/recommend` | (보류) | 조건만으로 자동 추천 — 기획상 '고급 AI 코스 생성' 때 다시 사용 |

### 장소 검색 `GET /api/places/search`

| 쿼리 | 예시 | 설명 |
|---|---|---|
| region 또는 lat·lng | `성수동` | "성수동"과 "성수"는 같은 지역으로 봐요 |
| q | `파스타` | 검색어 |
| categories | `restaurant,cafe` | 필터 칩: 식당 `restaurant`, 카페 `cafe`, 전시 `exhibition`, 영화 `movie`, 체험 `activity` |
| indoor | `true` | 실내만 (실내 여부를 모르는 곳은 빠짐) |
| priceMin, priceMax | `0`, `10000` | **1인** 가격(원). 무료=`priceMax=0`, 1만원 이하=`priceMax=10000` |
| date, startTime, endTime | `2026-11-14`, `13:00`, `19:00` | 그날 영업시간 표시·영업 여부 판단 |
| openOnly | `true` | 그 시간에 영업 중인 곳만 (date 필요) |
| sort | `recommended` / `price` / `distance` | 추천순·가격순·거리순 |
| tags | `조용함,감성` | 취향 태그 → `matchPercent` 계산 (취향 조사 전 임시) |
| transport | `walk` / `car` | 검색 반경 (도보 1.5km, 차 5km) |

응답의 장소 하나: `id, source(db/kakao), name, category, categoryLabel, subCategory(예: 소품샵), description, imageUrl(null이면 기본 이미지), address, lat, lng, nearestStation{name, walkMinutes}, pricePerPerson, priceVerified, isIndoor, stayMinutes, hoursOnDate{open, close}, openStatus(open/closed/unknown), matchPercent, mapUrl, inCart`

### 최적 경로 `POST /api/courses/optimize`

```json
{
  "date": "2026-11-14",
  "startTime": "13:00",
  "endTime": "19:00",
  "start": { "name": "성수역 3번 출구", "lat": 37.5446, "lng": 127.0557 },
  "transport": "walk",
  "budgetMin": 50000,
  "budgetMax": 80000
}
```
- `endTime`, `budgetMin`, `budgetMax`는 선택. 예산은 **2인 기준**이에요.
- `start`에 좌표가 없으면 이름으로 카카오에서 찾아요.
- 순서 정하는 규칙: ① 필수 고정 장소는 반드시 포함 → ② 가능한 많은 장소 포함 → ③ 이동+대기 시간이 가장 짧게 → ④ 같으면 사용자가 정한 순서에 가깝게
- **이동 시간은 카카오 길찾기**로 구해요: 도보는 카카오맵 도보 경로 조회, 자동차는 카카오모빌리티 길찾기(+주차 5분). 추정치로 순서를 정한 뒤 그 순서의 구간만 길찾기로 확인하고 다시 계산해요 (호출 수 절약). 길찾기가 실패하면 그 구간만 직선거리 추정으로 대신하고 `travelFromPrevious.estimated: true`로 알려줘요.
- 문 열기 전에 도착하면 기다렸다가 시작해요 (`waitMinutes`). 영업 안 하거나 시간 안에 못 넣는 장소는 `dropped`에 이유와 함께 나와요.
- 응답: `start`, `stops[]`(순서, 도착·시작·출발 시각, 머무는 시간, 1인 비용, 이전 위치에서의 이동, 지도·길찾기 링크), `dropped[]`, `summary`(총 소요·이동·대기 시간, 1인/2인 비용, 남은 예산), `warnings[]`

### 에러

| 에러 코드 | 상태 | 언제 |
|---|---|---|
| INVALID_REQUEST | 400 | 값이 틀림. `details`에 칸별 한글 메시지 |
| INVALID_JSON | 400 | JSON 형식이 깨짐 |
| USER_ID_REQUIRED | 400 | `X-User-Id` 헤더가 없거나 형식이 틀림 |
| REGION_NOT_FOUND / PLACE_NOT_FOUND | 404 | 지역·장소를 못 찾음 (카카오 장소는 30분 안에 검색한 것만 상세·담기 가능) |
| CART_FULL / CART_EMPTY / CART_CHANGED | 409 | 장바구니 5개 초과 / 비어 있음 / 순서 목록이 담긴 것과 다름 |
| COURSE_NOT_POSSIBLE | 409 | 필수 장소를 시간 안에 넣을 수 없음 |
| TOO_MANY_REQUESTS | 429 | IP 하나가 1분에 60번 넘게 요청 |

## 4. 아직 정하지 않은 것 (팀 협의)

- **예산 기준**: 홈은 2인 총예산인데 디자인의 '예상 총비용'은 1인 가격 합계 → API는 1인·2인을 둘 다 줘요
- **사진**: 카카오는 사진을 안 줘요. 우리 DB `image_url`(직접 찍었거나 허락받은 사진) + 없으면 카테고리별 기본 이미지
- **취향 일치율**: 지금은 임시 계산식(취향 태그 중 장소가 가진 비율). 취향 조사 생기면 다시 정하기
- **소품샵**: 필터 칩에 없어서 지금은 '체험' 안의 세부 분류(`subCategory`)

## 5. 지켜야 할 카카오 규칙

- 응답에 **영업시간이나 가격 정보가 없어요.** 그래서 예산과 시간으로 거르려면 우리 DB(`places`, `place_hours`)에 직접 넣어야 해요.
- **대량으로 수집해서 저장하면 안 돼요.** 차단될 수 있어요. 카카오 결과는 요청이 올 때만 쓰고 저장하지 않아요.
- **도보 경로 API**(2026-07-21 신규)는 응답 형식을 문서로 최종 확인하지 못했어요. `npm run test:kakao`(또는 `test-kakao.bat`) 결과의 [3]번에서 "(실제 길찾기)"가 나오는지 확인하세요.
- **상업적으로 쓸 경우**, 예를 들어 광고 수익을 붙이면 카카오모빌리티 길찾기는 무료 쿼터 안에서도 미리 제휴가 필요해요.

## 6. 테스트

```powershell
npm test          # 98개 중 실제 DB 테스트 7개는 아래 변수가 없으면 건너뜀
npm run typecheck
```

실제 PostgreSQL 테스트까지 돌리려면, `db:setup`을 해 둔 DB 주소를 `TEST_DATABASE_URL`에 넣고 실행해요.

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:비밀번호@localhost:5432/date_app"; npm test
```

## 7. 폴더 구조

```
db/schema.sql                 장소 테이블 구조
scripts/dbSetup.ts            테이블 생성 + 예시 데이터
src/server.ts                 실행 진입점
src/app.ts                    Express 앱 (요청 제한, 에러 처리)
src/routes/                   주소별 요청 검증 (places, cart, courses, common)
src/places/placeSearch.ts     장소 검색·상세 (우리 DB + 카카오)
src/places/placeView.ts       화면에 내려주는 장소 모양
src/cart/                     장바구니 (메모리 / PostgreSQL)
src/course/optimizeRoute.ts   방문 순서 최적화
src/course/courseService.ts   완성된 코스 응답 만들기
src/recommend/recommendCourse.ts  (보류) 자동 추천
src/kakao/kakaoLocalClient.ts 카카오 장소 검색
src/places/                   장소 저장소 (메모리 / PostgreSQL), 예시 데이터
src/time.ts, src/geo.ts       시간·거리 계산
```

## 8. 다음 단계

- [x] 장소 검색·상세, 장바구니, 경로 최적화 (v0.2)
- [ ] 코스 저장·조회·삭제
- [ ] 카카오 로그인 → 애플 로그인 (iOS 심사 4.8) → 취향 조사 5문항·마이페이지
- [ ] 실제 장소 데이터 넣기 (직접 확인한 가격·영업시간·사진)
- [x] 이동 시간을 카카오 길찾기(도보·자동차)로 (실패 시 추정)
- [ ] 자정을 넘기는 일정 지원하기
- [ ] (2차) 연인 연결, 만족도 피드백, 공동 코스
