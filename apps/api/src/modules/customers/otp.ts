import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { otpChallenges } from '../../db/schema.js';
import { hmacSha256, newOtpCode, safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export const OTP_POLICY = {
  digits: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  resendAfterSeconds: 30,
  // Durable limits, enforced from the database so they hold across API instances.
  maxPerPhonePer15Min: 3,
  maxPerIpPerHour: 20,
} as const;

export type OtpPurpose = 'login' | 'reset_password';

const codeHash = (ctx: AppContext, challengeId: string, code: string) =>
  hmacSha256(ctx.config.OTP_HMAC_SECRET, `${challengeId}:${code}`);

/**
 * Creates a challenge and, when `deliver` is true, sends the code. Callers pass
 * deliver=false for accounts that must not receive a code (so the response does
 * not reveal whether an account exists).
 */
export async function issueOtp(
  ctx: AppContext,
  input: { storeId: string; phone: string; purpose: OtpPurpose; ip: string; deliver: boolean },
) {
  const now = ctx.now();
  const [phoneWindow] = await ctx.db
    .select({ n: count(), latest: sql<Date | null>`max(${otpChallenges.createdAt})` })
    .from(otpChallenges)
    .where(
      and(
        eq(otpChallenges.storeId, input.storeId),
        eq(otpChallenges.phone, input.phone),
        gt(otpChallenges.createdAt, new Date(now.getTime() - 15 * 60_000)),
      ),
    );
  const latest = phoneWindow?.latest ? new Date(phoneWindow.latest) : null;
  if (latest && now.getTime() - latest.getTime() < OTP_POLICY.resendAfterSeconds * 1000) {
    throw new AppError(429, 'rate_limited', 'Please wait before requesting another code.', {
      retryAfterSeconds: Math.ceil((OTP_POLICY.resendAfterSeconds * 1000 - (now.getTime() - latest.getTime())) / 1000),
    });
  }
  if ((phoneWindow?.n ?? 0) >= OTP_POLICY.maxPerPhonePer15Min) {
    throw new AppError(429, 'rate_limited', 'Too many codes requested. Please try again later.');
  }
  const [ipWindow] = await ctx.db
    .select({ n: count() })
    .from(otpChallenges)
    .where(and(eq(otpChallenges.requestIp, input.ip), gt(otpChallenges.createdAt, new Date(now.getTime() - 3_600_000))));
  if ((ipWindow?.n ?? 0) >= OTP_POLICY.maxPerIpPerHour) {
    throw new AppError(429, 'rate_limited', 'Too many codes requested. Please try again later.');
  }

  const code = newOtpCode(OTP_POLICY.digits);
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + OTP_POLICY.ttlSeconds * 1000);
  await ctx.db.insert(otpChallenges).values({
    id,
    storeId: input.storeId,
    phone: input.phone,
    purpose: input.purpose,
    codeHash: codeHash(ctx, id, code),
    maxAttempts: OTP_POLICY.maxAttempts,
    expiresAt,
    requestIp: input.ip,
    createdAt: now,
  });

  if (input.deliver) {
    try {
      await ctx.messages.send({ channel: 'sms', to: input.phone, template: `otp.${input.purpose}`, variables: { code } });
    } catch {
      throw new AppError(503, 'unavailable', 'We could not send a code right now. Please try again later.');
    }
  }
  return { challengeId: id, expiresAt, resendAfterSeconds: OTP_POLICY.resendAfterSeconds };
}

/**
 * Verifies and consumes a challenge in its own transaction (row-locked, so
 * concurrent attempts on one challenge are serialised). Wrong codes count
 * against the challenge; a consumed, expired or exhausted challenge is
 * rejected, so each code works once at most.
 */
export async function consumeOtp(
  ctx: AppContext,
  input: { storeId: string; challengeId: string; phone: string; purpose: OtpPurpose; code: string },
): Promise<void> {
  const failure = await ctx.db.transaction(async (tx) => {
    const [challenge] = await tx
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.id, input.challengeId),
          eq(otpChallenges.storeId, input.storeId),
          eq(otpChallenges.phone, input.phone),
          eq(otpChallenges.purpose, input.purpose),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .for('update');
    if (!challenge || challenge.expiresAt <= ctx.now()) {
      return new AppError(400, 'otp_expired', 'This code has expired. Please request a new one.');
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      return new AppError(400, 'otp_expired', 'Too many incorrect attempts. Please request a new code.');
    }
    if (!safeEqual(codeHash(ctx, challenge.id, input.code), challenge.codeHash)) {
      await tx.update(otpChallenges).set({ attempts: sql`${otpChallenges.attempts} + 1` }).where(eq(otpChallenges.id, challenge.id));
      return new AppError(400, 'otp_invalid', 'The code is incorrect.', {
        attemptsRemaining: Math.max(0, challenge.maxAttempts - challenge.attempts - 1),
      });
    }
    await tx.update(otpChallenges).set({ consumedAt: ctx.now() }).where(eq(otpChallenges.id, challenge.id));
    return null;
  });
  // Thrown after commit so the attempt counter survives.
  if (failure) throw failure;
}
