import type { ItemType } from "../utils/orderMessage.js";
import { redis } from "./client.js";

/**
 * Correlates a bot-sent group message with what it's about, so that when an
 * admin replies to it we know the target directly instead of regex-parsing
 * the message text/caption (the fragile approach the Python bot used).
 */
export type AdminReplyTarget =
  | { type: "ticket"; userId: number }
  | { type: "verification"; userId: number }
  | { type: "order"; userId: number; orderNumber: string; itemType: ItemType };

function key(chatId: number, messageId: number): string {
  return `admin_reply_target:${chatId}:${messageId}`;
}

export async function registerAdminReplyTarget(
  chatId: number,
  messageId: number,
  target: AdminReplyTarget,
): Promise<void> {
  await redis.set(key(chatId, messageId), JSON.stringify(target));
}

export async function getAdminReplyTarget(
  chatId: number,
  messageId: number,
): Promise<AdminReplyTarget | null> {
  const raw = await redis.get(key(chatId, messageId));
  return raw ? (JSON.parse(raw) as AdminReplyTarget) : null;
}
