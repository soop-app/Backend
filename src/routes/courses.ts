import { Router } from 'express';
import { z } from 'zod';
import type { CourseService } from '../course/courseService.js';
import { recommendCourse, type RecommendDeps } from '../recommend/recommendCourse.js';
import { dayOfWeek, parseHHmm } from '../time.js';
import { dateStr, hhmm, parseOr400, requireUserId, toKorean } from './common.js';

const budgetWon = (name: string) =>
  z
    .number({ error: `${name}은(는) 숫자로 보내 주세요 (예: 80000)` })
    .int({ error: `${name}은(는) 소수점 없는 숫자여야 해요` })
    .min(0, { error: `${name}은(는) 0원 이상이어야 해요` })
    .max(10_000_000, { error: `${name}은(는) 1,000만 원까지만 돼요` });

/** POST /api/courses/optimize 본문 규칙 (내 코스 → 최적 경로 만들기) */
export const optimizeRequestSchema = z
  .object({
    date: dateStr,
    startTime: hhmm,
    endTime: hhmm.optional(),
    start: z
      .object(
        {
          name: z.string({ error: '출발 위치 이름을 넣어 주세요 (예: "성수역 3번 출구")' }).trim().min(1).max(50),
          lat: z.number({ error: 'lat(위도)은 숫자여야 해요' }).min(-90).max(90).optional(),
          lng: z.number({ error: 'lng(경도)은 숫자여야 해요' }).min(-180).max(180).optional(),
        },
        { error: 'start는 {"name": "성수역 3번 출구", "lat": 숫자, "lng": 숫자} 모양이어야 해요' },
      )
      .strict()
      .refine((s) => (s.lat === undefined) === (s.lng === undefined), {
        error: 'lat과 lng는 함께 보내야 해요',
      }),
    transport: z.enum(['walk', 'car'], { error: 'transport는 "walk" 또는 "car"여야 해요' }),
    budgetMin: budgetWon('budgetMin(2인 최소 예산)').optional(),
    budgetMax: budgetWon('budgetMax(2인 최대 예산)').optional(),
  })
  .strict()
  .refine((b) => !b.endTime || parseHHmm(b.endTime)! > parseHHmm(b.startTime)!, {
    error: '종료 시간은 시작 시간보다 뒤여야 해요 (자정을 넘기는 일정은 아직 지원하지 않아요)',
    path: ['endTime'],
  })
  .refine((b) => b.budgetMin === undefined || b.budgetMax === undefined || b.budgetMin <= b.budgetMax, {
    error: 'budgetMin은 budgetMax보다 클 수 없어요',
    path: ['budgetMin'],
  });

/** 요청 본문 규칙. 프런트에서 보내는 JSON 모양이 여기서 정해집니다. */
export const courseRequestSchema = z
  .object({
    region: z
      .string({ error: 'region은 글자로 보내 주세요 (예: "성수")' })
      .trim()
      .min(1, { error: 'region이 비어 있어요' })
      .max(30, { error: 'region은 30글자까지만 돼요' })
      .optional(),
    center: z
      .object(
        {
          lat: z
            .number({ error: 'lat(위도)은 숫자여야 해요' })
            .min(-90, { error: 'lat(위도)은 -90 ~ 90 사이여야 해요' })
            .max(90, { error: 'lat(위도)은 -90 ~ 90 사이여야 해요' }),
          lng: z
            .number({ error: 'lng(경도)은 숫자여야 해요' })
            .min(-180, { error: 'lng(경도)은 -180 ~ 180 사이여야 해요' })
            .max(180, { error: 'lng(경도)은 -180 ~ 180 사이여야 해요' }),
        },
        { error: 'center는 {"lat": 숫자, "lng": 숫자} 모양이어야 해요' },
      )
      .optional(),
    date: dateStr,
    startTime: hhmm,
    endTime: hhmm,
    budget: z
      .number({ error: 'budget(예산)은 숫자로 보내 주세요 (예: 120000)' })
      .int({ error: 'budget(예산)은 소수점 없는 숫자여야 해요' })
      .min(0, { error: 'budget(예산)은 0원 이상이어야 해요' })
      .max(10_000_000, { error: 'budget(예산)은 1,000만 원까지만 돼요' }), // 두 사람 합산, 원
    transport: z.enum(['walk', 'car'], { error: 'transport는 "walk" 또는 "car"여야 해요' }),
    mustVisit: z
      .string({ error: 'mustVisit은 글자로 보내 주세요' })
      .trim()
      .min(1, { error: 'mustVisit이 비어 있어요' })
      .max(50, { error: 'mustVisit은 50글자까지만 돼요' })
      .optional(),
    preferredTags: z
      .array(
        z
          .string({ error: '취향 태그는 글자여야 해요' })
          .trim()
          .min(1, { error: '빈 취향 태그가 있어요' })
          .max(20, { error: '취향 태그는 20글자까지만 돼요' }),
        { error: 'preferredTags는 글자 목록이어야 해요 (예: ["조용함"])' },
      )
      .max(10, { error: '취향 태그는 10개까지만 돼요' })
      .default([]),
  })
  .strict() // 모르는 필드가 오면 거절 (메시지는 아래 toKorean 에서 한글로 바꿈)
  .refine((b) => b.region !== undefined || b.center !== undefined, {
    message: 'region 또는 center 중 하나는 꼭 보내야 해요',
    path: ['region'],
  })
  .refine((b) => parseHHmm(b.endTime)! - parseHHmm(b.startTime)! >= 60, {
    message: '종료 시간은 시작 시간보다 1시간 이상 뒤여야 해요 (자정을 넘기는 일정은 아직 지원하지 않아요)',
    path: ['endTime'],
  });

export function coursesRouter(deps: RecommendDeps & { course: CourseService }): Router {
  const router = Router();

  /** 내 코스(장바구니) → 최적 경로 만들기. X-User-Id 헤더 필요 */
  router.post('/optimize', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const b = parseOr400(optimizeRequestSchema, req.body, res);
    if (!b) return;
    res.json(
      await deps.course.optimize({
        userId,
        date: b.date,
        day: dayOfWeek(b.date)!,
        startMinutes: parseHHmm(b.startTime)!,
        endMinutes: b.endTime === undefined ? undefined : parseHHmm(b.endTime)!,
        start: b.start,
        transport: b.transport,
        budgetMin: b.budgetMin,
        budgetMax: b.budgetMax,
      }),
    );
  });

  /** (보류) 조건만으로 코스를 자동 추천 — 기획상 '고급 AI 코스 생성' 단계에서 다시 사용 */
  router.post('/recommend', async (req, res) => {
    const parsed = courseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: '요청 값이 올바르지 않아요.',
          details: parsed.error.issues.map(toKorean),
        },
      });
      return;
    }
    const b = parsed.data;
    const result = await recommendCourse(
      {
        region: b.region,
        center: b.center,
        date: b.date,
        day: dayOfWeek(b.date)!,
        startMinutes: parseHHmm(b.startTime)!,
        endMinutes: parseHHmm(b.endTime)!,
        budget: b.budget,
        transport: b.transport,
        mustVisit: b.mustVisit,
        preferredTags: b.preferredTags,
      },
      deps,
    );
    res.json(result);
  });

  return router;
}
