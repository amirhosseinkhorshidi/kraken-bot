import type { ItemType } from "../utils/orderMessage.js";
import { redis } from "./client.js";

/**
 * Replaces the Python bot's process-local `user_states` dict with Redis so
 * conversation state survives restarts and works across multiple processes.
 */
const FLOW_TTL_SECONDS = 1800;

export type TicketCategory = "receive_order" | "order_usage" | "general";

export type UserFlowState =
  | { kind: "order_number_entry"; itemType: ItemType; promptMessageId?: number }
  | { kind: "order_trade_link_entry"; orderNumber: string; promptMessageId?: number }
  | { kind: "ticket_text_entry"; category: TicketCategory; promptMessageId?: number }
  | {
      kind: "ticket_reply_entry";
      ticketMessageId: number;
      adminReply: string;
      promptMessageId?: number;
    }
  | { kind: "ticket_reply_sent"; ticketMessageId: number; adminReply: string };

function flowKey(userId: number): string {
  return `flow:${userId}`;
}

export async function setFlowState(userId: number, state: UserFlowState): Promise<void> {
  await redis.set(flowKey(userId), JSON.stringify(state), "EX", FLOW_TTL_SECONDS);
}

export async function getFlowState(userId: number): Promise<UserFlowState | null> {
  const raw = await redis.get(flowKey(userId));
  return raw ? (JSON.parse(raw) as UserFlowState) : null;
}

export async function clearFlowState(userId: number): Promise<void> {
  await redis.del(flowKey(userId));
}
