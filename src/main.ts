import fastify, { type FastifyInstance } from "fastify";
import { webhookCallback } from "grammy";
import { bot } from "./bot/bot.js";
import { config } from "./config.js";
import { closeDb } from "./db/index.js";
import { logger } from "./logger.js";
import { closeRedis } from "./redis/client.js";

let server: FastifyInstance | null = null;

async function main(): Promise<void> {
  await bot.init();
  logger.info({ username: bot.botInfo.username }, "Bot initialized");

  if (config.webhook.url) {
    await bot.api.setWebhook(`${config.webhook.url}${config.webhook.path}`, {
      drop_pending_updates: true,
    });

    server = fastify();
    server.post(config.webhook.path, webhookCallback(bot, "fastify"));

    await server.listen({ host: config.webhook.host, port: config.webhook.port });
    logger.info(
      { host: config.webhook.host, port: config.webhook.port, path: config.webhook.path },
      "Webhook server listening",
    );
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    await bot.start({
      onStart: () => logger.info("Bot started (long polling)"),
    });
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  try {
    if (server) {
      await server.close();
    } else {
      await bot.stop();
    }
  } finally {
    closeDb();
    await closeRedis();
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal error during startup");
  process.exit(1);
});
