import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { sendOtpCall } from "../../api/otpProvider.js";
import { config } from "../../config.js";
import {
  approveVerification,
  deleteVerification,
  getVerificationStatus,
  saveVerification,
} from "../../db/verifications.js";
import { logger } from "../../logger.js";
import { registerAdminReplyTarget } from "../../redis/adminReplyMap.js";
import { clearFlowState } from "../../redis/conversationState.js";
import {
  canRequestOtp,
  clearOtpCode,
  generateOtpCode,
  type OtpDenial,
  recordOtpRequest,
  storeOtpCode,
  verifyOtpCode,
} from "../../redis/otp.js";
import {
  clearVerificationState,
  getVerificationDraft,
  getVerificationStep,
  setVerificationStep,
  updateVerificationDraft,
} from "../../redis/verificationState.js";
import { bold, escapeHtml } from "../../utils/html.js";
import {
  validateOtpCode,
  validatePersianName,
  validatePhoneNumber,
} from "../../utils/validators.js";

const VERIFICATION_INTRO_TEXT =
  "برای تکمیل احراز هویت، 3 مرحله را یک‌بار برای همیشه به درستی انجام دهید. " +
  "پس از تایید کارشناسان، در خریدهای بعدی نیازی به تکرار این مراحل نیست.";

const VERIFICATION_GUIDE_TEXT = `راهنمای احراز هویت:

این فرآیند شامل 3 مرحله است که فقط یک‌بار انجام می‌شود:

مرحله اول - ارسال نام و نام خانوادگی:
نام و نام خانوادگی خود را دقیقا مطابق کارت بانکی و به‌صورت فارسی وارد کنید.

مرحله دوم - تایید شماره موبایل:
شماره موبایلی که در سایت با آن خرید کرده‌اید را وارد کنید. با این شماره تماس گرفته شده و کد 4 رقمی به شما اعلام می‌شود. کد دریافتی را در ربات وارد کنید.

مرحله سوم - ارسال تصویر کارت:
تصویر واضح از کارت بانکی استفاده شده در خرید را ارسال کنید. می‌توانید CVV2، تاریخ انقضا و 8 رقم وسط شماره کارت را بپوشانید.

پس از تکمیل مراحل، کارشناسان درخواست شما را بررسی کرده و نتیجه را اعلام می‌کنند.`;

const FULL_NAME_PROMPT =
  "نام و نام خانوادگی خود را به‌صورت صحیح و فارسی ارسال کنید (مثال: امیرحسین خورشیدی).";
const PHONE_PROMPT = "شماره موبایلی که در سایت با آن خرید کرده اید را ارسال کنید. (شروع با 09)";
const OTP_SENT_TEXT =
  "تا 20 ثانیه دیگر با شماره موبایل ارسالی شما تماس گرفته می‌شود و کد 4 رقمی اعلام می‌گردد. " +
  "کد را به‌صورت صحیح وارد کنید (مثال: 1234).";
const PHOTO_PROMPT =
  "برای تکمیل احراز هویت، تصویر کارت بانکی استفاده‌شده برای خرید را ارسال کنید. " +
  "می‌توانید اطلاعات حساس کارت (مانند CVV2، تاریخ انقضا و هشت رقم میانی شماره کارت) را مخفی کنید. " +
  "[برای مشاهده عکس نمونه کلیک کنید](https://t.me/krakenGSRuels/32)";
const PHOTO_STEP_WRONG_INPUT_TEXT = "فقط تصویر کارت بانکی ارسال کنید، ارسال فایل مجاز نمی‌باشد.";

function verificationIntroKeyboard() {
  return new InlineKeyboard()
    .text("راهنما", "help_verification")
    .row()
    .text("شروع احراز هویت", "start_verification_process")
    .success()
    .row()
    .text("بازگشت", "back_to_main")
    .danger();
}

async function showVerificationIntro(ctx: Context, edit: boolean): Promise<void> {
  const reply_markup = verificationIntroKeyboard();
  if (edit) {
    await ctx.editMessageText(VERIFICATION_INTRO_TEXT, { reply_markup });
  } else {
    await ctx.reply(VERIFICATION_INTRO_TEXT, { reply_markup });
  }
}

function otpDenialMessage(denial: OtpDenial): string {
  switch (denial.reason) {
    case "cooldown":
      return `${denial.retryAfterSeconds} ثانیه تا درخواست بعدی صبر کنید`;
    case "hourly_limit":
      return "محدودیت 60 دقیقه‌ای بیش از 3 درخواست، برای رفع مشکل تیکت ثبت کنید.";
    case "daily_limit":
      return "محدودیت روزانه بیش از 5 درخواست، برای رفع مشکل تیکت ثبت کنید.";
  }
}

/** Generates + stores + sends a fresh OTP code, without touching prompt messages. */
async function issueOtp(userId: number, phone: string): Promise<void> {
  const code = generateOtpCode();
  await storeOtpCode(userId, code);
  await recordOtpRequest(userId);
  await sendOtpCall(phone, code);
}

/** First-ever OTP send for this verification attempt: also does the edit-prompt-to-confirmation-button dance. */
async function sendOtp(ctx: Context, userId: number, phone: string): Promise<void> {
  await issueOtp(userId, phone);
  await setVerificationStep(userId, "otp_verification");

  const draft = await getVerificationDraft(userId);
  if (draft.messageId) {
    await ctx.api
      .editMessageText(ctx.chat!.id, draft.messageId, PHONE_PROMPT, {
        reply_markup: new InlineKeyboard().text("شماره تلفن ارسال شد.", "show_submitted_phone"),
      })
      .catch(() => undefined);
  }

  const sent = await ctx.reply(OTP_SENT_TEXT, {
    reply_markup: new InlineKeyboard()
      .text("تماس مجدد", "resend_otp")
      .row()
      .text("انصراف", "back_to_verification_menu")
      .danger(),
  });
  await updateVerificationDraft(userId, { messageId: sent.message_id });
}

async function beginVerification(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const status = getVerificationStatus(userId);
  if (status === "approved") {
    await ctx.answerCallbackQuery({ text: "شما قبلا احراز هویت شده‌اید.", show_alert: true });
    return;
  }
  if (status === "pending") {
    await ctx.answerCallbackQuery({
      text: "احراز هویت شما در حال بررسی میباشد. منتظر بمانید.",
      show_alert: true,
    });
    return;
  }

  await clearFlowState(userId);
  await setVerificationStep(userId, "full_name");
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(FULL_NAME_PROMPT, {
    reply_markup: new InlineKeyboard().text("انصراف", "back_to_verification_menu").danger(),
  });

  const messageId = ctx.callbackQuery?.message?.message_id;
  if (messageId) await updateVerificationDraft(userId, { messageId });
}

async function handleFullName(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const name = validatePersianName(ctx.message!.text!);
  if (!name) {
    await ctx.reply("نام و نام خانوادگی باید فقط شامل حروف فارسی و فاصله باشد.");
    return;
  }
  await updateVerificationDraft(userId, { fullName: name });
  await setVerificationStep(userId, "phone_number");

  const draft = await getVerificationDraft(userId);
  if (draft.messageId) {
    await ctx.api
      .editMessageText(ctx.chat!.id, draft.messageId, FULL_NAME_PROMPT, {
        reply_markup: new InlineKeyboard().text(
          "نام و نام خانوادگی ارسال شد.",
          "show_submitted_name",
        ),
      })
      .catch(() => undefined);
  }

  const sent = await ctx.reply(PHONE_PROMPT, {
    reply_markup: new InlineKeyboard().text("انصراف", "back_to_verification_menu").danger(),
  });
  await updateVerificationDraft(userId, { messageId: sent.message_id });
}

async function handlePhoneNumber(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const phone = validatePhoneNumber(ctx.message!.text!);
  if (!phone) {
    await ctx.reply("شماره تلفن باید 11 رقم و با 09 شروع شود.");
    return;
  }

  await updateVerificationDraft(userId, { phoneNumber: phone });

  const denial = await canRequestOtp(userId);
  if (denial) {
    await ctx.reply(otpDenialMessage(denial));
    return;
  }

  await sendOtp(ctx, userId, phone);
}

async function handleOtpVerification(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const code = validateOtpCode(ctx.message!.text!);
  if (!code) {
    await ctx.reply("کد OTP باید 4 رقم باشد.");
    return;
  }
  const ok = await verifyOtpCode(userId, code);
  if (!ok) {
    await ctx.reply("کد OTP نادرست است.");
    return;
  }
  await clearOtpCode(userId);

  const draft = await getVerificationDraft(userId);
  if (!draft.fullName || !draft.phoneNumber) {
    await ctx.reply("اطلاعات احراز هویت یافت نشد.");
    return;
  }

  await setVerificationStep(userId, "photo_upload");

  if (draft.messageId) {
    await ctx.api
      .editMessageText(ctx.chat!.id, draft.messageId, OTP_SENT_TEXT, {
        reply_markup: new InlineKeyboard().text("کد OTP تایید شد.", "disabled"),
      })
      .catch(() => undefined);

    const sent = await ctx.reply(PHOTO_PROMPT, {
      reply_markup: new InlineKeyboard().text("انصراف", "back_to_verification_menu").danger(),
      parse_mode: "Markdown",
    });
    await updateVerificationDraft(userId, { photoMessageId: sent.message_id });
  } else {
    await ctx.reply("تصویر کارت بانکی خود را ارسال کنید.");
  }
}

async function handlePhotoUpload(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const draft = await getVerificationDraft(userId);
  if (!draft.fullName || !draft.phoneNumber) {
    await clearVerificationState(userId);
    await ctx.reply("اطلاعات احراز هویت یافت نشد.");
    return;
  }

  saveVerification(userId, draft.fullName, draft.phoneNumber);

  const photoSizes = ctx.message!.photo!;
  const largestPhoto = photoSizes[photoSizes.length - 1]!;

  if (draft.photoMessageId) {
    await ctx.api
      .editMessageText(ctx.chat!.id, draft.photoMessageId, PHOTO_PROMPT, {
        reply_markup: new InlineKeyboard().text("عکس احراز هویت ارسال شد.", "disabled"),
        parse_mode: "Markdown",
      })
      .catch(() => undefined);
  }

  await ctx.reply("احراز هویت شما در صف تایید قرار گرفت پس از تایید به شما اطلاع داده میشود.", {
    reply_markup: new InlineKeyboard().text("منوی اصلی", "back_to_main").success(),
  });

  const usernameDisplay = ctx.from?.username ? `@${escapeHtml(ctx.from.username)}` : "No Username";
  const caption = [
    `👤 ${bold("اطلاعات کاربر")} : ${userId} - ${usernameDisplay}`,
    `${bold("نام و نام خانوادگی")} :`,
    escapeHtml(draft.fullName),
    `${bold("شماره تلفن همراه")} :`,
    escapeHtml(draft.phoneNumber),
  ].join("\n");

  const sent = await ctx.api.sendPhoto(config.groups.verification, largestPhoto.file_id, {
    caption,
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("برای ارسال دلیل رد، ریپلای کنید", "disabled")
      .row()
      .text("رد", `reject_verification_${userId}`)
      .text("تایید", `approve_verification_${userId}`),
  });
  await registerAdminReplyTarget(config.groups.verification, sent.message_id, {
    type: "verification",
    userId,
  });
  logger.info({ userId }, "Verification submitted for review");

  await clearVerificationState(userId);
}

/** Called by the admin handlers' generic reply dispatcher when a staff member replies to a
 * verification photo message with a free-text rejection reason. */
export async function rejectVerificationWithReason(
  ctx: Context,
  userId: number,
  verificationMessageId: number,
  reasonText: string,
): Promise<void> {
  deleteVerification(userId);
  logger.info({ userId, reasonText }, "Verification rejected");
  await ctx.api
    .sendMessage(userId, `${bold("احراز هویت شما رد شد")}\nعلت رد: ${escapeHtml(reasonText)}`, {
      parse_mode: "HTML",
    })
    .catch(() => undefined);
  await ctx.api
    .deleteMessage(config.groups.verification, verificationMessageId)
    .catch(() => undefined);
}

export function setupVerificationHandlers(bot: Bot): void {
  bot.callbackQuery("start_verification", async (ctx) => {
    const status = getVerificationStatus(ctx.from.id);
    await clearFlowState(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (status === "approved") {
      await ctx.reply("شما قبلا احراز هویت شده‌اید.");
      return;
    }
    await showVerificationIntro(ctx, true);
  });

  bot.callbackQuery("start_verification_from_reminder", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showVerificationIntro(ctx, false);
  });

  bot.callbackQuery("help_verification", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(VERIFICATION_GUIDE_TEXT, {
      reply_markup: new InlineKeyboard().text("بازگشت", "back_to_verification_menu").danger(),
    });
  });

  bot.callbackQuery("start_verification_process", beginVerification);

  bot.callbackQuery("back_to_verification_menu", async (ctx) => {
    await clearVerificationState(ctx.from.id);
    await ctx.answerCallbackQuery();
    await showVerificationIntro(ctx, true);
  });

  bot.callbackQuery("show_submitted_name", async (ctx) => {
    const draft = await getVerificationDraft(ctx.from.id);
    await ctx.answerCallbackQuery({
      text: draft.fullName ? `نام و نام خانوادگی ارسال شده ${draft.fullName}` : "یافت نشد",
      show_alert: true,
    });
  });

  bot.callbackQuery("show_submitted_phone", async (ctx) => {
    const draft = await getVerificationDraft(ctx.from.id);
    await ctx.answerCallbackQuery({
      text: draft.phoneNumber ? `شماره تلفن ارسال شده ${draft.phoneNumber}` : "یافت نشد",
      show_alert: true,
    });
  });

  bot.callbackQuery("resend_otp", async (ctx) => {
    const userId = ctx.from.id;
    const step = await getVerificationStep(userId);
    if (step !== "otp_verification") {
      await ctx.answerCallbackQuery({ text: "عملیات نامعتبر", show_alert: true });
      return;
    }
    const draft = await getVerificationDraft(userId);
    if (!draft.phoneNumber) {
      await ctx.answerCallbackQuery({ text: "شماره تلفن یافت نشد", show_alert: true });
      return;
    }
    const denial = await canRequestOtp(userId);
    if (denial) {
      await ctx.answerCallbackQuery({ text: otpDenialMessage(denial), show_alert: true });
      return;
    }
    await issueOtp(userId, draft.phoneNumber);
    await ctx.answerCallbackQuery({ text: "کد OTP جدید ارسال شد", show_alert: true });
  });

  // Approve/reject are reachable by any member of the verification staff group
  // (shared-inbox trust model — same as order approve/reject), not just ADMIN_ID.
  bot.callbackQuery(/^approve_verification_(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    approveVerification(userId);
    logger.info({ userId }, "Verification approved");
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("تایید شد", "disabled"),
    });
    await ctx.api
      .sendMessage(userId, "احراز هویت شما تایید شد، خرید های بعدی نیاز به انجام احراز هویت نیست.")
      .catch(() => undefined);
  });

  bot.callbackQuery(/^reject_verification_(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    deleteVerification(userId);
    logger.info({ userId }, "Verification rejected");
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await ctx.api
      .sendMessage(userId, `${bold("احراز هویت شما رد شد")}. مجددا تلاش کنید.`, {
        parse_mode: "HTML",
      })
      .catch(() => undefined);
  });

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from.id;
    const step = await getVerificationStep(userId);
    if (!step) return next();

    switch (step) {
      case "full_name":
        return handleFullName(ctx);
      case "phone_number":
        return handlePhoneNumber(ctx);
      case "otp_verification":
        return handleOtpVerification(ctx);
      case "photo_upload":
        await ctx.reply(PHOTO_STEP_WRONG_INPUT_TEXT);
        return;
      default:
        return next();
    }
  });

  bot.on("message:photo", async (ctx, next) => {
    const step = await getVerificationStep(ctx.from.id);
    if (step !== "photo_upload") return next();
    return handlePhotoUpload(ctx);
  });

  bot.on("message:document", async (ctx, next) => {
    const step = await getVerificationStep(ctx.from.id);
    if (step !== "photo_upload") return next();
    await ctx.reply(PHOTO_STEP_WRONG_INPUT_TEXT);
  });
}
