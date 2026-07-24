import { toEnglishDigits } from "./persianDigits.js";

const DIGIT_PATTERN = /[0-9۰-۹٠-٩]/;
const PERSIAN_LETTERS_PATTERN = /^[؀-ۿ\s]+$/;

export type OrderNumberErrorReason = "empty" | "wrong_length" | "no_zero_prefix";

export type OrderNumberValidation =
  | { ok: true; value: string }
  | { ok: false; reason: OrderNumberErrorReason };

/** 5 digits, must start with "0" (the store's order-numbering scheme). */
export function validateOrderNumber(raw: string): OrderNumberValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  const normalized = toEnglishDigits(trimmed);
  if (!/^\d{5}$/.test(normalized)) return { ok: false, reason: "wrong_length" };
  if (!normalized.startsWith("0")) return { ok: false, reason: "no_zero_prefix" };

  return { ok: true, value: normalized };
}

/** Iranian mobile format: 11 digits, starts with "09". */
export function validatePhoneNumber(raw: string): string | null {
  const normalized = toEnglishDigits(raw.trim());
  return /^09\d{9}$/.test(normalized) ? normalized : null;
}

/** Persian letters/spaces only, non-empty, no digits of any script. */
export function validatePersianName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  if (DIGIT_PATTERN.test(trimmed)) return null;
  return PERSIAN_LETTERS_PATTERN.test(trimmed) ? trimmed : null;
}

/** 4-digit OTP code. */
export function validateOtpCode(raw: string): string | null {
  const normalized = toEnglishDigits(raw.trim());
  return /^\d{4}$/.test(normalized) ? normalized : null;
}
