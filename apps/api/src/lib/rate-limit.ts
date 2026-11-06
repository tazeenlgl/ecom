import { AppError } from './errors.js';

/**
 * Fixed-window, in-process rate limiter for login-style endpoints.
 *
 * Limitation: counters live in one process. With several API instances each
 * instance enforces its own limit, so the effective limit is `max` times the
 * number of instances. OTP limits that must hold across instances are enforced
 * from the database instead (modules/customers/otp.ts). Counters also reset when the process restarts.
 *
 * Two styles:
 * - `consume(key)`: count every call, throw once the key exceeds `max` (the call after the `max`-th is refused).
 * - `guard(key)` + `hit(key)`: check first without counting, then record only the outcomes that should count
 *   (for example failed coupon codes). The call after the `max`-th recorded hit is refused.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and throws 429 once the key exceeds `max` in the window. */
  consume(key: string): void {
    const entry = this.record(key);
    if (entry.count > this.max) this.throwLimited(entry.resetAt - this.now());
  }

  /** Throws 429 when the key has already used its whole allowance in the current window. Does not count. */
  guard(key: string): void {
    const entry = this.hits.get(key);
    const now = this.now();
    if (entry && entry.resetAt > now && entry.count >= this.max) this.throwLimited(entry.resetAt - now);
  }

  /** Records one hit without ever throwing (pair with `guard`). */
  hit(key: string): void {
    this.record(key);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private record(key: string): { count: number; resetAt: number } {
    const now = this.now();
    if (this.hits.size > 10_000) this.prune(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + this.windowMs };
      this.hits.set(key, fresh);
      return fresh;
    }
    entry.count += 1;
    return entry;
  }

  private throwLimited(remainingMs: number): never {
    throw new AppError(429, 'rate_limited', 'Too many attempts. Please try again later.', {
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    });
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
