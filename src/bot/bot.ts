import { autoRetry } from "@grammyjs/auto-retry";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { Bot, GrammyError, HttpError } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { setupAdminHandlers } from "./handlers/admin.js";
import { setupUserHandlers } from "./handlers/user.js";
import { setupVerificationHandlers } from "./handlers/verification.js";

export const bot = new Bot(config.botToken);

// Keep outgoing API calls under Telegram's rate limits (queues/paces them) and transparently
// retry the rare 429 that still slips through, instead of dropping the request on the floor.
bot.api.config.use(apiThrottler());
bot.api.config.use(autoRetry());

bot.use(async (ctx, next) => {
  const updateType = Object.keys(ctx.update).find((key) => key !== "update_id");
  logger.info(
    {
      updateId: ctx.update.update_id,
      updateType,
      userId: ctx.from?.id,
      username: ctx.from?.username,
      text: ctx.message?.text,
      data: ctx.callbackQuery?.data,
    },
    "Update received",
  );
  await next();
});

// Registration order matters: the admin's own /start must be captured by the
// admin handlers first, and verification's catch-all text handler must run
// before the user handlers' catch-all text handler to avoid collisions
// (mirrors the Python bot's admin_router -> verification_router -> user_router order).
setupAdminHandlers(bot);
setupVerificationHandlers(bot);
setupUserHandlers(bot);

bot.catch((err) => {
  const ctx = err.ctx;
  const error = err.error;
  if (error instanceof GrammyError) {
    logger.error({ err: error, updateId: ctx.update.update_id }, "Telegram API error");
  } else if (error instanceof HttpError) {
    logger.error({ err: error, updateId: ctx.update.update_id }, "Could not contact Telegram");
  } else {
    logger.error({ err: error, updateId: ctx.update.update_id }, "Unknown error in handler");
  }
});
