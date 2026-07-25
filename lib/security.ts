export const TELEGRAM_SESSION_MAX_AGE_SECONDS = 15 * 60;
export const MAX_JSON_BODY_BYTES = 8 * 1024;
export const MAX_DATE_RANGE_DAYS = 366;

export type TelegramIdentity = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function cleanTelegramText(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!normalized || normalized.length > maximum) return undefined;
  return normalized;
}

export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: {
    maxAgeSeconds?: number;
    nowSeconds?: number;
  } = {},
) {
  if (!initData || initData.length > 8_192) {
    throw new HttpError("Invalid Telegram session", 401);
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") ?? "";
  const authDate = Number(params.get("auth_date"));
  const userJson = params.get("user");

  if (
    !/^[a-f0-9]{64}$/i.test(receivedHash) ||
    !Number.isSafeInteger(authDate) ||
    !userJson
  ) {
    throw new HttpError("Invalid Telegram session", 401);
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds =
    options.maxAgeSeconds ?? TELEGRAM_SESSION_MAX_AGE_SECONDS;
  const age = nowSeconds - authDate;
  if (age < -60 || age > maxAgeSeconds) {
    throw new HttpError("Telegram session has expired", 401);
  }

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();
  const webAppKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKey = await crypto.subtle.sign(
    "HMAC",
    webAppKey,
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

  if (!constantTimeEqual(calculatedHash, receivedHash.toLowerCase())) {
    throw new HttpError("Invalid Telegram signature", 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(userJson);
  } catch {
    throw new HttpError("Invalid Telegram user", 401);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new HttpError("Invalid Telegram user", 401);
  }

  const user = parsed as Record<string, unknown>;
  const firstName = cleanTelegramText(user.first_name, 100);
  const lastName = cleanTelegramText(user.last_name, 100);
  const username = cleanTelegramText(user.username, 64);
  if (!Number.isSafeInteger(user.id) || !firstName) {
    throw new HttpError("Invalid Telegram user", 401);
  }

  return {
    id: user.id as number,
    first_name: firstName,
    ...(lastName ? { last_name: lastName } : {}),
    ...(username ? { username } : {}),
  } satisfies TelegramIdentity;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

export function dateRangeDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).valueOf();
  const end = new Date(`${to}T00:00:00Z`).valueOf();
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function isValidPlaceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

export async function parseJsonObject(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_JSON_BODY_BYTES
  ) {
    throw new HttpError("Request body is too large", 413);
  }

  const body = await request.text();
  if (!body || new TextEncoder().encode(body).byteLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(
      body ? "Request body is too large" : "Request body is required",
      body ? 413 : 400,
    );
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
}

export function escapeTelegramHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export function hasValidJoinCode(provided: string, configured?: string) {
  return Boolean(
    configured &&
      /^[A-Za-z0-9_-]{16,64}$/.test(configured) &&
      constantTimeEqual(provided, configured),
  );
}

export function parseJoinDecisionCallback(value: string) {
  const match = /^j:([ar]):([A-Za-z0-9_-]{16,32})$/.exec(value);
  if (!match) return null;
  return {
    action: match[1] === "a" ? ("approve" as const) : ("reject" as const),
    requestId: match[2],
  };
}

export function parseMemberActionCallback(value: string) {
  const match = /^m:([ru]):(\d{1,16})$/.exec(value);
  if (!match) return null;
  const telegramId = Number(match[2]);
  if (!Number.isSafeInteger(telegramId)) return null;
  return {
    action: match[1] === "r" ? ("revoke" as const) : ("restore" as const),
    telegramId,
  };
}

export function joinDisposition(status?: string) {
  if (status === "approved") return "welcome" as const;
  if (status === "pending") return "waiting" as const;
  if (["rejected", "revoked", "blocked"].includes(status ?? "")) {
    return "inactive" as const;
  }
  return "new-request" as const;
}

export function nextMemberStatus(
  current: string,
  action: "revoke" | "restore",
) {
  if (action === "revoke" && current === "approved") return "revoked" as const;
  if (
    action === "restore" &&
    ["rejected", "revoked", "blocked"].includes(current)
  ) {
    return "approved" as const;
  }
  return null;
}
