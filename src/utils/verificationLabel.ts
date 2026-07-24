/**
 * "rejected" is intentionally not a durable status: a rejection deletes the
 * verification row (see src/db/verifications.ts), so the user reverts to "none".
 */
export type VerificationStatus = "none" | "pending" | "approved";

/** Label used inline on order messages sent to the orders group. */
export function verificationOrderLabel(status: VerificationStatus): string {
  switch (status) {
    case "approved":
      return "تایید";
    case "pending":
      return "درحال بررسی";
    default:
      return "عدم تایید";
  }
}

/** Label + callback_data for the verification button on the user's main menu. */
export function verificationMenuButton(status: VerificationStatus): {
  text: string;
  callbackData: string;
} {
  switch (status) {
    case "approved":
      return { text: "احراز هویت (تایید شده)", callbackData: "verification_already_verified" };
    case "pending":
      return { text: "احراز هویت (درحال بررسی)", callbackData: "verification_pending" };
    default:
      return { text: "احراز هویت", callbackData: "start_verification" };
  }
}
