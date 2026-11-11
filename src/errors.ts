/** API 가 사용자에게 알려줄 수 있는 에러들 (app.ts 에서 상태 코드로 바꿈) */

export class RegionNotFoundError extends Error {
  constructor(region: string) {
    super(`'${region}' 지역을 찾을 수 없어요.`);
    this.name = 'RegionNotFoundError';
  }
}

export class PlaceNotFoundError extends Error {
  constructor(message = '장소를 찾을 수 없어요.') {
    super(message);
    this.name = 'PlaceNotFoundError';
  }
}

/** 요청은 맞지만 지금 상태로는 할 수 없을 때 (예: 장바구니가 꽉 참) → 409 */
export class ConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}
