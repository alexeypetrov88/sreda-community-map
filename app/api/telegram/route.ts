import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import {
  auditEvents,
  members,
  membershipRequests,
  telegramUpdates,
} from "../../../db/schema";
import {
  configuredAppUrl,
  consumeRateLimit,
  HttpError,
  parseJsonObject,
  privateJson,
  routeError,
  runtimeConfig,
} from "../../../lib/server";
import {
  constantTimeEqual,
  escapeTelegramHtml,
  hasValidJoinCode,
  joinDisposition,
  nextMemberStatus,
  parseJoinDecisionCallback,
  parseMemberActionCallback,
  type TelegramIdentity,
} from "../../../lib/security";
import {
  adminIds,
  adminUsernames,
  answerCallbackQuery,
  sendMessage,
} from "../../../lib/telegram";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    chat: { id: number; type: string };
    from?: TelegramIdentity;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: TelegramIdentity;
    data?: string;
  };
};

const JOIN_REQUEST_DAYS = 7;

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function appButton(appUrl: string) {
  return [[{ text: "Open Sreda Community Map", web_app: { url: appUrl } }]];
}

function adminMenu(appUrl: string) {
  return [
    ...appButton(appUrl),
    [
      { text: "Pending requests", callback_data: "admin:pending" },
      { text: "Active members", callback_data: "admin:members:0" },
    ],
    [{ text: "Inactive members", callback_data: "admin:inactive:0" }],
  ];
}

function displayLabel(user: TelegramIdentity) {
  return [
    escapeTelegramHtml(user.first_name),
    user.last_name ? escapeTelegramHtml(user.last_name) : "",
    user.username ? `(@${escapeTelegramHtml(user.username)})` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function isAdmin(user: TelegramIdentity) {
  if (adminIds().has(user.id)) return true;

  const db = getDb();
  const [pinned] = await db
    .select({ telegramId: members.telegramId })
    .from(members)
    .where(
      and(
        eq(members.telegramId, user.id),
        eq(members.status, "approved"),
        eq(members.approvedBy, user.id),
      ),
    )
    .limit(1);
  if (pinned) return true;

  const username = user.username?.toLocaleLowerCase();
  if (!username || !adminUsernames().has(username)) return false;

  // A username is used only to bootstrap the first staging admin. Once claimed,
  // the immutable numeric identity stored in the member row is authoritative.
  const [existingAdmin] = await db
    .select({ telegramId: members.telegramId })
    .from(members)
    .where(
      and(
        eq(members.status, "approved"),
        eq(members.telegramId, members.approvedBy),
      ),
    )
    .limit(1);
  return !existingAdmin;
}

async function isAdminTelegramId(telegramId: number) {
  if (adminIds().has(telegramId)) return true;
  const [pinned] = await getDb()
    .select({ telegramId: members.telegramId })
    .from(members)
    .where(
      and(
        eq(members.telegramId, telegramId),
        eq(members.status, "approved"),
        eq(members.approvedBy, telegramId),
      ),
    )
    .limit(1);
  return Boolean(pinned);
}

async function adminChatIds() {
  const pinned = await getDb()
    .select({ telegramId: members.telegramId })
    .from(members)
    .where(
      and(
        eq(members.status, "approved"),
        eq(members.telegramId, members.approvedBy),
      ),
    );
  return new Set([
    ...adminIds(),
    ...pinned.map((member) => member.telegramId),
  ]);
}

async function settleMessages(messages: Array<Promise<unknown>>) {
  const results = await Promise.allSettled(messages);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Telegram delivery failed", result.reason);
    }
  }
  return results.some((result) => result.status === "fulfilled");
}

async function recordAudit(
  type: string,
  actorTelegramId: number | null,
  targetTelegramId: number | null,
) {
  try {
    await getDb().insert(auditEvents).values({
      id: crypto.randomUUID(),
      type,
      actorTelegramId,
      targetTelegramId,
    });
  } catch (error) {
    console.error("Audit event could not be recorded", error);
  }
}

async function sendAdminHome(admin: TelegramIdentity, appUrl: string) {
  const db = getDb();
  await db
    .insert(members)
    .values({
      telegramId: admin.id,
      username: admin.username,
      firstName: admin.first_name,
      lastName: admin.last_name,
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: admin.id,
      statusChangedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: members.telegramId,
      set: {
        username: admin.username,
        firstName: admin.first_name,
        lastName: admin.last_name,
        status: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: admin.id,
        statusChangedAt: new Date().toISOString(),
      },
    });
  await db
    .update(membershipRequests)
    .set({
      status: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy: admin.id,
    })
    .where(
      and(
        eq(membershipRequests.telegramId, admin.id),
        eq(membershipRequests.status, "pending"),
      ),
    );
  await sendMessage(
    admin.id,
    "Welcome to <b>Sreda</b>. Use the buttons below to manage membership.",
    adminMenu(appUrl),
  );
}

async function notifyAdmins(
  user: TelegramIdentity,
  requestId: string,
  appUrl: string,
) {
  const admins = [...(await adminChatIds())];
  if (!admins.length) return false;
  const text = `<b>New Sreda request</b>\n${displayLabel(user)}`;
  return settleMessages(
    admins.map((adminId) =>
      sendMessage(adminId, text, [
        [
          { text: "Approve", callback_data: `j:a:${requestId}` },
          { text: "Reject", callback_data: `j:r:${requestId}` },
        ],
        ...appButton(appUrl),
      ]),
    ),
  );
}

async function handleStart(
  user: TelegramIdentity,
  startPayload: string,
  appUrl: string,
) {
  const limiter = await consumeRateLimit("telegram-start", user.id, 6, 3_600);
  if (!limiter.allowed) {
    await sendMessage(
      user.id,
      "Too many requests. Please use your Sreda invitation link again later.",
    );
    return;
  }

  if (await isAdmin(user)) {
    await sendAdminHome(user, appUrl);
    return;
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(members)
    .where(eq(members.telegramId, user.id))
    .limit(1);

  const disposition = joinDisposition(existing?.status);
  if (disposition === "welcome" && existing) {
    await db
      .update(members)
      .set({
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      })
      .where(eq(members.telegramId, user.id));
    await sendMessage(user.id, "Welcome back to <b>Sreda</b>.", appButton(appUrl));
    return;
  }

  if (disposition === "waiting") {
    await sendMessage(
      user.id,
      "Your request is waiting for a Sreda admin to approve it.",
    );
    return;
  }

  if (disposition === "inactive") {
    await sendMessage(
      user.id,
      "Your Sreda membership is not active. Please contact a community admin.",
    );
    return;
  }

  if (!hasValidJoinCode(startPayload, runtimeConfig().SREDA_JOIN_CODE)) {
    await sendMessage(
      user.id,
      "This is a closed community bot. Join through the private invitation link shared inside Sreda.",
    );
    return;
  }

  const now = new Date();
  const requestId = randomId();
  const expiresAt = new Date(
    now.valueOf() + JOIN_REQUEST_DAYS * 86_400_000,
  ).toISOString();

  const created = await getD1().batch([
    getD1()
      .prepare(
        `INSERT INTO members (
           telegram_id, username, first_name, last_name, status,
           requested_at, status_changed_at
         ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5)
         ON CONFLICT(telegram_id) DO NOTHING`,
      )
      .bind(
        user.id,
        user.username ?? null,
        user.first_name,
        user.last_name ?? null,
        now.toISOString(),
      ),
    getD1()
      .prepare(
        `INSERT INTO membership_requests (id, telegram_id, expires_at)
         SELECT ?1, ?2, ?3
         WHERE EXISTS (
           SELECT 1 FROM members
           WHERE telegram_id = ?2 AND status = 'pending'
         )
         AND NOT EXISTS (
           SELECT 1 FROM membership_requests
           WHERE telegram_id = ?2 AND status = 'pending'
         )`,
      )
      .bind(requestId, user.id, expiresAt),
  ]);
  if (created[1].meta.changes !== 1) {
    await sendMessage(
      user.id,
      "Your request is already waiting for a Sreda admin to approve it.",
    );
    return;
  }
  await recordAudit("membership_requested", user.id, user.id);

  const notified = await notifyAdmins(user, requestId, appUrl);
  await sendMessage(
    user.id,
    notified
      ? "Your request was sent to the Sreda admins."
      : "Your request is saved. An admin can review it from the membership menu.",
  );
}

async function handleJoinDecision(
  callbackId: string,
  admin: TelegramIdentity,
  data: string,
  appUrl: string,
) {
  if (!(await isAdmin(admin))) {
    await answerCallbackQuery(callbackId, "Admins only");
    return;
  }
  const parsed = parseJoinDecisionCallback(data);
  if (!parsed) {
    await answerCallbackQuery(callbackId, "Invalid request");
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const [requestRecord] = await db
    .select()
    .from(membershipRequests)
    .where(eq(membershipRequests.id, parsed.requestId))
    .limit(1);
  if (
    !requestRecord ||
    requestRecord.status !== "pending" ||
    requestRecord.expiresAt < now
  ) {
    if (requestRecord?.status === "pending") {
      await db
        .update(membershipRequests)
        .set({ status: "expired", decidedAt: now })
        .where(eq(membershipRequests.id, parsed.requestId));
    }
    await answerCallbackQuery(callbackId, "This request is no longer active");
    return;
  }

  const memberStatus = parsed.action === "approve" ? "approved" : "rejected";
  const requestStatus = parsed.action === "approve" ? "approved" : "rejected";
  const batchResults = await getD1().batch([
    getD1()
      .prepare(
        `UPDATE membership_requests
         SET status = ?1, decided_at = ?2, decided_by = ?3
         WHERE id = ?4 AND status = 'pending' AND expires_at >= ?2`,
      )
      .bind(requestStatus, now, admin.id, parsed.requestId),
    getD1()
      .prepare(
        `UPDATE members
         SET status = ?1,
             approved_at = CASE WHEN ?1 = 'approved' THEN ?2 ELSE NULL END,
             approved_by = ?3,
             status_changed_at = ?2
         WHERE telegram_id = ?4 AND status = 'pending'`,
      )
      .bind(memberStatus, now, admin.id, requestRecord.telegramId),
  ]);

  if (
    batchResults[0].meta.changes !== 1 ||
    batchResults[1].meta.changes !== 1
  ) {
    await answerCallbackQuery(callbackId, "This request was already handled");
    return;
  }

  await recordAudit(
    parsed.action === "approve" ? "membership_approved" : "membership_rejected",
    admin.id,
    requestRecord.telegramId,
  );
  await settleMessages([
    answerCallbackQuery(
      callbackId,
      parsed.action === "approve" ? "Approved" : "Rejected",
    ),
    parsed.action === "approve"
      ? sendMessage(
          requestRecord.telegramId,
          "You’re approved. Welcome to <b>Sreda</b>.",
          appButton(appUrl),
        )
      : sendMessage(
          requestRecord.telegramId,
          "Your Sreda request was not approved. Contact an admin if this was unexpected.",
        ),
  ]);
}

async function sendPendingRequests(adminId: number) {
  const db = getDb();
  const pending = await db
    .select()
    .from(membershipRequests)
    .where(
      and(
        eq(membershipRequests.status, "pending"),
        gte(membershipRequests.expiresAt, new Date().toISOString()),
      ),
    )
    .orderBy(asc(membershipRequests.createdAt))
    .limit(20);

  if (!pending.length) {
    await sendMessage(adminId, "There are no pending membership requests.");
    return;
  }

  const messages: Array<Promise<unknown>> = [];
  for (const requestRecord of pending) {
    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.telegramId, requestRecord.telegramId))
      .limit(1);
    if (!member) continue;
    const label = [
      escapeTelegramHtml(member.firstName),
      member.lastName ? escapeTelegramHtml(member.lastName) : "",
      member.username ? `(@${escapeTelegramHtml(member.username)})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    messages.push(
      sendMessage(adminId, `<b>Pending request</b>\n${label}`, [
        [
          { text: "Approve", callback_data: `j:a:${requestRecord.id}` },
          { text: "Reject", callback_data: `j:r:${requestRecord.id}` },
        ],
      ]),
    );
  }
  await settleMessages(messages);
}

async function sendMemberPage(
  adminId: number,
  kind: "members" | "inactive",
  offset: number,
) {
  const statuses =
    kind === "members"
      ? (["approved"] as const)
      : (["rejected", "revoked", "blocked"] as const);
  const db = getDb();
  const rows = await db
    .select()
    .from(members)
    .where(inArray(members.status, statuses))
    .orderBy(asc(members.firstName), asc(members.telegramId))
    .limit(10)
    .offset(offset);
  const visibleRows: typeof rows = [];
  for (const member of rows) {
    if (!(await isAdminTelegramId(member.telegramId))) visibleRows.push(member);
  }

  if (!visibleRows.length) {
    await sendMessage(
      adminId,
      offset ? "There are no more members on this list." : "This list is empty.",
    );
    return;
  }

  await settleMessages(
    visibleRows.map((member) => {
      const label = [
        escapeTelegramHtml(member.firstName),
        member.lastName ? escapeTelegramHtml(member.lastName) : "",
        member.username ? `(@${escapeTelegramHtml(member.username)})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const active = member.status === "approved";
      return sendMessage(
        adminId,
        `<b>${label}</b>\nStatus: ${escapeTelegramHtml(member.status)}`,
        [[
          {
            text: active ? "Revoke & clear locations" : "Restore access",
            callback_data: `m:${active ? "r" : "u"}:${member.telegramId}`,
          },
        ]],
      );
    }),
  );
  if (rows.length === 10) {
    await sendMessage(adminId, "More members are available.", [[
      {
        text: "Next page",
        callback_data: `admin:${kind}:${offset + 10}`,
      },
    ]]);
  }
}

async function handleMemberAction(
  callbackId: string,
  admin: TelegramIdentity,
  data: string,
) {
  if (!(await isAdmin(admin))) {
    await answerCallbackQuery(callbackId, "Admins only");
    return;
  }
  const parsed = parseMemberActionCallback(data);
  if (!parsed || (await isAdminTelegramId(parsed.telegramId))) {
    await answerCallbackQuery(callbackId, "Invalid member action");
    return;
  }
  const [target] = await getDb()
    .select({ status: members.status })
    .from(members)
    .where(eq(members.telegramId, parsed.telegramId))
    .limit(1);
  const nextStatus = target
    ? nextMemberStatus(target.status, parsed.action)
    : null;
  if (!target || !nextStatus) {
    await answerCallbackQuery(callbackId, "Member status already changed");
    return;
  }
  const now = new Date().toISOString();
  let changed = false;
  if (parsed.action === "revoke") {
    const result = await getD1().batch([
      getD1()
        .prepare(
          `UPDATE members
           SET status = 'revoked', status_changed_at = ?1,
               approved_at = NULL, approved_by = ?2, home_place_id = NULL
           WHERE telegram_id = ?3 AND status = 'approved'`,
        )
        .bind(now, admin.id, parsed.telegramId),
      getD1()
        .prepare(
          `DELETE FROM plans
           WHERE telegram_id = ?1
             AND EXISTS (
               SELECT 1 FROM members
               WHERE telegram_id = ?1 AND status = 'revoked'
             )`,
        )
        .bind(parsed.telegramId),
    ]);
    changed = result[0].meta.changes === 1;
  } else {
    const restored = await getDb()
      .update(members)
      .set({
        status: nextStatus,
        statusChangedAt: now,
        approvedAt: now,
        approvedBy: admin.id,
      })
      .where(
        and(
          eq(members.telegramId, parsed.telegramId),
          eq(members.status, target.status),
        ),
      )
      .returning({ telegramId: members.telegramId });
    changed = restored.length === 1;
  }
  if (!changed) {
    await answerCallbackQuery(callbackId, "Member status already changed");
    return;
  }

  await recordAudit(
    parsed.action === "revoke" ? "membership_revoked" : "membership_restored",
    admin.id,
    parsed.telegramId,
  );
  await settleMessages([
    answerCallbackQuery(
      callbackId,
      parsed.action === "revoke" ? "Access revoked" : "Access restored",
    ),
    sendMessage(
      parsed.telegramId,
      parsed.action === "revoke"
        ? "Your Sreda access has been revoked and your saved locations were removed. Contact a community admin if this was unexpected."
        : "Your Sreda access has been restored. Open the bot to continue.",
    ),
  ]);
}

async function handleAdminCallback(
  callbackId: string,
  admin: TelegramIdentity,
  data: string,
  appUrl: string,
) {
  if (!(await isAdmin(admin))) {
    await answerCallbackQuery(callbackId, "Admins only");
    return;
  }
  if (data === "admin:menu") {
    await settleMessages([
      answerCallbackQuery(callbackId),
      sendMessage(admin.id, "<b>Sreda membership</b>", adminMenu(appUrl)),
    ]);
    return;
  }
  if (data === "admin:pending") {
    await answerCallbackQuery(callbackId);
    await sendPendingRequests(admin.id);
    return;
  }
  const page = /^admin:(members|inactive):(\d{1,4})$/.exec(data);
  if (!page) {
    await answerCallbackQuery(callbackId, "Invalid admin action");
    return;
  }
  await answerCallbackQuery(callbackId);
  await sendMemberPage(
    admin.id,
    page[1] as "members" | "inactive",
    Math.min(Number(page[2]), 1_000),
  );
}

export async function GET() {
  return privateJson({ ok: true, service: "sreda-telegram-webhook" });
}

export async function POST(request: Request) {
  const configuredSecret = runtimeConfig().TELEGRAM_WEBHOOK_SECRET;
  const providedSecret =
    request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (
    !configuredSecret ||
    configuredSecret.length < 32 ||
    !constantTimeEqual(providedSecret, configuredSecret)
  ) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    const update = (await parseJsonObject(request)) as TelegramUpdate;
    if (!Number.isSafeInteger(update.update_id)) {
      throw new HttpError("Invalid Telegram update", 400);
    }
    const [seen] = await getDb()
      .select({ updateId: telegramUpdates.updateId })
      .from(telegramUpdates)
      .where(eq(telegramUpdates.updateId, update.update_id as number))
      .limit(1);
    if (seen) return privateJson({ ok: true, duplicate: true });

    const appUrl = configuredAppUrl(request);
    const message = update.message;
    const callback = update.callback_query;

    if (message?.chat.type === "private" && message.from && message.text) {
      const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,128}))?$/.exec(
        message.text.trim(),
      );
      if (start) {
        await handleStart(message.from, start[1] ?? "", appUrl);
      } else if (
        /^\/admin(?:@\w+)?$/.test(message.text.trim()) &&
        (await isAdmin(message.from))
      ) {
        await sendAdminHome(message.from, appUrl);
      }
    } else if (callback?.data) {
      if (callback.data.startsWith("j:")) {
        await handleJoinDecision(
          callback.id,
          callback.from,
          callback.data,
          appUrl,
        );
      } else if (callback.data.startsWith("m:")) {
        await handleMemberAction(callback.id, callback.from, callback.data);
      } else if (callback.data.startsWith("admin:")) {
        await handleAdminCallback(
          callback.id,
          callback.from,
          callback.data,
          appUrl,
        );
      }
    }

    await getDb()
      .insert(telegramUpdates)
      .values({ updateId: update.update_id as number })
      .onConflictDoNothing();
    return privateJson({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
