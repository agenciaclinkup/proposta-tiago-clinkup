import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Só os campos que usamos; o resto do update é descartado pelo Zod.
export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: z.object({ id: z.number().int(), first_name: z.string().optional(), username: z.string().optional() }).optional(),
      text: z.string().max(4096).optional(),
      voice: z.object({ file_id: z.string(), duration: z.number().optional() }).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export type TelegramCommand = { type: "start" } | { type: "link"; code: string | null } | { type: "message"; text: string };

export function parseCommand(text: string): TelegramCommand {
  const trimmed = text.trim();
  const [head, ...rest] = trimmed.split(/\s+/);
  const command = head.toLowerCase().split("@")[0];
  // Deep link t.me/<bot>?start=CODIGO chega como "/start CODIGO": vínculo com um toque.
  if (command === "/start" && rest.length === 0) return { type: "start" };
  if (command === "/vincular" || command === "/start") {
    const code = (rest[0] ?? "").toUpperCase();
    return { type: "link", code: /^[A-Z0-9]{8}$/.test(code) ? code : null };
  }
  return { type: "message", text: trimmed };
}

// Header X-Telegram-Bot-Api-Secret-Token comparado em tempo constante.
export function verifyWebhookSecret(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const TELEGRAM_LIMIT = 4000;

export function splitMessage(text: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += TELEGRAM_LIMIT) parts.push(text.slice(i, i + TELEGRAM_LIMIT));
  return parts.length > 0 ? parts : [""];
}

// Texto puro (sem parse_mode): evita erro de formatação com caracteres especiais vindos do modelo.
export async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  for (const part of splitMessage(text)) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: part }),
    });
    if (!response.ok) console.error("[telegram] falha ao enviar mensagem", response.status);
  }
}
