import assert from "node:assert/strict";
import test from "node:test";
import {
  constantTimeEqual,
  dateRangeDays,
  escapeTelegramHtml,
  hasValidJoinCode,
  isIsoDate,
  isValidPlaceId,
  joinDisposition,
  nextMemberStatus,
  normalizeDisplayName,
  normalizeTelegramUsername,
  parseJoinDecisionCallback,
  parseJsonObject,
  parseMemberActionCallback,
  validateTelegramInitData,
} from "../lib/security.ts";

const BOT_TOKEN = "123456789:test-token-used-only-by-automated-tests";
const TEST_NOW = 1_800_000_000;

function toHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signedInitData(
  user: Record<string, unknown>,
  authDate = TEST_NOW,
) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "synthetic-query",
    user: JSON.stringify(user),
  });
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
  const secret = await crypto.subtle.sign(
    "HMAC",
    webAppKey,
    encoder.encode(BOT_TOKEN),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    encoder.encode(dataCheckString),
  );
  params.set("hash", toHex(signature));
  return params.toString();
}

test("accepts authentic, fresh Telegram initData", async () => {
  const initData = await signedInitData({
    id: 123_456,
    first_name: " Alice ",
    last_name: "<Member>",
    username: "alice",
  });
  const user = await validateTelegramInitData(initData, BOT_TOKEN, {
    nowSeconds: TEST_NOW + 30,
  });
  assert.deepEqual(user, {
    id: 123_456,
    first_name: "Alice",
    last_name: "<Member>",
    username: "alice",
  });
});

test("rejects altered, expired, future, and malformed Telegram sessions", async () => {
  const valid = await signedInitData({ id: 42, first_name: "Member" });
  const altered = new URLSearchParams(valid);
  altered.set("user", JSON.stringify({ id: 99, first_name: "Attacker" }));
  await assert.rejects(
    validateTelegramInitData(altered.toString(), BOT_TOKEN, {
      nowSeconds: TEST_NOW,
    }),
    /signature/i,
  );

  const expired = await signedInitData(
    { id: 42, first_name: "Member" },
    TEST_NOW - 901,
  );
  await assert.rejects(
    validateTelegramInitData(expired, BOT_TOKEN, { nowSeconds: TEST_NOW }),
    /expired/i,
  );

  const future = await signedInitData(
    { id: 42, first_name: "Member" },
    TEST_NOW + 61,
  );
  await assert.rejects(
    validateTelegramInitData(future, BOT_TOKEN, { nowSeconds: TEST_NOW }),
    /expired/i,
  );

  const invalidUser = await signedInitData({ id: "42", first_name: "Member" });
  await assert.rejects(
    validateTelegramInitData(invalidUser, BOT_TOKEN, {
      nowSeconds: TEST_NOW,
    }),
    /user/i,
  );
});

test("join code comparison fails closed", () => {
  const configured = "a-strong-private-code-123";
  assert.equal(hasValidJoinCode(configured, configured), true);
  assert.equal(hasValidJoinCode("wrong", configured), false);
  assert.equal(hasValidJoinCode("", configured), false);
  assert.equal(hasValidJoinCode("short", "short"), false);
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("same", "diff"), false);
});

test("Telegram admin usernames are normalized and strictly bounded", () => {
  assert.equal(normalizeTelegramUsername("@Example_Admin"), "example_admin");
  assert.equal(
    normalizeTelegramUsername(" Community_Moderator "),
    "community_moderator",
  );
  assert.equal(normalizeTelegramUsername("four"), undefined);
  assert.equal(normalizeTelegramUsername("invalid-name"), undefined);
  assert.equal(normalizeTelegramUsername(undefined), undefined);
});

test("member display names are normalized and bounded", () => {
  assert.equal(normalizeDisplayName("  Alex   Smith  "), "Alex Smith");
  assert.equal(normalizeDisplayName("Renée 🌍"), "Renée 🌍");
  assert.equal(normalizeDisplayName("Line\nBreak"), undefined);
  assert.equal(normalizeDisplayName(" "), undefined);
  assert.equal(normalizeDisplayName("x".repeat(101)), undefined);
  assert.equal(normalizeDisplayName(undefined), undefined);
});

test("membership state machine prevents self-reentry and stale actions", () => {
  assert.equal(joinDisposition(undefined), "new-request");
  assert.equal(joinDisposition("pending"), "waiting");
  assert.equal(joinDisposition("approved"), "welcome");
  assert.equal(joinDisposition("rejected"), "inactive");
  assert.equal(joinDisposition("revoked"), "inactive");
  assert.equal(joinDisposition("blocked"), "inactive");

  assert.equal(nextMemberStatus("approved", "revoke"), "revoked");
  assert.equal(nextMemberStatus("revoked", "restore"), "approved");
  assert.equal(nextMemberStatus("rejected", "restore"), "approved");
  assert.equal(nextMemberStatus("pending", "restore"), null);
  assert.equal(nextMemberStatus("revoked", "revoke"), null);
});

test("only bounded callback formats are accepted", () => {
  assert.deepEqual(parseJoinDecisionCallback("j:a:0123456789abcdef"), {
    action: "approve",
    requestId: "0123456789abcdef",
  });
  assert.deepEqual(parseJoinDecisionCallback("j:r:0123456789abcdef"), {
    action: "reject",
    requestId: "0123456789abcdef",
  });
  assert.equal(parseJoinDecisionCallback("approve:123"), null);
  assert.equal(parseJoinDecisionCallback("j:a:short"), null);

  assert.deepEqual(parseMemberActionCallback("m:r:123456"), {
    action: "revoke",
    telegramId: 123_456,
  });
  assert.equal(parseMemberActionCallback("m:r:-1"), null);
  assert.equal(parseMemberActionCallback("m:u:not-a-number"), null);
});

test("Telegram profile text is escaped before HTML messages", () => {
  assert.equal(
    escapeTelegramHtml(`<b>A & "B"</b>`),
    "&lt;b&gt;A &amp; &quot;B&quot;&lt;/b&gt;",
  );
});

test("date and canonical place validation reject malformed input", () => {
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2027-02-29"), false);
  assert.equal(isIsoDate("2026-2-01"), false);
  assert.equal(dateRangeDays("2026-01-01", "2026-12-31"), 365);
  assert.equal(isValidPlaceId("0123456789abcdef"), true);
  assert.equal(isValidPlaceId("../../exact-coordinate"), false);
  assert.equal(isValidPlaceId("short"), false);
});

test("JSON parsing enforces object shape and an 8 KiB limit", async () => {
  assert.deepEqual(
    await parseJsonObject(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ placeId: "0123456789abcdef" }),
      }),
    ),
    { placeId: "0123456789abcdef" },
  );
  await assert.rejects(
    parseJsonObject(
      new Request("https://example.test", {
        method: "POST",
        body: "[1,2,3]",
      }),
    ),
    /valid JSON/i,
  );
  await assert.rejects(
    parseJsonObject(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ value: "x".repeat(9_000) }),
      }),
    ),
    /too large/i,
  );
});
