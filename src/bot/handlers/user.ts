import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { fetchSteamProfile, parseTradeLink } from "../../api/steam.js";
import { config } from "../../config.js";
import { getOrder, saveOrder } from "../../db/orders.js";
import { getTradeLink, saveTradeLink } from "../../db/tradeLinks.js";
import { upsertUser } from "../../db/users.js";
import { getVerificationStatus } from "../../db/verifications.js";
import { logger } from "../../logger.js";
import { registerAdminReplyTarget } from "../../redis/adminReplyMap.js";
import {
  clearFlowState,
  getFlowState,
  setFlowState,
  type TicketCategory,
} from "../../redis/conversationState.js";
import { getTicketThread, setTicketThread } from "../../redis/ticketThreads.js";
import { getCurrentOrderMessage, getStoreStatusMessage } from "../../utils/businessHours.js";
import { bold, escapeHtml } from "../../utils/html.js";
import { formatOrderMessage, type ItemType } from "../../utils/orderMessage.js";
import { validateOrderNumber } from "../../utils/validators.js";
import { verificationMenuButton, verificationOrderLabel } from "../../utils/verificationLabel.js";

const MAIN_MENU_TEXT = "برای شروع، از منوی زیر استفاده کنید.";
const ITEM_SELECTION_TEXT = "نوع آیتم خریداری شده را انتخاب کنید:";
const TRADE_LINK_PROMPT = "ترید لینک خود را ارسال کنید:";
const TRADE_LINK_URL = "https://steamcommunity.com/my/tradeoffers/privacy";
const TRADE_LINK_HELP_TEXT = `راهنمای ترید لینک:

برای دریافت لینک ترید، از دکمه "دریافت ترید لینک" استفاده کنید.

پس از ارسال، ترید لینک شما ذخیره می‌شود و در دریافت‌های بعدی می‌توانید از دکمه "استفاده از ترید لینک ذخیره شده" استفاده کنید.

با هر بار ارسال ترید لینک جدید، ترید لینک ذخیره شده قبلی به‌روزرسانی خواهد شد.`;
const ORDER_HELP_TEXT = `راهنمای دریافت سفارش:

شماره سفارش 5 رقمی پس از خرید موفق در صفحه پرداخت سایت نمایش داده می‌شود و به شماره موبایل ثبت‌شده پیامک خواهد شد.`;
const TICKET_CATEGORY_PROMPT = "موضوع تیکت خود را انتخاب کنید:";
const TICKET_REPLY_PROMPT = "برای جواب پیام خود را ارسال کنید";
const TICKET_SENT_ALERT = "با موفقیت ارسال شد منتظر جواب بمانید";

const ORDER_NUMBER_ERROR: Record<"empty" | "wrong_length" | "no_zero_prefix", string> = {
  empty: "شماره سفارش نمی‌تواند خالی باشد.",
  wrong_length: "شماره سفارش باید 5 رقم باشد.",
  no_zero_prefix: "شماره سفارش باید با 0 شروع شود.",
};

const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  receive_order: "مشکلات مرتبط در دریافت سفارش",
  order_usage: "مشکلات مرتبط در استفاده از گیفت کارت",
  general: "پشتیبانی و سوالات عمومی",
};

function orderNumberPrompt(itemType: ItemType): string {
  return itemType === "gift_card"
    ? "برای دریافت گیفت کارت خریداری شده شماره سفارش را به طور صحیح ارسال کنید. (مثال 01234)"
    : "برای دریافت کلید TF2 خریداری شده شماره سفارش را به طور صحیح ارسال کنید. (مثال 01234)";
}

function ticketTextPrompt(category: TicketCategory): string {
  return `موضوع انتخابی: ${TICKET_CATEGORY_LABEL[category]}، شرح درخواست خود را به‌طور کامل و در یک پیام ارسال کنید.`;
}

function buildMainMenuKeyboard(verificationStatus: ReturnType<typeof getVerificationStatus>) {
  const verifyBtn = verificationMenuButton(verificationStatus);
  return new InlineKeyboard()
    .text("تایم کاری فروشگاه", "store_working_hours")
    .primary()
    .row()
    .text("ارسال تیکت", "send_ticket")
    .success()
    .text("دریافت سفارش", "receive_order")
    .success()
    .row()
    .text(verifyBtn.text, verifyBtn.callbackData)
    .success();
}

function buildBackToMainKeyboard() {
  return new InlineKeyboard().text("منوی اصلی", "back_to_main").success();
}

function buildItemSelectionKeyboard() {
  return new InlineKeyboard()
    .text("کلید TF2", "select_item_tf2_key")
    .primary()
    .text("گیفت کارت", "select_item_gift_card")
    .primary()
    .row()
    .text("بازگشت", "back_to_main")
    .danger();
}

function buildOrderNumberKeyboard() {
  return new InlineKeyboard()
    .text("راهنما", "show_order_help")
    .row()
    .text("بازگشت", "back_to_item_selection")
    .danger();
}

function buildTradeLinkKeyboard(hasSavedLink: boolean) {
  const kb = new InlineKeyboard()
    .text("راهنما", "show_trade_link_help")
    .row()
    .url("دریافت ترید لینک", TRADE_LINK_URL)
    .row();
  if (hasSavedLink) {
    kb.text("استفاده از ترید لینک ذخیره شده", "use_saved_trade_link").success().row();
  }
  return kb.text("بازگشت", "back_to_order_number").danger();
}

function buildTicketCategoryKeyboard() {
  return new InlineKeyboard()
    .text(TICKET_CATEGORY_LABEL.receive_order, "category_receive_order")
    .row()
    .text(TICKET_CATEGORY_LABEL.order_usage, "category_order_usage")
    .row()
    .text(TICKET_CATEGORY_LABEL.general, "category_support_general")
    .row()
    .text("بازگشت", "back_to_main")
    .danger();
}

function buildTicketTextKeyboard() {
  return new InlineKeyboard().text("بازگشت", "back_to_ticket_category").danger();
}

async function sendMainMenu(ctx: Context, userId: number, edit: boolean): Promise<void> {
  const status = getVerificationStatus(userId);
  const reply_markup = buildMainMenuKeyboard(status);
  if (edit) {
    await ctx.editMessageText(MAIN_MENU_TEXT, { reply_markup });
  } else {
    await ctx.reply(MAIN_MENU_TEXT, { reply_markup });
  }
}

async function sendItemSelection(ctx: Context, edit: boolean): Promise<void> {
  if (edit) {
    await ctx.editMessageText(ITEM_SELECTION_TEXT, { reply_markup: buildItemSelectionKeyboard() });
  } else {
    await ctx.reply(ITEM_SELECTION_TEXT, { reply_markup: buildItemSelectionKeyboard() });
  }
}

/** Shows the trade-link prompt (with saved-link info when present) and records its message id. */
async function sendTradeLinkPrompt(
  ctx: Context,
  userId: number,
  orderNumber: string,
  edit: boolean,
): Promise<void> {
  const saved = getTradeLink(userId);
  let text = TRADE_LINK_PROMPT;
  if (saved) {
    // Plain text, not a Markdown link: personaname is arbitrary Steam-controlled text and could
    // contain "_"/"*"/"["/"]" etc., which would break Markdown entity parsing if embedded in
    // "[name](url)". Telegram auto-links bare URLs even without parse_mode, so the profile link
    // still ends up clickable without needing to escape anything.
    text += `\n\nترید لینک ذخیره شده - ${saved.personaname}\n${saved.profileurl}`;
  }
  const reply_markup = buildTradeLinkKeyboard(Boolean(saved));

  if (edit) {
    await ctx.editMessageText(text, { reply_markup });
    const promptMessageId = ctx.callbackQuery?.message?.message_id;
    await setFlowState(userId, { kind: "order_trade_link_entry", orderNumber, promptMessageId });
  } else {
    const sent = await ctx.reply(text, { reply_markup });
    await setFlowState(userId, {
      kind: "order_trade_link_entry",
      orderNumber,
      promptMessageId: sent.message_id,
    });
  }
}

async function submitOrder(
  ctx: Context,
  userId: number,
  orderNumber: string,
  itemType: ItemType,
  tradeLink?: string,
): Promise<void> {
  saveOrder(userId, orderNumber, itemType);
  logger.info({ userId, orderNumber, itemType }, "Order submitted");

  const verificationStatus = getVerificationStatus(userId);
  const message = formatOrderMessage({
    orderNumber,
    userId,
    username: ctx.from?.username ?? null,
    itemType,
    verificationStatus,
    tradeLink,
  });

  const keyboard = new InlineKeyboard();
  if (verificationStatus !== "approved") {
    keyboard.text("تکمیل احراز هویت", `send_verification_reminder_${userId}_${orderNumber}`).row();
  }
  keyboard
    .text("رد", `reject_order_${userId}_${orderNumber}`)
    .text("تایید", `approve_order_${userId}_${orderNumber}`);

  const sent = await ctx.api.sendMessage(config.groups.orders, message, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  await registerAdminReplyTarget(config.groups.orders, sent.message_id, {
    type: "order",
    userId,
    orderNumber,
    itemType,
  });

  await ctx.reply(getCurrentOrderMessage(), { reply_markup: buildBackToMainKeyboard() });
}

async function finalizeTf2Order(
  ctx: Context,
  userId: number,
  orderNumber: string,
  tradeLink: string,
  personaname: string,
  promptMessageId: number | undefined,
): Promise<void> {
  if (promptMessageId) {
    await ctx.api
      .editMessageReplyMarkup(ctx.chat!.id, promptMessageId, {
        reply_markup: new InlineKeyboard().text(
          `ترید لینک ارسالی ${personaname}`,
          "show_submitted_trade_link",
        ),
      })
      .catch(() => undefined);
  }
  await clearFlowState(userId);
  await submitOrder(ctx, userId, orderNumber, "tf2_key", tradeLink);
}

async function handleOrderNumberInput(
  ctx: Context & { message: { text: string } },
  itemType: ItemType,
  promptMessageId: number | undefined,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const validation = validateOrderNumber(ctx.message.text);
  if (!validation.ok) {
    await ctx.reply(ORDER_NUMBER_ERROR[validation.reason]);
    return;
  }
  const orderNumber = validation.value;

  if (getOrder(userId, orderNumber)) {
    await ctx.reply("سفارش شما قبلا ثبت شده است.");
    return;
  }

  if (promptMessageId) {
    await ctx.api
      .editMessageReplyMarkup(ctx.chat!.id, promptMessageId, {
        reply_markup: new InlineKeyboard().text(
          `شماره سفارش ارسالی ${orderNumber}`,
          `show_submitted_order_${orderNumber}`,
        ),
      })
      .catch(() => undefined);
  }

  if (itemType === "gift_card") {
    await clearFlowState(userId);
    await submitOrder(ctx, userId, orderNumber, "gift_card");
    return;
  }

  await sendTradeLinkPrompt(ctx, userId, orderNumber, false);
}

async function handleTradeLinkInput(
  ctx: Context & { message: { text: string } },
  orderNumber: string,
  promptMessageId: number | undefined,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const tradeLink = ctx.message.text.trim();
  if (!tradeLink) {
    await ctx.reply("لینک ترید وارد شده نامعتبر است.");
    return;
  }

  const parsed = parseTradeLink(tradeLink);
  if (!parsed) {
    await ctx.reply("لینک ترید ارسالی نادرست است، مجددا ارسال کنید.");
    return;
  }

  const profile = await fetchSteamProfile(parsed.steamId64);
  if (!profile) {
    await ctx.reply("لینک ترید ارسالی نادرست است، مجددا ارسال کنید.");
    return;
  }

  saveTradeLink(userId, tradeLink, profile.personaname, profile.profileurl);
  await finalizeTf2Order(ctx, userId, orderNumber, tradeLink, profile.personaname, promptMessageId);
}

async function handleTicketTextInput(
  ctx: Context & { message: { text: string } },
  category: TicketCategory,
  promptMessageId: number | undefined,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await clearFlowState(userId);

  const usernameDisplay = ctx.from?.username ? `@${escapeHtml(ctx.from.username)}` : "No Username";
  const message = [
    `🎟️ ${bold("تیکت جدید")}`,
    `📜 ${bold("موضوع")} : ${TICKET_CATEGORY_LABEL[category]}`,
    `👤 ${bold("اطلاعات کاربر")} : ${userId} - ${usernameDisplay}`,
    `⭐️ ${bold("احراز هویت")} : ${verificationOrderLabel(getVerificationStatus(userId))}`,
    "",
    escapeHtml(ctx.message.text),
  ].join("\n");

  const sent = await ctx.api.sendMessage(config.groups.tickets, message, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("برای ارسال پیام ریپلای کنید", "disabled"),
  });
  await registerAdminReplyTarget(config.groups.tickets, sent.message_id, {
    type: "ticket",
    userId,
  });
  await setTicketThread(userId, sent.message_id);
  logger.info({ userId, category }, "Ticket submitted");

  if (promptMessageId) {
    await ctx.api
      .editMessageReplyMarkup(ctx.chat!.id, promptMessageId, {
        reply_markup: new InlineKeyboard().text("تیکت ارسال شد", "ticket_sent_success"),
      })
      .catch(() => undefined);
  }

  const confirmation = await ctx.reply(TICKET_SENT_ALERT);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await ctx.api.deleteMessage(ctx.chat!.id, confirmation.message_id).catch(() => undefined);
}

async function handleTicketReplyInput(
  ctx: Context & { message: { text: string } },
  ticketMessageId: number,
  adminReply: string,
  promptMessageId: number | undefined,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const forwarded = await ctx.api.sendMessage(
      config.groups.tickets,
      `🎟️ ${bold("جواب تیکت")}\n👤 ${bold("اطلاعات کاربر")} : ${userId}\n\n${escapeHtml(ctx.message.text)}`,
      {
        parse_mode: "HTML",
        reply_parameters: { message_id: ticketMessageId },
        reply_markup: new InlineKeyboard().text("برای ارسال پیام ریپلای کنید", "disabled"),
      },
    );
    // Admins naturally reply to whichever message is latest in the thread, not just the
    // original ticket — register this forward too so that reply also routes back correctly.
    await registerAdminReplyTarget(config.groups.tickets, forwarded.message_id, {
      type: "ticket",
      userId,
    });
  } catch {
    await ctx.reply("خطا در ارسال پاسخ.");
    return;
  }

  if (promptMessageId) {
    await ctx.api
      .editMessageText(ctx.chat!.id, promptMessageId, `جواب تیکت شما\n\n${adminReply}`, {
        reply_markup: new InlineKeyboard().text("ارسال مجدد", "send_again_reply"),
      })
      .catch(() => undefined);
  }

  await setFlowState(userId, { kind: "ticket_reply_sent", ticketMessageId, adminReply });

  const confirmation = await ctx.reply(TICKET_SENT_ALERT);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await ctx.api.deleteMessage(ctx.chat!.id, confirmation.message_id).catch(() => undefined);
}

export function setupUserHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    upsertUser(userId, ctx.from?.username ?? null);
    await sendMainMenu(ctx, userId, false);
  });

  bot.command("receive", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    upsertUser(userId, ctx.from?.username ?? null);
    await sendItemSelection(ctx, false);
  });

  bot.callbackQuery(["back_to_main", "show_main_menu"], async (ctx) => {
    const userId = ctx.from.id;
    await clearFlowState(userId);
    await ctx.answerCallbackQuery();
    await sendMainMenu(ctx, userId, true);
  });

  bot.callbackQuery("store_working_hours", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(getStoreStatusMessage(), { reply_markup: buildBackToMainKeyboard() });
  });

  bot.callbackQuery("verification_pending", async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "احراز هویت شما درحال بررسی میباشد. منتظر بمانید.",
      show_alert: true,
    });
  });

  bot.callbackQuery("verification_already_verified", async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "احراز هویت شما تایید شده و لازم به انجام مجدد مراحل نیست.",
      show_alert: true,
    });
  });

  // --- Order flow ---

  bot.callbackQuery("receive_order", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendItemSelection(ctx, true);
  });

  bot.callbackQuery("back_to_item_selection", async (ctx) => {
    await clearFlowState(ctx.from.id);
    await ctx.answerCallbackQuery();
    await sendItemSelection(ctx, true);
  });

  bot.callbackQuery(/^select_item_(tf2_key|gift_card)$/, async (ctx) => {
    const itemType = ctx.match[1] as ItemType;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(orderNumberPrompt(itemType), {
      reply_markup: buildOrderNumberKeyboard(),
    });
    await setFlowState(ctx.from.id, {
      kind: "order_number_entry",
      itemType,
      promptMessageId: ctx.callbackQuery.message?.message_id,
    });
  });

  bot.callbackQuery("show_order_help", async (ctx) => {
    const flow = await getFlowState(ctx.from.id);
    if (!flow || flow.kind !== "order_number_entry") {
      await ctx.answerCallbackQuery({ text: "عملیات نامعتبر", show_alert: true });
      return;
    }
    // Clear the flow state while help is shown so a message typed here isn't silently
    // accepted as an order number — the user must press back first, then submit.
    await clearFlowState(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ORDER_HELP_TEXT, {
      reply_markup: new InlineKeyboard()
        .text("بازگشت", `back_to_order_input_${flow.itemType}`)
        .danger(),
    });
  });

  bot.callbackQuery(/^back_to_order_input_(tf2_key|gift_card)$/, async (ctx) => {
    const itemType = ctx.match[1] as ItemType;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(orderNumberPrompt(itemType), {
      reply_markup: buildOrderNumberKeyboard(),
    });
    await setFlowState(ctx.from.id, {
      kind: "order_number_entry",
      itemType,
      promptMessageId: ctx.callbackQuery.message?.message_id,
    });
  });

  bot.callbackQuery("back_to_order_number", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(orderNumberPrompt("tf2_key"), {
      reply_markup: buildOrderNumberKeyboard(),
    });
    await setFlowState(ctx.from.id, {
      kind: "order_number_entry",
      itemType: "tf2_key",
      promptMessageId: ctx.callbackQuery.message?.message_id,
    });
  });

  bot.callbackQuery(/^show_submitted_order_(\d{5})$/, async (ctx) => {
    await ctx.answerCallbackQuery({
      text: `شماره سفارش ارسال شده توسط شما ${ctx.match[1]}`,
      show_alert: true,
    });
  });

  bot.callbackQuery("show_trade_link_help", async (ctx) => {
    const flow = await getFlowState(ctx.from.id);
    if (!flow || flow.kind !== "order_trade_link_entry") {
      await ctx.answerCallbackQuery({ text: "عملیات نامعتبر", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(TRADE_LINK_HELP_TEXT, {
      reply_markup: new InlineKeyboard().text("بازگشت", "back_to_trade_link_input").danger(),
    });
  });

  bot.callbackQuery("back_to_trade_link_input", async (ctx) => {
    const userId = ctx.from.id;
    const flow = await getFlowState(userId);
    if (!flow || flow.kind !== "order_trade_link_entry") {
      await ctx.answerCallbackQuery({ text: "عملیات نامعتبر", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await sendTradeLinkPrompt(ctx, userId, flow.orderNumber, true);
  });

  bot.callbackQuery("show_submitted_trade_link", async (ctx) => {
    const saved = getTradeLink(ctx.from.id);
    await ctx.answerCallbackQuery({
      text: saved ? `ترید لینک ارسال شده توسط شما ${saved.personaname}` : "یافت نشد",
      show_alert: true,
    });
  });

  bot.callbackQuery("use_saved_trade_link", async (ctx) => {
    const userId = ctx.from.id;
    const flow = await getFlowState(userId);
    if (!flow || flow.kind !== "order_trade_link_entry") {
      await ctx.answerCallbackQuery();
      return;
    }
    const saved = getTradeLink(userId);
    if (!saved) {
      await ctx.answerCallbackQuery({ text: "ترید لینک ذخیره‌شده‌ای یافت نشد.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await finalizeTf2Order(
      ctx,
      userId,
      flow.orderNumber,
      saved.trade_link,
      saved.personaname ?? "",
      flow.promptMessageId,
    );
  });

  // --- Ticket flow ---

  // From the main menu: the menu message itself turns into the prompt.
  bot.callbackQuery("send_ticket", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(TICKET_CATEGORY_PROMPT, {
      reply_markup: buildTicketCategoryKeyboard(),
    });
  });

  // From an order-delivery message ("ارسال تیکت" under the gift-card codes / TF2 confirmation):
  // send a new message instead of editing, so the delivered codes stay in the chat as the user's
  // own record of the purchase. Only the button is swapped out, to stop a second tap from
  // stacking up another category prompt.
  bot.callbackQuery("create_support_ticket", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(TICKET_CATEGORY_PROMPT, { reply_markup: buildTicketCategoryKeyboard() });
    await ctx
      .editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text("در حال ثبت تیکت", "disabled"),
      })
      .catch(() => undefined);
  });

  bot.callbackQuery("back_to_ticket_category", async (ctx) => {
    await clearFlowState(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(TICKET_CATEGORY_PROMPT, {
      reply_markup: buildTicketCategoryKeyboard(),
    });
  });

  bot.callbackQuery(/^category_(receive_order|order_usage|support_general)$/, async (ctx) => {
    const raw = ctx.match[1];
    const category: TicketCategory =
      raw === "support_general" ? "general" : (raw as TicketCategory);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ticketTextPrompt(category), {
      reply_markup: buildTicketTextKeyboard(),
    });
    await setFlowState(ctx.from.id, {
      kind: "ticket_text_entry",
      category,
      promptMessageId: ctx.callbackQuery.message?.message_id,
    });
  });

  bot.callbackQuery("ticket_sent_success", async (ctx) => {
    await ctx.answerCallbackQuery({ text: TICKET_SENT_ALERT, show_alert: true });
  });

  bot.callbackQuery("reply_sent_success", async (ctx) => {
    await ctx.answerCallbackQuery({ text: TICKET_SENT_ALERT, show_alert: true });
  });

  bot.callbackQuery("reply_to_ticket", async (ctx) => {
    const userId = ctx.from.id;
    const ticketMessageId = await getTicketThread(userId);
    if (!ticketMessageId) {
      await ctx.answerCallbackQuery({ text: "تیکت فعالی یافت نشد.", show_alert: true });
      return;
    }
    const adminReply = ctx.callbackQuery.message?.text ?? "";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(TICKET_REPLY_PROMPT, {
      reply_markup: new InlineKeyboard().text("بازگشت", "back_from_ticket_reply").danger(),
    });
    await setFlowState(userId, {
      kind: "ticket_reply_entry",
      ticketMessageId,
      adminReply,
      promptMessageId: ctx.callbackQuery.message?.message_id,
    });
  });

  bot.callbackQuery("send_again_reply", async (ctx) => {
    const userId = ctx.from.id;
    const flow = await getFlowState(userId);
    if (!flow || flow.kind !== "ticket_reply_sent") {
      await ctx.answerCallbackQuery({
        text: 'برای پاسخ، از دکمه "جواب به تیکت" در آخرین پیام استفاده کنید.',
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(TICKET_REPLY_PROMPT, {
      reply_markup: new InlineKeyboard().text("بازگشت", "back_from_send_again").danger(),
    });
    await setFlowState(userId, {
      kind: "ticket_reply_entry",
      ticketMessageId: flow.ticketMessageId,
      adminReply: flow.adminReply,
      promptMessageId: ctx.callbackQuery.message?.message_id,
    });
  });

  bot.callbackQuery("back_from_ticket_reply", async (ctx) => {
    const userId = ctx.from.id;
    const flow = await getFlowState(userId);
    if (!flow || flow.kind !== "ticket_reply_entry") {
      await ctx.answerCallbackQuery({ text: "عملیات نامعتبر", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`جواب تیکت شما\n\n${flow.adminReply}`, {
      reply_markup: new InlineKeyboard().text("جواب به تیکت", "reply_to_ticket"),
    });
    await clearFlowState(userId);
  });

  bot.callbackQuery("back_from_send_again", async (ctx) => {
    const userId = ctx.from.id;
    const flow = await getFlowState(userId);
    if (!flow || flow.kind !== "ticket_reply_entry") {
      await ctx.answerCallbackQuery({ text: "عملیات نامعتبر", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`جواب تیکت شما\n\n${flow.adminReply}`, {
      reply_markup: new InlineKeyboard().text("ارسال مجدد", "send_again_reply"),
    });
    await setFlowState(userId, {
      kind: "ticket_reply_sent",
      ticketMessageId: flow.ticketMessageId,
      adminReply: flow.adminReply,
    });
  });

  // --- Free-text dispatcher, keyed by the user's current flow state ---

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from.id;
    const flow = await getFlowState(userId);
    if (!flow) return next();

    switch (flow.kind) {
      case "order_number_entry":
        return handleOrderNumberInput(ctx, flow.itemType, flow.promptMessageId);
      case "order_trade_link_entry":
        return handleTradeLinkInput(ctx, flow.orderNumber, flow.promptMessageId);
      case "ticket_text_entry":
        return handleTicketTextInput(ctx, flow.category, flow.promptMessageId);
      case "ticket_reply_entry":
        return handleTicketReplyInput(
          ctx,
          flow.ticketMessageId,
          flow.adminReply,
          flow.promptMessageId,
        );
      default:
        return next();
    }
  });

  // --- Final catch-all: private-chat text that no handler above claimed (e.g. the sender's
  // flow state expired from Redis after a long pause). Group chats are left untouched so this
  // never intrudes on staff conversation in the orders/tickets/verification groups. ---
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const isAdmin = ctx.from.id === config.adminId;
    // Admins get a "back" button into their own panel, which keeps the danger styling every
    // other back/cancel button uses; users get the green main-menu button.
    const keyboard = new InlineKeyboard().text(
      isAdmin ? "بازگشت" : "منوی اصلی",
      isAdmin ? "back_to_admin_menu" : "back_to_main",
    );
    await ctx.reply("خطا در پردازش! از منوی زیر ادامه بدید", {
      reply_markup: isAdmin ? keyboard.danger() : keyboard.success(),
    });
  });
}
