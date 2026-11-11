import type { OpeningHours } from './types.js';

const DAY = 24 * 60;

/** "HH:mm" → 자정부터 몇 분인지. "24:00" 은 1440. 형식이 틀리면 null */
export function parseHHmm(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24 && min === 0) return DAY;
  if (h > 23) return null;
  return h * 60 + min;
}

/** 분 → "HH:mm" */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → 요일(0=일 ... 6=토). 없는 날짜(예: 2월 30일)면 null */
export function dayOfWeek(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // 2월 30일처럼 넘친 날짜는 다른 달로 바뀌므로 다시 비교해서 걸러냄
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt.getUTCDay();
}

/**
 * 그 요일의 [from, to] 동안 계속 영업 중인지 확인합니다. (from, to 는 자정부터의 분)
 * - close <= open 이면 다음 날 새벽까지 영업으로 봅니다. (00:00~00:00 은 24시간)
 * - 전날 밤부터 이어지는 영업(예: 금 18:00~02:00 → 토 00:00~02:00)도 고려합니다.
 */
export function isOpenDuring(hours: OpeningHours[], day: number, from: number, to: number): boolean {
  const intervals: Array<[number, number]> = [];

  for (const h of hours) {
    const open = parseHHmm(h.open);
    const close = parseHHmm(h.close);
    if (open === null || close === null) continue;
    const overnight = close <= open;

    if (h.day === day) {
      intervals.push([open, overnight ? close + DAY : close]);
    }
    if (overnight && h.day === (day + 6) % 7) {
      intervals.push([0, close]); // 전날 영업이 오늘 새벽까지 이어짐
    }
  }

  return intervals.some(([start, end]) => start <= from && to <= end);
}
