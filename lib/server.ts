import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { members } from "../db/schema";

export type ApprovedMember = typeof members.$inferSelect;

type RuntimeEnv = {
  BOT_TOKEN?: string;
  SREDA_ADMIN_IDS?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  GEOCODER_URL?: string;
  GEOCODER_CONTACT?: string;
};

export function runtimeConfig() {
  return env as unknown as RuntimeEnv;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") ?? "";
  const authDate = Number(params.get("auth_date"));
  const userJson = params.get("user");

  if (!receivedHash || !Number.isFinite(authDate) || !userJson) {
    throw new Error("Invalid Telegram session");
  }

  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > maxAgeSeconds) {
    throw new Error("Telegram session has expired");
  }

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    encoder.encode(botToken),
  );
  const calculatedHash = hex(
    await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey(
        "raw",
        secretKey,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
      encoder.encode(dataCheckString),
    ),
  );

  if (!constantTimeEqual(calculatedHash, receivedHash)) {
    throw new Error("Invalid Telegram signature");
  }

  const user = JSON.parse(userJson) as {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  if (!Number.isSafeInteger(user.id)) {
    throw new Error("Invalid Telegram user");
  }
  return user;
}

export async function requireApprovedMember(request: Request) {
  const botToken = runtimeConfig().BOT_TOKEN;
  if (!botToken) {
    return { error: Response.json({ error: "Bot is not configured" }, { status: 503 }) };
  }

  const initData = request.headers.get("x-telegram-init-data") ?? "";
  try {
    const telegramUser = await validateTelegramInitData(initData, botToken);
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
        error: Response.json(
          { error: "Membership approval is required" },
          { status: 403 },
        ),
      };
    }
    return { db, member, telegramUser };
  } catch (error) {
    return {
      error: Response.json(
        { error: error instanceof Error ? error.message : "Unauthorized" },
        { status: 401 },
      ),
    };
  }
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

export function cleanPlace(payload: Record<string, unknown>) {
  const city = typeof payload.city === "string" ? payload.city.trim() : "";
  const country =
    typeof payload.country === "string" ? payload.country.trim() : "";
  const countryCode =
    typeof payload.countryCode === "string"
      ? payload.countryCode.trim().toUpperCase()
      : "";
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  if (
    !city ||
    !country ||
    !/^[A-Z]{2}$/.test(countryCode) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { city, country, countryCode, lat, lng };
}
