import { redis } from "./client.js";

const OTP_TTL_SECONDS = 300;
const COOLDOWN_SECONDS = 300;
const HOURLY_LIMIT = 3;
const HOURLY_TTL_SECONDS = 3600;
const DAILY_LIMIT = 5;
const DAILY_TTL_SECONDS = 86400;

export type OtpDenialReason = "cooldown" | "hourly_limit" | "daily_limit";

export interface OtpDenial {
  reason: OtpDenialReason;
  /** Only set for "cooldown" — seconds remaining until the next request is allowed. */
  retryAfterSeconds?: number;
}

function otpKey(userId: number): string {
  return `otp:${userId}`;
}
function lastRequestKey(userId: number): string {
  return `last_otp:${userId}`;
}
function hourlyCountKey(userId: number): string {
  return `otp_count_60:${userId}`;
}
function dailyCountKey(userId: number): string {
  return `otp_count_24h:${userId}`;
}

/** First-ever request always passes the cooldown check (nothing to compare against yet). */
export async function canRequestOtp(userId: number): Promise<OtpDenial | null> {
  const lastRequestedAt = await redis.get(lastRequestKey(userId));
  if (lastRequestedAt) {
    const elapsedSeconds = (Date.now() - Number(lastRequestedAt)) / 1000;
    if (elapsedSeconds < COOLDOWN_SECONDS) {
      return {
        reason: "cooldown",
        retryAfterSeconds: Math.trunc(COOLDOWN_SECONDS - elapsedSeconds),
      };
    }
  }

  const hourlyCount = Number((await redis.get(hourlyCountKey(userId))) ?? "0");
  if (hourlyCount >= HOURLY_LIMIT) return { reason: "hourly_limit" };

  const dailyCount = Number((await redis.get(dailyCountKey(userId))) ?? "0");
  if (dailyCount >= DAILY_LIMIT) return { reason: "daily_limit" };

  return null;
}

export async function recordOtpRequest(userId: number): Promise<void> {
  await redis.set(lastRequestKey(userId), Date.now(), "EX", HOURLY_TTL_SECONDS);

  const hourlyCount = await redis.incr(hourlyCountKey(userId));
  if (hourlyCount === 1) await redis.expire(hourlyCountKey(userId), HOURLY_TTL_SECONDS);

  const dailyCount = await redis.incr(dailyCountKey(userId));
  if (dailyCount === 1) await redis.expire(dailyCountKey(userId), DAILY_TTL_SECONDS);
}

export function generateOtpCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function storeOtpCode(userId: number, code: string): Promise<void> {
  await redis.set(otpKey(userId), code, "EX", OTP_TTL_SECONDS);
}

export async function verifyOtpCode(userId: number, code: string): Promise<boolean> {
  const stored = await redis.get(otpKey(userId));
  return stored !== null && stored === code;
}

export async function clearOtpCode(userId: number): Promise<void> {
  await redis.del(otpKey(userId));
}
