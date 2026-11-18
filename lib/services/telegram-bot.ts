import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callTelegram, deriveBotWebhookSecret } from "@/lib/telegram/telegram";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { getIntegrationToken, saveIntegration } from "./integrations";

type OrgPlan = { plan_id: string; is_white_label: boolean };
type OwnBot = { integrationId: string; botId: string; username: string };

const ADMIN_ONLY = "Apenas proprietários e administradores podem configurar o bot próprio da empresa.";

export function canUseOwnBot(org: OrgPlan): boolean {
  return org.plan_id === "scale" || org.is_white_label;
}

// Usado pela rota /api/webhooks/telegram/[slug] (sem sessão): busca só o id da org pelo slug.
export async function findOrganizationBySlug(slug: string) {
  const { data, error } = await createAdminClient().from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}

export async function getOwnTelegramBot(organizationId: string): Promise<OwnBot | null> {
  const { data, error } = await createAdminClient()
    .from("integrations")
    .select("id, external_account_id, display_name, metadata")
    .eq("organization_id", organizationId)
    .eq("provider", "telegram_bot")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const username = (data.metadata as { username?: string } | null)?.username ?? String(data.display_name ?? "").replace(/^@/, "");
  return { integrationId: data.id, botId: data.external_account_id, username };
}

// Remove o webhook (melhor esforço), a configuração do bot e todos os vínculos de chats feitos por ele.
async function removeBot(organizationId: string, bot: OwnBot) {
  try {
    const { accessToken } = await getIntegrationToken(organizationId, bot.integrationId);
    await callTelegram(accessToken, "deleteWebhook");
  } catch (error) {
    console.error("[telegram-bot] falha ao remover webhook do bot anterior", error);
  }
  const admin = createAdminClient();
  const { error } = await admin.from("integrations").delete().eq("id", bot.integrationId).eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  const { error: linksError } = await admin
    .from("integrations")
    .delete()
    .eq("organization_id", organizationId)
    .eq("provider", "telegram")
    .like("external_account_id", `${bot.botId}:%`);
  if (linksError) throw new Error(linksError.message);
}

export async function connectOwnTelegramBot(
  ctx: Pick<ServiceContext, "organizationId" | "userId" | "role">,
  token: string,
  org: OrgPlan & { slug: string },
): Promise<{ username: string }> {
  if (ctx.role === "member") throw new ServiceError(ADMIN_ONLY);
  if (!canUseOwnBot(org)) {
    throw new ServiceError("O bot próprio está disponível nos planos Scale e White-Label. Conheça os planos na página Planos.");
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl?.startsWith("https://")) {
    console.error("[telegram-bot] NEXT_PUBLIC_SITE_URL precisa ser https para registrar webhook");
    throw new ServiceError("A plataforma ainda não está pronta para bots próprios. Fale com o suporte para concluir a configuração.");
  }

  const me = await callTelegram<{ id: number; is_bot: boolean; username?: string }>(token, "getMe");
  if (!me.ok || !me.result?.is_bot || !me.result.username) {
    throw new ServiceError("Não consegui validar esse token no Telegram. Confira se você copiou o token completo enviado pelo @BotFather.");
  }
  const bot = me.result;

  const previous = await getOwnTelegramBot(ctx.organizationId);
  if (previous && previous.botId !== String(bot.id)) await removeBot(ctx.organizationId, previous);

  const hook = await callTelegram(token, "setWebhook", {
    url: `${siteUrl}/api/webhooks/telegram/${org.slug}`,
    secret_token: deriveBotWebhookSecret(org.slug),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  if (!hook.ok) {
    throw new ServiceError("O Telegram não aceitou registrar o bot agora. Tente novamente em alguns minutos.");
  }

  await saveIntegration({
    organizationId: ctx.organizationId,
    provider: "telegram_bot",
    externalAccountId: String(bot.id),
    displayName: `@${bot.username}`,
    metadata: { username: bot.username },
    connectedBy: ctx.userId,
    accessToken: token,
  });
  return { username: bot.username! };
}

export async function disconnectOwnTelegramBot(ctx: Pick<ServiceContext, "organizationId" | "role">): Promise<void> {
  if (ctx.role === "member") throw new ServiceError(ADMIN_ONLY);
  const bot = await getOwnTelegramBot(ctx.organizationId);
  if (!bot) throw new ServiceError("A empresa não tem um bot próprio configurado.");
  await removeBot(ctx.organizationId, bot);
}
