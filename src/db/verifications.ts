import type { VerificationStatus } from "../utils/verificationLabel.js";
import { db } from "./index.js";

export interface Verification {
  id: number;
  user_id: number;
  full_name: string;
  phone_number: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO verifications (user_id, full_name, phone_number, status)
  VALUES (@userId, @fullName, @phoneNumber, 'pending')
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = excluded.full_name,
    phone_number = excluded.phone_number,
    status = 'pending',
    updated_at = datetime('now')
`);

const selectStmt = db.prepare("SELECT * FROM verifications WHERE user_id = @userId");

const updateStatusStmt = db.prepare(`
  UPDATE verifications SET status = @status, updated_at = datetime('now')
  WHERE user_id = @userId
`);

const deleteStmt = db.prepare("DELETE FROM verifications WHERE user_id = @userId");

/** Submits (or re-submits) a verification request; always resets status to pending. */
export function saveVerification(userId: number, fullName: string, phoneNumber: string): void {
  upsertStmt.run({ userId, fullName, phoneNumber });
}

export function getVerification(userId: number): Verification | undefined {
  return selectStmt.get({ userId }) as Verification | undefined;
}

export function approveVerification(userId: number): void {
  updateStatusStmt.run({ userId, status: "approved" });
}

/** A rejection deletes the row entirely, same as the Python behavior — the user reverts to "none". */
export function deleteVerification(userId: number): void {
  deleteStmt.run({ userId });
}

export function getVerificationStatus(userId: number): VerificationStatus {
  const row = getVerification(userId);
  if (!row) return "none";
  return row.status === "approved" ? "approved" : "pending";
}
