import { type VerificationStatus, verificationOrderLabel } from "./verificationLabel.js";

export type ItemType = "gift_card" | "tf2_key";

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  tf2_key: "کلید TF2",
  gift_card: "گیفت کارت",
};

export interface OrderMessageParams {
  orderNumber: string;
  userId: number;
  username: string | null;
  itemType: ItemType;
  verificationStatus: VerificationStatus;
  tradeLink?: string | null;
}

/**
 * The "🔥 سفارش جدید - {n}" / "👤 کاربر : {id}" lines are kept as visible copy
 * only — admin replies are correlated via the Redis reply map (see
 * src/redis/adminReplyMap.ts), not by re-parsing this text.
 */
export function formatOrderMessage(params: OrderMessageParams): string {
  const usernameDisplay = params.username ? `@${params.username}` : "No Username";
  const lines = [
    `🔥 سفارش جدید - ${params.orderNumber}`,
    `👤 کاربر : ${params.userId} - ${usernameDisplay}`,
    `نوع آیتم: ${ITEM_TYPE_LABEL[params.itemType]}`,
    `⭐️ احراز هویت : ${verificationOrderLabel(params.verificationStatus)}`,
  ];

  if (params.itemType === "tf2_key" && params.tradeLink) {
    lines.push(`🔗 ترید لینک :\n${params.tradeLink}`);
  }

  return lines.join("\n");
}
