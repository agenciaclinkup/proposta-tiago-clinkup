import { after, NextResponse, type NextRequest } from "next/server";
import { getIntegrationToken } from "@/lib/services/integrations";
import { findOrganizationBySlug, getOwnTelegramBot } from "@/lib/services/telegram-bot";
import { handleTelegramMessage } from "@/lib/telegram/handler";
import { deriveBotWebhookSecret, telegramUpdateSchema, verifyWebhookSecret } from "@/lib/telegram/telegram";

export const maxDuration = 120;

const SLUG = /^[a-z0-9-]{3,64}$/;

// Webhook do bot próprio de uma empresa (White-Label/Scale). Tudo fica restrito à empresa dona do slug.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Segredo derivado conferido antes de qualquer consulta: sem ele não dá nem para sondar quais slugs existem.
  let expected: string;
  try {
    expected = deriveBotWebhookSecret(slug);
  } catch {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET não configurado");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const organization = await findOrganizationBySlug(slug);
  const bot = organization ? await getOwnTelegramBot(organization.id) : null;
  if (!organization || !bot) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Payload inválido ou update sem mensagem: 200 para o Telegram não reenviar.
  const parsed = telegramUpdateSchema.safeParse(await request.json().catch(() => null));
  const message = parsed.success ? parsed.data.message : undefined;
  if (!parsed.success || !message) return NextResponse.json({ ok: true });

  const { accessToken } = await getIntegrationToken(organization.id, bot.integrationId);
  after(() =>
    handleTelegramMessage(accessToken, parsed.data.update_id, message, { organizationId: organization.id, botId: bot.botId }),
  );
  return NextResponse.json({ ok: true });
}
