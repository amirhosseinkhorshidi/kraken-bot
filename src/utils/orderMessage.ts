import { bold, escapeHtml } from "./html.js";
import { type VerificationStatus, verificationOrderLabel } from "./verificationLabel.js";

export type ItemType = "gift_card" | "tf2_key";

export interface OrderMessageParams {
  orderNumber: string;
  userId: number;
  username: string | null;
  itemType: ItemType;
  verificationStatus: VerificationStatus;
  tradeLink?: string | null;
}

/**
 * Returns `parse_mode: "HTML"` markup — the field labels are bold. The "سفارش جدید - {n}" /
 * "اطلاعات کاربر : {id}" lines are kept as visible copy only — admin replies are correlated via
 * the Redis reply map (see src/redis/adminReplyMap.ts), not by re-parsing this text.
 */
export function formatOrderMessage(params: OrderMessageParams): string {
  const usernameDisplay = params.username ? `@${escapeHtml(params.username)}` : "No Username";
  const lines = [
    `🔥 ${bold(`سفارش جدید - ${escapeHtml(params.orderNumber)}`)}`,
    `👤 ${bold("اطلاعات کاربر")} : ${params.userId} - ${usernameDisplay}`,
    `⭐️ ${bold("احراز هویت")} : ${verificationOrderLabel(params.verificationStatus)}`,
  ];

  if (params.itemType === "tf2_key" && params.tradeLink) {
    lines.push(`🔗 ${bold("ترید لینک")} :\n${escapeHtml(params.tradeLink)}`);
  }

  return lines.join("\n");
}
