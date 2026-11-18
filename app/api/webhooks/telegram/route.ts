import { after, NextResponse, type NextRequest } from "next/server";
import { handleTelegramMessage } from "@/lib/telegram/handler";
import { telegramUpdateSchema, verifyWebhookSecret } from "@/lib/telegram/telegram";

export const maxDuration = 120;

// Webhook do bot da plataforma (modo SaaS). Bots White-Label usam /api/webhooks/telegram/[slug] (Fase 3.3c).
export async function POST(request: NextRequest) {
  if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN não configurado");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  // Payload inválido ou update sem mensagem: 200 para o Telegram não reenviar.
  const parsed = telegramUpdateSchema.safeParse(await request.json().catch(() => null));
  const message = parsed.success ? parsed.data.message : undefined;
  if (!parsed.success || !message) return NextResponse.json({ ok: true });

  // Responde já e processa depois: o Hermes pode levar mais que o tempo de espera do Telegram.
  after(() => handleTelegramMessage(botToken, parsed.data.update_id, message));
  return NextResponse.json({ ok: true });
}
