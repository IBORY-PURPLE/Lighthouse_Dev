import "server-only";

// 서버 메모리 횟수 제한(완화 수단). 재시작이나 서버 분산 때 초기화된다. TSD §9.

/** 이 수를 넘으면 끝난 기록을 치워 메모리가 계속 늘지 않게 한다. */
const SWEEP_THRESHOLD = 1000;

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: RateLimiterOptions) {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return function check(key: string): RateLimitResult {
    const current = now();

    if (windows.size >= SWEEP_THRESHOLD) {
      for (const [windowKey, window] of windows) {
        if (current - window.startedAt >= windowMs) windows.delete(windowKey);
      }
    }

    const window = windows.get(key);
    if (!window || current - window.startedAt >= windowMs) {
      windows.set(key, { startedAt: current, count: 1 });
      return { allowed: true };
    }
    if (window.count >= limit) {
      const remainingMs = windowMs - (current - window.startedAt);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(remainingMs / 1000),
      };
    }
    window.count += 1;
    return { allowed: true };
  };
}

/** Vercel은 x-forwarded-for를 실제 접속 주소로 덮어쓴다. */
export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}
