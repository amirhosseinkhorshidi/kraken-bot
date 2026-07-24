import { config } from "../config.js";

function parseMinutes(hhmm: string): number {
  const [hoursStr, minutesStr] = hhmm.split(":");
  return Number(hoursStr ?? "0") * 60 + Number(minutesStr ?? "0");
}

function currentTehranMinutes(): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * BUSINESS_HOURS_END may be "24:00" (1440 minutes), which a real clock never
 * reaches — that's intentional and means "open until midnight rollover".
 */
export function isWithinBusinessHours(): boolean {
  const nowMinutes = currentTehranMinutes();
  const startMinutes = parseMinutes(config.businessHours.start);
  const endMinutes = parseMinutes(config.businessHours.end);
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

function formatHumanTime(hhmm: string): string {
  const [hoursStr, minutesStr = "00"] = hhmm.split(":");
  const hours = Number(hoursStr);
  return minutesStr === "00" ? `${hours}` : `${hours}:${minutesStr}`;
}

/** Message appended after a successful order submission — copy is derived from config, not hardcoded. */
export function getCurrentOrderMessage(): string {
  if (isWithinBusinessHours()) {
    return "سفارش شما ثبت شد، منتظر ارسال بمانید.";
  }

  const start = formatHumanTime(config.businessHours.start);
  return `سفارش شما ثبت شد.\nتوجه داشته باشید که فروشگاه در حال حاضر خارج از ساعت کاری است و از ساعت ${start} پاسخگوی شما خواهیم بود.`;
}

/** Generic "is the store open right now" status text (for the "ساعت کاری" menu button). */
export function getStoreStatusMessage(): string {
  const start = formatHumanTime(config.businessHours.start);
  const end = formatHumanTime(config.businessHours.end);
  return isWithinBusinessHours()
    ? `فروشگاه هم‌اکنون در ساعت کاری قرار دارد و آماده پاسخگویی است.\nساعت کاری فروشگاه از ساعت ${start} تا ${end} می‌باشد.`
    : `فروشگاه هم‌اکنون خارج از ساعت کاری است.\nساعت کاری فروشگاه از ساعت ${start} تا ${end} می‌باشد.`;
}
