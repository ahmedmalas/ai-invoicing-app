/** Simple in-memory rate limiter for bank connect/refresh/callback endpoints. */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function assertBankRateLimit(
  key: string,
  options?: { limit?: number; windowMs?: number },
): void {
  const limit = options?.limit ?? 10;
  const windowMs = options?.windowMs ?? 60_000;
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  existing.count += 1;
  if (existing.count > limit) {
    throw new Error('BANK_RATE_LIMITED');
  }
}

/** Test helper */
export function resetBankRateLimitsForTests(): void {
  buckets.clear();
}
