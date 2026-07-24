import { redis } from "./client.js";

export type VerificationStep = "full_name" | "phone_number" | "otp_verification" | "photo_upload";

const STEP_TTL_SECONDS = 3600;

function stepKey(userId: number): string {
  return `verification_step:${userId}`;
}
function dataKey(userId: number): string {
  return `verification_data:${userId}`;
}

export interface VerificationDraft {
  messageId?: number;
  fullName?: string;
  phoneNumber?: string;
  photoMessageId?: number;
}

export async function setVerificationStep(userId: number, step: VerificationStep): Promise<void> {
  await redis.set(stepKey(userId), step, "EX", STEP_TTL_SECONDS);
}

export async function getVerificationStep(userId: number): Promise<VerificationStep | null> {
  return (await redis.get(stepKey(userId))) as VerificationStep | null;
}

export async function updateVerificationDraft(
  userId: number,
  patch: Partial<VerificationDraft>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  await redis.hset(
    dataKey(userId),
    Object.fromEntries(entries.map(([key, value]) => [key, String(value)])),
  );
  await redis.expire(dataKey(userId), STEP_TTL_SECONDS);
}

export async function getVerificationDraft(userId: number): Promise<VerificationDraft> {
  const raw = await redis.hgetall(dataKey(userId));
  return {
    messageId: raw.messageId ? Number(raw.messageId) : undefined,
    fullName: raw.fullName,
    phoneNumber: raw.phoneNumber,
    photoMessageId: raw.photoMessageId ? Number(raw.photoMessageId) : undefined,
  };
}

export async function clearVerificationState(userId: number): Promise<void> {
  await redis.del(stepKey(userId), dataKey(userId));
}
