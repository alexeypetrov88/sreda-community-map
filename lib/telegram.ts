import { runtimeConfig } from "./server";
import { normalizeTelegramUsername } from "./security";

type TelegramButton =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } };

export type TelegramMessageReference = {
  message_id: number;
  chat: { id: number };
};

export function adminIds() {
  return new Set(
    (runtimeConfig().SREDA_ADMIN_IDS ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isSafeInteger),
  );
}

export function adminUsernames() {
  return new Set(
    (runtimeConfig().SREDA_ADMIN_USERNAMES ?? "")
      .split(",")
      .map(normalizeTelegramUsername)
      .filter((value): value is string => Boolean(value)),
  );
}

export async function telegramApi<Result = unknown>(
  method: string,
  payload: Record<string, unknown>,
) {
  const token = runtimeConfig().BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not configured");
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    throw new Error(`Telegram ${method} is temporarily unavailable`);
  }
  let result: { ok: boolean; result?: Result; description?: string };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new Error(`Telegram ${method} returned an invalid response`);
  }
  if (!result.ok) {
    throw new Error(result.description ?? `Telegram ${method} failed`);
  }
  return result.result as Result;
}

export function sendMessage(
  chatId: number,
  text: string,
  keyboard?: TelegramButton[][],
) {
  return telegramApi<TelegramMessageReference>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function removeInlineKeyboard(chatId: number, messageId: number) {
  return telegramApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

export function answerCallbackQuery(id: string, text?: string) {
  return telegramApi("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text } : {}),
  });
}
