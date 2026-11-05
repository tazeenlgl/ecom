import { AppError } from './errors.js';

/**
 * Fixed-window, in-process rate limiter for login-style endpoints.
 *
 * Limitation: counters live in one process. With several API instances each
 * instance enforces its own limit. OTP limits that must hold across instances
 * are enforced from the database instead (modules/customers/otp.ts).
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
    const now = this.now();
    if (this.hits.size > 10_000) this.prune(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > this.max) {
      throw new AppError(429, 'rate_limited', 'Too many attempts. Please try again later.', {
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
