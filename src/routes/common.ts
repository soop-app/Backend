import type { Request, Response } from 'express';
import { z } from 'zod';
import { dayOfWeek, parseHHmm } from '../time.js';

export const hhmm = z
  .string({ error: 'HH:mm 형식의 시간을 넣어 주세요 (예: "13:00")' })
  .refine((v) => parseHHmm(v) !== null, { error: 'HH:mm 형식이어야 해요 (예: 13:00)' });

export const dateStr = z
  .string({ error: 'date를 넣어 주세요 (예: "2026-11-14")' })
  .refine((v) => dayOfWeek(v) !== null, { error: 'YYYY-MM-DD 형식의 실제 날짜여야 해요' });

/** zod 가 영어로 만든 메시지가 남아 있으면 한글로 바꿉니다. */
export function toKorean(issue: z.core.$ZodIssue): { field: string; message: string } {
  const field = issue.path.join('.');
  if (issue.code === 'unrecognized_keys') {
    return { field, message: `모르는 항목이 들어 있어요: ${issue.keys.join(', ')}` };
  }
  if (!/[가-힣]/.test(issue.message)) return { field, message: '값의 형식이 올바르지 않아요' };
  return { field, message: issue.message };
}

/** 검증 실패 → 400 응답. 성공하면 값을 돌려줌 */
export function parseOr400<T>(schema: z.ZodType<T>, value: unknown, res: Response): T | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    error: {
      code: 'INVALID_REQUEST',
      message: '요청 값이 올바르지 않아요.',
      details: parsed.error.issues.map(toKorean),
    },
  });
  return null;
}

/**
 * 임시 사용자 ID (로그인 전까지): 앱이 처음 켜질 때 만든 무작위 값을 X-User-Id 헤더로 보냄
 * 로그인을 만들면 로그인 토큰에서 꺼낸 계정 ID 로 바뀝니다.
 */
const USER_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function optionalUserId(req: Request): string | null {
  const v = req.get('x-user-id');
  return v && USER_ID.test(v) ? v : null;
}

export function requireUserId(req: Request, res: Response): string | null {
  const id = optionalUserId(req);
  if (id) return id;
  res.status(400).json({
    error: {
      code: 'USER_ID_REQUIRED',
      message: 'X-User-Id 헤더가 필요해요 (영문·숫자·-·_ 8~64자).',
    },
  });
  return null;
}

/** "cafe,restaurant" 처럼 쉼표로 이어진 값을 배열로 */
export const commaList = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
    z.array(item),
  );

/** 쿼리의 "true"/"false" → boolean */
export const queryBool = z.enum(['true', 'false'], { error: 'true 또는 false 여야 해요' }).transform((v) => v === 'true');
