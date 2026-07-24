import { db } from "./index.js";

export interface TradeLink {
  id: number;
  user_id: number;
  trade_link: string;
  personaname: string | null;
  profileurl: string | null;
  created_at: string;
  updated_at: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO trade_links (user_id, trade_link, personaname, profileurl)
  VALUES (@userId, @tradeLink, @personaname, @profileurl)
  ON CONFLICT (user_id) DO UPDATE SET
    trade_link = excluded.trade_link,
    personaname = excluded.personaname,
    profileurl = excluded.profileurl,
    updated_at = datetime('now')
`);

const selectStmt = db.prepare("SELECT * FROM trade_links WHERE user_id = @userId");

export function saveTradeLink(
  userId: number,
  tradeLink: string,
  personaname: string | null,
  profileurl: string | null,
): void {
  upsertStmt.run({ userId, tradeLink, personaname, profileurl });
}

export function getTradeLink(userId: number): TradeLink | undefined {
  return selectStmt.get({ userId }) as TradeLink | undefined;
}
