/**
 * 지역 이름 정리: 앞뒤 공백 제거, 끝의 '동' 제거
 * 디자인은 "성수동", DB는 "성수"로 저장하므로 둘 다 같은 지역으로 봅니다.
 */
export function normalizeRegion(region: string): string {
  const r = region.trim().replace(/\s+/g, '');
  return r.length > 2 && r.endsWith('동') ? r.slice(0, -1) : r;
}
