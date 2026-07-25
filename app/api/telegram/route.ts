import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { members } from "../../../db/schema";
import { runtimeConfig } from "../../../lib/server";
import {
  adminIds,
  answerCallbackQuery,
  sendMessage,
} from "../../../lib/telegram";

type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

type TelegramUpdate = {
  message?: {
    chat: { id: number; type: string };
    from?: TelegramUser;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: TelegramUser;
    data?: string;
  };
};

function appButton(appUrl: string) {
  return [[{ text: "Open Sreda map", web_app: { url: appUrl } }]];
}

async function handleStart(user: TelegramUser, appUrl: string) {
  const db = getDb();
  const admins = adminIds();
  const [existing] = await db
    .select()
    .from(members)
    .where(eq(members.telegramId, user.id))
    .limit(1);

  if (admins.has(user.id)) {
    await db
      .insert(members)
      .values({
        telegramId: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        status: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: user.id,
      })
      .onConflictDoUpdate({
        target: members.telegramId,
        set: {
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          status: "approved",
        },
      });
    await sendMessage(user.id, "Welcome to <b>Sreda</b>.", appButton(appUrl));
    return;
  }

  if (existing?.status === "approved") {
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
  if (existing?.status === "pending") {
    await sendMessage(
      user.id,
      "Your request is waiting for an admin to approve it.",
    );
    return;
  }

  await db
    .insert(members)
    .values({
      telegramId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      status: "pending",
    })
    .onConflictDoUpdate({
      target: members.telegramId,
      set: {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        status: "pending",
        requestedAt: new Date().toISOString(),
      },
    });

  const label = [
    user.first_name,
    user.last_name,
    user.username ? `(@${user.username})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  await Promise.all(
    [...admins].map((adminId) =>
      sendMessage(adminId, `<b>New Sreda request</b>\n${label}`, [
        [
          { text: "Approve", callback_data: `approve:${user.id}` },
          { text: "Reject", callback_data: `reject:${user.id}` },
        ],
      ]),
    ),
  );
  await sendMessage(user.id, "Your request was sent to the Sreda admins.");
}

async function handleApproval(
  callbackId: string,
  admin: TelegramUser,
  data: string,
  appUrl: string,
) {
  if (!adminIds().has(admin.id)) {
    await answerCallbackQuery(callbackId, "Admins only");
    return;
  }
  const [action, rawTarget] = data.split(":");
  const targetId = Number(rawTarget);
  if (
    !["approve", "reject"].includes(action) ||
    !Number.isSafeInteger(targetId)
  ) {
    await answerCallbackQuery(callbackId, "Invalid request");
    return;
  }

  const db = getDb();
  const [target] = await db
    .select()
    .from(members)
    .where(eq(members.telegramId, targetId))
    .limit(1);
  if (!target) {
    await answerCallbackQuery(callbackId, "Request not found");
    return;
  }

  if (action === "approve") {
    await db
      .update(members)
      .set({
        status: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: admin.id,
      })
      .where(eq(members.telegramId, targetId));
    await Promise.all([
      answerCallbackQuery(callbackId, "Approved"),
      sendMessage(
        targetId,
        "You’re approved. Welcome to <b>Sreda</b>.",
        appButton(appUrl),
      ),
    ]);
  } else {
    await db
      .update(members)
      .set({ status: "rejected", approvedAt: null, approvedBy: admin.id })
      .where(eq(members.telegramId, targetId));
    await Promise.all([
      answerCallbackQuery(callbackId, "Rejected"),
      sendMessage(targetId, "Your Sreda request was not approved."),
    ]);
  }
}

export async function GET() {
  return Response.json({ ok: true, service: "sreda-telegram-webhook" });
}

export async function POST(request: Request) {
  const secret = runtimeConfig().TELEGRAM_WEBHOOK_SECRET;
  if (
    !secret ||
    request.headers.get("x-telegram-bot-api-secret-token") !== secret
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  const update = (await request.json()) as TelegramUpdate;
  const appUrl = new URL("/", request.url).toString();

  try {
    if (
      update.message?.chat.type === "private" &&
      update.message.from &&
      update.message.text?.startsWith("/start")
    ) {
      await handleStart(update.message.from, appUrl);
    } else if (
      update.callback_query?.data &&
      /^(approve|reject):\d+$/.test(update.callback_query.data)
    ) {
      await handleApproval(
        update.callback_query.id,
        update.callback_query.from,
        update.callback_query.data,
        appUrl,
      );
    } else if (update.message?.from && update.message.chat.type === "private") {
      await handleStart(update.message.from, appUrl);
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Telegram update failed", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
