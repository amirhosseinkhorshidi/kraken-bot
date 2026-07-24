import { redis } from "./client.js";

/**
 * Tracks the ticket-group message id of a user's currently open ticket, so a
 * follow-up user reply threads onto the right message. No TTL: mirrors the
 * Python dict, which only gets overwritten when the user opens a new ticket,
 * never expired.
 */
function key(userId: number): string {
  return `ticket_thread:${userId}`;
}

export async function setTicketThread(userId: number, groupMessageId: number): Promise<void> {
  await redis.set(key(userId), groupMessageId);
}

export async function getTicketThread(userId: number): Promise<number | null> {
  const raw = await redis.get(key(userId));
  return raw ? Number(raw) : null;
}
