import { describe, expect, it } from 'vitest';
import { dayOfWeek, formatMinutes, isOpenDuring, parseHHmm } from '../src/time.js';

describe('parseHHmm / formatMinutes', () => {
  it('정상 시간', () => {
    expect(parseHHmm('00:00')).toBe(0);
    expect(parseHHmm('13:05')).toBe(785);
    expect(parseHHmm('24:00')).toBe(1440);
    expect(formatMinutes(785)).toBe('13:05');
  });
  it('잘못된 시간은 null', () => {
    for (const v of ['24:01', '25:00', '12:60', '9:00', '12-00', '']) expect(parseHHmm(v)).toBeNull();
  });
});

describe('dayOfWeek', () => {
  it('요일 계산 (0=일)', () => {
    expect(dayOfWeek('2026-11-09')).toBe(1); // 월
    expect(dayOfWeek('2026-11-14')).toBe(6); // 토
  });
  it('없는 날짜는 null', () => {
    expect(dayOfWeek('2026-02-30')).toBeNull();
    expect(dayOfWeek('2026-13-01')).toBeNull();
    expect(dayOfWeek('20261109')).toBeNull();
  });
});

describe('isOpenDuring', () => {
  const normal = [{ day: 6, open: '11:00', close: '21:00' }];
  it('영업시간 안이면 true, 걸치면 false', () => {
    expect(isOpenDuring(normal, 6, 11 * 60, 12 * 60)).toBe(true);
    expect(isOpenDuring(normal, 6, 20 * 60, 21 * 60)).toBe(true);
    expect(isOpenDuring(normal, 6, 20 * 60, 21 * 60 + 1)).toBe(false);
    expect(isOpenDuring(normal, 6, 10 * 60, 12 * 60)).toBe(false);
  });
  it('쉬는 날이면 false', () => {
    expect(isOpenDuring(normal, 0, 12 * 60, 13 * 60)).toBe(false);
  });
  it('새벽까지 영업 (18:00~02:00)', () => {
    const late = [{ day: 5, open: '18:00', close: '02:00' }]; // 금요일
    expect(isOpenDuring(late, 5, 22 * 60, 24 * 60)).toBe(true);
    expect(isOpenDuring(late, 6, 0, 90)).toBe(true); // 토요일 새벽 = 금요일 영업
    expect(isOpenDuring(late, 6, 60, 180)).toBe(false); // 02시 넘김
  });
  it('00:00~00:00 은 24시간', () => {
    const allDay = [{ day: 3, open: '00:00', close: '00:00' }];
    expect(isOpenDuring(allDay, 3, 0, 1440)).toBe(true);
  });
  it('12:00~24:00', () => {
    expect(isOpenDuring([{ day: 1, open: '12:00', close: '24:00' }], 1, 22 * 60, 1440)).toBe(true);
  });
});
