import { runtimeConfig } from "./server";

type TelegramButton =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } };

export function adminIds() {
  return new Set(
    (runtimeConfig().SREDA_ADMIN_IDS ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isSafeInteger),
  );
}

export async function telegramApi(
  method: string,
  payload: Record<string, unknown>,
) {
  const token = runtimeConfig().BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as {
    ok: boolean;
    description?: string;
  };
  if (!result.ok) {
    throw new Error(result.description ?? `Telegram ${method} failed`);
  }
  return result;
}

export function sendMessage(
  chatId: number,
  text: string,
  keyboard?: TelegramButton[][],
) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function answerCallbackQuery(id: string, text?: string) {
  return telegramApi("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text } : {}),
  });
}
