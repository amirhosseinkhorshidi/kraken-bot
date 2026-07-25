/**
 * Escapes the three characters Telegram's HTML parse mode treats as markup. Every piece of
 * user- or Steam-controlled text interpolated into a `parse_mode: "HTML"` message must go
 * through this, otherwise a stray "<" makes the whole sendMessage call fail with a 400.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Bold label used for the leading title/field names on group-facing messages. */
export function bold(text: string): string {
  return `<b>${text}</b>`;
}
