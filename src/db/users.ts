import { db } from "./index.js";

export interface BotUser {
  id: number;
  user_id: number;
  username: string | null;
  created_at: string;
  updated_at: string;
}

const upsertUserStmt = db.prepare(`
  INSERT INTO bot_users (user_id, username)
  VALUES (@userId, @username)
  ON CONFLICT (user_id) DO UPDATE SET
    username = excluded.username,
    updated_at = datetime('now')
  WHERE bot_users.username IS NOT excluded.username
`);

const selectUserStmt = db.prepare("SELECT * FROM bot_users WHERE user_id = @userId");
const selectAllUsersStmt = db.prepare("SELECT * FROM bot_users");
const deleteUserStmt = db.prepare("DELETE FROM bot_users WHERE user_id = @userId");

/** Registers a new user or refreshes their cached username (a no-op write if unchanged). */
export function upsertUser(userId: number, username: string | null): void {
  upsertUserStmt.run({ userId, username });
}

export function getUser(userId: number): BotUser | undefined {
  return selectUserStmt.get({ userId }) as BotUser | undefined;
}

export function isUserMember(userId: number): boolean {
  return getUser(userId) !== undefined;
}

/** Used for admin broadcasts. */
export function getAllUsers(): BotUser[] {
  return selectAllUsersStmt.all() as BotUser[];
}

/** Cascades to trade_links / orders / verifications via ON DELETE CASCADE. */
export function deleteUser(userId: number): void {
  deleteUserStmt.run({ userId });
}
