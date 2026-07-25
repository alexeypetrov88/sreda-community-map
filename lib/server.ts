import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../db";
import { members, places } from "../db/schema";
import {
  HttpError,
  isValidPlaceId,
  validateTelegramInitData,
} from "./security";

export {
  HttpError,
  isIsoDate,
  isValidPlaceId,
  parseJsonObject,
  validateTelegramInitData,
} from "./security";

export type ApprovedMember = typeof members.$inferSelect;

type RuntimeEnv = {
  BOT_TOKEN?: string;
  SREDA_ADMIN_IDS?: string;
  SREDA_ADMIN_USERNAMES?: string;
  SREDA_APP_URL?: string;
  SREDA_JOIN_CODE?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  GEOCODER_URL?: string;
  GEOCODER_CONTACT?: string;
};

export function runtimeConfig() {
  return env as unknown as RuntimeEnv;
}

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

export function privateJson(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) {
    headers.set(key, value);
  }
  return Response.json(body, { ...init, headers });
}

export function routeError(error: unknown) {
  if (error instanceof HttpError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  console.error("Request failed", error);
  return privateJson({ error: "Request failed" }, { status: 500 });
}

export function configuredAppUrl(request: Request) {
  const configured = runtimeConfig().SREDA_APP_URL;
  if (!configured) {
    throw new HttpError("SREDA_APP_URL is not configured", 503);
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new HttpError("SREDA_APP_URL is invalid", 503);
  }
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    throw new HttpError("SREDA_APP_URL must use HTTPS", 503);
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";

  // Refuse a configuration that accidentally points back at another host in
  // local previews, while production always uses the explicit trusted value.
  if (url.hostname === "localhost" && new URL(request.url).hostname !== "localhost") {
    throw new HttpError("SREDA_APP_URL is invalid for this deployment", 503);
  }
  return url.toString();
}

export async function consumeRateLimit(
  scope: string,
  subject: string | number,
  limit: number,
  windowSeconds: number,
) {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / windowSeconds);
  const expiresAt = (window + 1) * windowSeconds;
  const id = `${scope}:${subject}:${window}`;
  const row = await getD1()
    .prepare(
      `INSERT INTO rate_limit_counters (id, count, expires_at)
       VALUES (?1, 1, ?2)
       ON CONFLICT(id) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(id, expiresAt)
    .first<{ count: number }>();

  if (now % 128 === 0) {
    try {
      await getD1()
        .prepare("DELETE FROM rate_limit_counters WHERE expires_at < ?1")
        .bind(now - windowSeconds)
        .run();
    } catch (error) {
      console.error("Rate-limit cleanup failed", error);
    }
  }

  return {
    allowed: Boolean(row && row.count <= limit),
    retryAfter: Math.max(1, expiresAt - now),
  };
}

export async function enforceMemberRateLimit(
  telegramId: number,
  scope: string,
  limit: number,
  windowSeconds: number,
) {
  const result = await consumeRateLimit(scope, telegramId, limit, windowSeconds);
  if (result.allowed) return null;
  return privateJson(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: { "retry-after": String(result.retryAfter) },
    },
  );
}

export async function requireApprovedMember(request: Request) {
  const botToken = runtimeConfig().BOT_TOKEN;
  if (!botToken) {
    return {
      error: privateJson({ error: "Bot is not configured" }, { status: 503 }),
    };
  }

  const initData = request.headers.get("x-telegram-init-data") ?? "";
  let telegramUser;
  try {
    telegramUser = await validateTelegramInitData(initData, botToken);
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        error: privateJson({ error: error.message }, { status: error.status }),
      };
    }
    return {
      error: privateJson({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  try {
    const db = getDb();
    const [member] = await db
      .select()
      .from(members)
      .where(
        and(
          eq(members.telegramId, telegramUser.id),
          eq(members.status, "approved"),
        ),
      )
      .limit(1);

    if (!member) {
      return {
        error: privateJson(
          { error: "Membership approval is required" },
          { status: 403 },
        ),
      };
    }

    const rateLimit = await enforceMemberRateLimit(
      member.telegramId,
      "api",
      120,
      60,
    );
    if (rateLimit) return { error: rateLimit };
    return { db, member, telegramUser };
  } catch (error) {
    console.error("Authorization backend failed", error);
    return {
      error: privateJson(
        { error: "Membership service is temporarily unavailable" },
        { status: 503 },
      ),
    };
  }
}

export async function resolveCanonicalPlace(
  db: ReturnType<typeof getDb>,
  placeId: unknown,
) {
  if (!isValidPlaceId(placeId)) return null;
  const [place] = await db
    .select()
    .from(places)
    .where(eq(places.id, placeId))
    .limit(1);
  return place ?? null;
}

export function publicPlace(place: typeof places.$inferSelect) {
  return {
    placeId: place.id,
    city: place.city,
    country: place.country,
    countryCode: place.countryCode,
  };
}
