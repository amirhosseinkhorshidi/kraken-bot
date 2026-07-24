import type { ItemType } from "../utils/orderMessage.js";
import { db } from "./index.js";

export type OrderStatus = "pending" | "approved" | "rejected";

export interface Order {
  id: number;
  user_id: number;
  order_number: string;
  item_type: ItemType;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

const insertStmt = db.prepare(`
  INSERT INTO orders (user_id, order_number, item_type)
  VALUES (@userId, @orderNumber, @itemType)
`);

const selectStmt = db.prepare(
  "SELECT * FROM orders WHERE user_id = @userId AND order_number = @orderNumber",
);

const updateStatusStmt = db.prepare(`
  UPDATE orders SET status = @status, updated_at = datetime('now')
  WHERE user_id = @userId AND order_number = @orderNumber
`);

const deleteStmt = db.prepare(
  "DELETE FROM orders WHERE user_id = @userId AND order_number = @orderNumber",
);

export function saveOrder(userId: number, orderNumber: string, itemType: ItemType): void {
  insertStmt.run({ userId, orderNumber, itemType });
}

export function getOrder(userId: number, orderNumber: string): Order | undefined {
  return selectStmt.get({ userId, orderNumber }) as Order | undefined;
}

export function updateOrderStatus(userId: number, orderNumber: string, status: OrderStatus): void {
  updateStatusStmt.run({ userId, orderNumber, status });
}

/** Rejected orders are deleted outright (no permanent DB audit trail — mirrors the Python behavior). */
export function deleteOrder(userId: number, orderNumber: string): void {
  deleteStmt.run({ userId, orderNumber });
}
