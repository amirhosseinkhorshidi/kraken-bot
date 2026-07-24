import { Redis } from "ioredis";
import { config } from "../config.js";

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  db: config.redis.db,
  lazyConnect: false,
});

export async function setJson(key: string, value: unknown, expirySeconds?: number): Promise<void> {
  const payload = JSON.stringify(value);
  if (expirySeconds) {
    await redis.set(key, payload, "EX", expirySeconds);
  } else {
    await redis.set(key, payload);
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  const value = await redis.get(key);
  if (!value) return null;
  return JSON.parse(value) as T;
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
