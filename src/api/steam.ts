import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";

const TRADE_LINK_PREFIX = "https://steamcommunity.com/tradeoffer/new/";

// SteamID64s exceed Number.MAX_SAFE_INTEGER, so the offset math needs BigInt.
const STEAM_ID64_BASE = 76561197960265728n;

export interface ParsedTradeLink {
  partnerId: number;
  steamId64: string;
}

/** Validates a Steam trade-offer link and derives the sender's SteamID64. */
export function parseTradeLink(raw: string): ParsedTradeLink | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(TRADE_LINK_PREFIX)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const partnerParam = url.searchParams.get("partner");
  if (!partnerParam || !/^\d+$/.test(partnerParam)) return null;

  const partnerId = Number(partnerParam);
  const steamId64 = (STEAM_ID64_BASE + BigInt(partnerId)).toString();
  return { partnerId, steamId64 };
}

const PlayerSummaryResponseSchema = z.object({
  response: z.object({
    players: z.array(
      z.object({
        personaname: z.string(),
        profileurl: z.string(),
      }),
    ),
  }),
});

export interface SteamProfile {
  personaname: string;
  profileurl: string;
}

export async function fetchSteamProfile(steamId64: string): Promise<SteamProfile | null> {
  const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  url.searchParams.set("key", config.steamApiKey);
  url.searchParams.set("steamids", steamId64);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.error({ status: res.status }, "Steam API request failed");
      return null;
    }
    const parsed = PlayerSummaryResponseSchema.parse(await res.json());
    return parsed.response.players[0] ?? null;
  } catch (error) {
    logger.error({ err: error }, "Steam API request threw");
    return null;
  }
}
