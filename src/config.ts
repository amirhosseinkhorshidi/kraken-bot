import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  ADMIN_ID: z.coerce.number().int(),
  TICKET_GROUP_ID: z.coerce.number().int(),
  ORDERS_GROUP_ID: z.coerce.number().int(),
  VERIFICATION_GROUP_ID: z.coerce.number().int(),

  STEAM_API_KEY: z.string().min(1, "STEAM_API_KEY is required"),

  OTP_TEST_MODE: z.string().default("false"),
  OTP_BASE_URL: z.string().url().default("https://s.api.ir"),
  OTP_BEARER_TOKEN: z.string().min(1, "OTP_BEARER_TOKEN is required"),

  DB_PATH: z.string().default("./data/kraken-store.db"),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_DB: z.coerce.number().int().default(1),

  // Leave empty to run long-polling (dev); set to enable webhook mode (prod).
  WEBHOOK_URL: z.string().default(""),
  WEBHOOK_PATH: z.string().default("/"),
  WEBAPP_HOST: z.string().default("127.0.0.1"),
  WEBAPP_PORT: z.coerce.number().int().default(8443),

  TIMEZONE: z.string().default("Asia/Tehran"),
  BUSINESS_HOURS_START: z.string().default("09:30"),
  BUSINESS_HOURS_END: z.string().default("24:00"),

  ENABLE_LOGGING: z.string().default("true"),
});

const env = EnvSchema.parse(process.env);

const webhookPath = env.WEBHOOK_PATH.startsWith("/") ? env.WEBHOOK_PATH : `/${env.WEBHOOK_PATH}`;

export const config = {
  botToken: env.BOT_TOKEN,
  adminId: env.ADMIN_ID,

  groups: {
    tickets: env.TICKET_GROUP_ID,
    orders: env.ORDERS_GROUP_ID,
    verification: env.VERIFICATION_GROUP_ID,
  },

  steamApiKey: env.STEAM_API_KEY,

  otp: {
    testMode: env.OTP_TEST_MODE.toLowerCase() === "true",
    baseUrl: env.OTP_BASE_URL,
    bearerToken: env.OTP_BEARER_TOKEN,
  },

  dbPath: env.DB_PATH,

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
  },

  webhook: {
    url: env.WEBHOOK_URL,
    path: webhookPath,
    host: env.WEBAPP_HOST,
    port: env.WEBAPP_PORT,
  },

  timezone: env.TIMEZONE,
  businessHours: {
    start: env.BUSINESS_HOURS_START,
    end: env.BUSINESS_HOURS_END,
  },

  enableLogging: env.ENABLE_LOGGING.toLowerCase() === "true",
} as const;

export type Config = typeof config;
