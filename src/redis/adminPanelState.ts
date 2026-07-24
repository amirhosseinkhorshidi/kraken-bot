import { redis } from "./client.js";

const ADMIN_STATE_TTL_SECONDS = 1800;

export type AdminComposerState =
  | { kind: "broadcast_awaiting_text" }
  | { kind: "send_to_user_awaiting_id" }
  | { kind: "send_to_user_awaiting_text"; targetUserId: number }
  | { kind: "search_verification_awaiting_id" }
  | { kind: "delete_user_awaiting_id" };

function key(adminId: number): string {
  return `admin_state:${adminId}`;
}

export async function setAdminState(adminId: number, state: AdminComposerState): Promise<void> {
  await redis.set(key(adminId), JSON.stringify(state), "EX", ADMIN_STATE_TTL_SECONDS);
}

export async function getAdminState(adminId: number): Promise<AdminComposerState | null> {
  const raw = await redis.get(key(adminId));
  return raw ? (JSON.parse(raw) as AdminComposerState) : null;
}

export async function clearAdminState(adminId: number): Promise<void> {
  await redis.del(key(adminId));
}
