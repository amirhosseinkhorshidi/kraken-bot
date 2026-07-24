import type { Bot, Context } from "grammy";
import { GrammyError, InlineKeyboard } from "grammy";
import { config } from "../../config.js";
import { deleteOrder, getOrder, updateOrderStatus } from "../../db/orders.js";
import { deleteUser, getAllUsers, isUserMember } from "../../db/users.js";
import { deleteVerification, getVerification } from "../../db/verifications.js";
import { logger } from "../../logger.js";
import { clearAdminState, getAdminState, setAdminState } from "../../redis/adminPanelState.js";
import { getAdminReplyTarget } from "../../redis/adminReplyMap.js";
import { getCurrentOrderMessage, isWithinBusinessHours } from "../../utils/businessHours.js";
import { toEnglishDigits } from "../../utils/persianDigits.js";
import { verificationOrderLabel } from "../../utils/verificationLabel.js";
import { rejectVerificationWithReason } from "./verification.js";

const ADMIN_MENU_TEXT = "پنل مدیریت فروشگاه کراکن";

function buildAdminMenuKeyboard() {
  return new InlineKeyboard()
    .text("مشاهده پیام فعلی", "view_current_message")
    .row()
    .text("جستجوی احراز هویت", "search_verification")
    .row()
    .text("ارسال پیام", "send_message")
    .row()
    .text("حذف کاربر", "delete_user");
}

function backToAdminMenuKeyboard() {
  return new InlineKeyboard().text("بازگشت", "back_to_admin_menu").danger();
}

function parseUserId(text: string): number | null {
  const normalized = toEnglishDigits(text.trim());
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseGiftCodeReply(text: string): { codes: string[]; description: string } {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return { codes: [], description: "" };
  if (lines.length === 1) return { codes: [lines[0]!], description: "" };
  return { codes: lines.slice(0, -1), description: lines[lines.length - 1]! };
}

async function handleSearchVerification(ctx: Context): Promise<void> {
  const adminId = ctx.from!.id;
  const userId = parseUserId(ctx.message!.text!);
  await clearAdminState(adminId);

  if (userId === null) {
    await ctx.reply("شناسه نامعتبر است.");
    return;
  }
  const verification = getVerification(userId);
  if (!verification) {
    await ctx.reply("احراز هویتی برای این کاربر یافت نشد.");
    return;
  }
  const status = verification.status === "approved" ? "approved" : "pending";
  await ctx.reply(
    `نام: ${verification.full_name}\nشماره موبایل: ${verification.phone_number}\nوضعیت: ${verificationOrderLabel(status)}`,
    { reply_markup: new InlineKeyboard().text("حذف احراز هویت", `delete_verification_${userId}`) },
  );
}

async function handleDeleteUserId(ctx: Context): Promise<void> {
  const adminId = ctx.from!.id;
  const userId = parseUserId(ctx.message!.text!);
  await clearAdminState(adminId);

  if (userId === null || !isUserMember(userId)) {
    await ctx.reply("کاربری با این شناسه یافت نشد.");
    return;
  }
  await ctx.reply(
    `آیا از حذف کاربر ${userId} مطمئن هستید؟ این عمل سفارش‌ها و احراز هویت او را نیز حذف می‌کند.`,
    {
      reply_markup: new InlineKeyboard().text("تایید حذف", `confirm_delete_user_${userId}`),
    },
  );
}

async function handleBroadcast(ctx: Context): Promise<void> {
  const adminId = ctx.from!.id;
  const text = ctx.message!.text!;
  await clearAdminState(adminId);

  const users = getAllUsers();
  const BATCH_SIZE = 10;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((user) => ctx.api.sendMessage(user.user_id, text)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") sent++;
      else failed++;
    }
  }

  logger.info({ sent, failed }, "Broadcast sent");
  await ctx.reply(`ارسال همگانی پایان یافت.\nموفق: ${sent}\nناموفق: ${failed}`);
}

async function handleSendToUserId(ctx: Context): Promise<void> {
  const adminId = ctx.from!.id;
  const userId = parseUserId(ctx.message!.text!);

  if (userId === null || !isUserMember(userId)) {
    await ctx.reply("کاربری با این شناسه یافت نشد. دوباره تلاش کنید یا بازگردید.");
    return;
  }
  await setAdminState(adminId, { kind: "send_to_user_awaiting_text", targetUserId: userId });
  await ctx.reply("متن پیام را ارسال کنید:");
}

async function handleSendToUserText(ctx: Context, targetUserId: number): Promise<void> {
  const adminId = ctx.from!.id;
  const text = ctx.message!.text!;
  await clearAdminState(adminId);

  try {
    await ctx.api.sendMessage(targetUserId, text);
    logger.info({ targetUserId }, "Direct message sent");
    await ctx.reply("پیام با موفقیت ارسال شد.");
  } catch (error) {
    if (error instanceof GrammyError) {
      if (error.error_code === 403) {
        await ctx.reply("کاربر ربات را مسدود کرده است.");
      } else if (error.description.includes("chat not found")) {
        await ctx.reply("چت با این کاربر یافت نشد (کاربر هرگز ربات را استارت نکرده است).");
      } else {
        await ctx.reply(`خطا در ارسال پیام: ${error.description}`);
      }
    } else {
      await ctx.reply("خطای ناشناخته در ارسال پیام.");
    }
  }
}

export function setupAdminHandlers(bot: Bot): void {
  bot.command("start", async (ctx, next) => {
    if (ctx.from?.id !== config.adminId) return next();
    await ctx.reply(ADMIN_MENU_TEXT, { reply_markup: buildAdminMenuKeyboard() });
  });

  bot.callbackQuery("back_to_admin_menu", async (ctx) => {
    await clearAdminState(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ADMIN_MENU_TEXT, { reply_markup: buildAdminMenuKeyboard() });
  });

  bot.callbackQuery("view_current_message", async (ctx) => {
    await ctx.answerCallbackQuery();
    const statusLine = isWithinBusinessHours()
      ? "فروشگاه هم‌اکنون در ساعت کاری است."
      : "فروشگاه هم‌اکنون خارج از ساعت کاری است.";
    await ctx.editMessageText(
      `${statusLine}\n\nپیامی که کاربران هم‌اکنون هنگام ثبت سفارش دریافت می‌کنند:\n\n${getCurrentOrderMessage()}`,
      { reply_markup: backToAdminMenuKeyboard() },
    );
  });

  bot.callbackQuery("search_verification", async (ctx) => {
    await setAdminState(ctx.from.id, { kind: "search_verification_awaiting_id" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("شناسه عددی کاربر را ارسال کنید:", {
      reply_markup: backToAdminMenuKeyboard(),
    });
  });

  bot.callbackQuery("send_message", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("نوع ارسال را انتخاب کنید:", {
      reply_markup: new InlineKeyboard()
        .text("ارسال همگانی", "broadcast_message")
        .row()
        .text("ارسال به کاربر خاص", "send_to_user")
        .row()
        .text("بازگشت", "back_to_admin_menu")
        .danger(),
    });
  });

  bot.callbackQuery("broadcast_message", async (ctx) => {
    await setAdminState(ctx.from.id, { kind: "broadcast_awaiting_text" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("متن پیام همگانی را ارسال کنید:", {
      reply_markup: backToAdminMenuKeyboard(),
    });
  });

  bot.callbackQuery("send_to_user", async (ctx) => {
    await setAdminState(ctx.from.id, { kind: "send_to_user_awaiting_id" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("شناسه عددی کاربر مقصد را ارسال کنید:", {
      reply_markup: backToAdminMenuKeyboard(),
    });
  });

  bot.callbackQuery("delete_user", async (ctx) => {
    await setAdminState(ctx.from.id, { kind: "delete_user_awaiting_id" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("شناسه عددی کاربری که باید حذف شود را ارسال کنید:", {
      reply_markup: backToAdminMenuKeyboard(),
    });
  });

  bot.callbackQuery("disabled", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^delete_verification_(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    deleteVerification(userId);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("احراز هویت این کاربر حذف شد.");
  });

  bot.callbackQuery(/^confirm_delete_user_(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    deleteUser(userId);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`کاربر ${userId} حذف شد.`);
  });

  // --- Order approve/reject (shared-inbox: any orders-group member, not ADMIN_ID-gated) ---

  bot.callbackQuery(/^approve_order_(\d+)_(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    const orderNumber = ctx.match[2]!;
    const order = getOrder(userId, orderNumber);
    if (!order) {
      await ctx.answerCallbackQuery({ text: "سفارش یافت نشد.", show_alert: true });
      return;
    }

    updateOrderStatus(userId, orderNumber, "approved");
    logger.info({ userId, orderNumber }, "Order approved");

    if (order.item_type === "tf2_key") {
      await ctx.api
        .sendMessage(
          userId,
          `آیتم خریداری‌شده با شماره سفارش ${orderNumber} ارسال گردید.\n\nدر صورت بروز هرگونه مشکل، از طریق ثبت تیکت با ما در ارتباط باشید.`,
          { reply_markup: new InlineKeyboard().text("ارسال تیکت", "create_support_ticket") },
        )
        .catch(() => undefined);
    }
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("ارسال شد", "disabled"),
    });
    await ctx.answerCallbackQuery({ text: "سفارش تایید شد." });
  });

  bot.callbackQuery(/^reject_order_(\d+)_(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    const orderNumber = ctx.match[2]!;
    deleteOrder(userId, orderNumber);
    logger.info({ userId, orderNumber }, "Order rejected");
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("شماره سفارش اشتباه", "disabled"),
    });
    await ctx.api
      .sendMessage(userId, `شماره سفارش ${orderNumber} معتبر نمی‌باشد.`)
      .catch(() => undefined);
    await ctx.answerCallbackQuery({ text: "سفارش رد شد." });
  });

  bot.callbackQuery(/^send_verification_reminder_(\d+)_(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    const orderNumber = ctx.match[2]!;

    try {
      await ctx.api.sendMessage(
        userId,
        "برای دریافت سفارش، تکمیل فرآیند احراز هویت الزامی است. احراز هویت تنها یک‌بار انجام می‌شود و پس از تایید توسط کارشناسان، در خریدهای بعدی نیازی به تکرار این مراحل نخواهد بود.",
        {
          reply_markup: new InlineKeyboard().text(
            "تکمیل احراز هویت",
            "start_verification_from_reminder",
          ),
        },
      );

      const keyboard = new InlineKeyboard()
        .text("ارسال شد", "disabled")
        .row()
        .text("رد", `reject_order_${userId}_${orderNumber}`)
        .text("تایید", `approve_order_${userId}_${orderNumber}`);
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => undefined);

      await ctx.answerCallbackQuery({ text: "پیام یادآوری احراز هویت ارسال شد" });
    } catch {
      await ctx.answerCallbackQuery({ text: "خطا در ارسال پیام", show_alert: true });
    }
  });

  // --- Admin state (search / broadcast / send-to-user / delete-user) dispatcher ---

  bot.on("message:text", async (ctx, next) => {
    if (ctx.from?.id !== config.adminId) return next();
    const state = await getAdminState(ctx.from.id);
    if (!state) return next();

    switch (state.kind) {
      case "search_verification_awaiting_id":
        return handleSearchVerification(ctx);
      case "delete_user_awaiting_id":
        return handleDeleteUserId(ctx);
      case "broadcast_awaiting_text":
        return handleBroadcast(ctx);
      case "send_to_user_awaiting_id":
        return handleSendToUserId(ctx);
      case "send_to_user_awaiting_text":
        return handleSendToUserText(ctx, state.targetUserId);
      default:
        return next();
    }
  });

  // --- Generic "admin replied to a group message" dispatcher ---
  // Correlates via the Redis reply map (registered when the message was sent) instead of
  // regex-parsing the replied-to message's text, unlike the Python bot.

  bot.on("message", async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !ctx.message.text) return next();

    const target = await getAdminReplyTarget(ctx.chat.id, replyTo.message_id);
    if (!target) return next();

    if (target.type === "ticket") {
      await ctx.api
        .sendMessage(target.userId, `جواب تیکت شما\n\n${ctx.message.text}`, {
          reply_markup: new InlineKeyboard().text("جواب به تیکت", "reply_to_ticket"),
        })
        .catch(() => undefined);
      await ctx.api
        .editMessageReplyMarkup(config.groups.tickets, replyTo.message_id, {
          reply_markup: new InlineKeyboard().text("جواب ارسال شد", "disabled"),
        })
        .catch(() => undefined);
      return;
    }

    if (target.type === "verification") {
      await rejectVerificationWithReason(ctx, target.userId, replyTo.message_id, ctx.message.text);
      await ctx.deleteMessage().catch(() => undefined);
      return;
    }

    if (target.type === "order" && target.itemType === "gift_card") {
      const { codes, description } = parseGiftCodeReply(ctx.message.text);
      if (codes.length === 0) return;

      const codesBlock =
        codes.length === 1
          ? `Code : <code>${escapeHtml(codes[0]!)}</code>`
          : `Code : \n\n${codes.map((code) => `<code>${escapeHtml(code)}</code>`).join("\n")}`;
      const message = [
        `گیفت کارت خریداری شده شما با شماره سفارش ${target.orderNumber}`,
        "",
        codesBlock,
        "",
        `Description : ${escapeHtml(description)}`,
        "",
        "در صورت بروز هرگونه مشکل، از طریق ثبت تیکت با ما در ارتباط باشید.",
      ].join("\n");

      await ctx.api
        .sendMessage(target.userId, message, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("ارسال تیکت", "create_support_ticket"),
        })
        .catch(() => undefined);
      await ctx.api
        .editMessageReplyMarkup(config.groups.orders, replyTo.message_id, {
          reply_markup: new InlineKeyboard().text("ارسال شد", "disabled"),
        })
        .catch(() => undefined);
    }
  });
}
