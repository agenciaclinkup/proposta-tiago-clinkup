import "server-only";
import { randomInt } from "node:crypto";
import { INTEGRATION_CATALOG, type IntegrationProvider } from "@/lib/integrations/catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TelegramScope } from "@/lib/telegram/telegram";
import { decryptSecret, encryptSecret } from "@/lib/vault";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

type Ctx = Pick<ServiceContext, "supabase" | "organizationId">;

type IntegrationRow = {
  provider: string;
  status: string;
  display_name: string | null;
  external_account_id: string;
};

// Leitura pelo cliente do usuário (RLS). Tokens moram em integration_secrets e nunca são selecionados aqui.
export async function listIntegrations(ctx: Ctx) {
  const { data, error } = await ctx.supabase
    .from("integrations")
    .select("id, provider, status, external_account_id, display_name, scopes, metadata, updated_at")
    .eq("organization_id", ctx.organizationId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

// Visão por provedor (todos aparecem, conectados ou não) para a UI e para o Hermes.
export function summarizeIntegrations(rows: IntegrationRow[]) {
  return INTEGRATION_CATALOG.map(({ provider, name }) => {
    const accounts = rows.filter((row) => row.provider === provider && row.status !== "disconnected");
    const status = accounts.some((row) => row.status === "needs_attention")
      ? "needs_attention"
      : accounts.length > 0
        ? "connected"
        : "not_connected";
    return { provider, name, status, accounts: accounts.map((row) => row.display_name ?? row.external_account_id) };
  });
}

export type SaveIntegrationInput = {
  organizationId: string;
  // telegram_bot: configuração do bot próprio (não aparece como card no catálogo).
  provider: IntegrationProvider | "telegram_bot";
  externalAccountId: string;
  displayName?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  connectedBy?: string | null;
  // Opcional: o vínculo com o bot da plataforma não tem token próprio do cliente.
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
};

// Chamado só por código de servidor já autorizado (callback OAuth validado, webhook com segredo).
// Tokens cifrados com AAD = id da integração: o texto cifrado não serve se copiado para outra linha.
export async function saveIntegration(input: SaveIntegrationInput): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integrations")
    .upsert(
      {
        organization_id: input.organizationId,
        provider: input.provider,
        external_account_id: input.externalAccountId,
        display_name: input.displayName ?? null,
        scopes: input.scopes ?? [],
        metadata: input.metadata ?? {},
        connected_by: input.connectedBy ?? null,
        status: "connected",
      },
      { onConflict: "organization_id,provider,external_account_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "integration upsert returned no row");
  if (!input.accessToken) return data.id;

  const { error: secretError } = await admin.from("integration_secrets").upsert({
    integration_id: data.id,
    organization_id: input.organizationId,
    access_token_encrypted: encryptSecret(input.accessToken, data.id),
    refresh_token_encrypted: input.refreshToken ? encryptSecret(input.refreshToken, data.id) : null,
    expires_at: input.expiresAt ?? null,
  });
  if (secretError) throw new Error(secretError.message);
  return data.id;
}

// Decifra no servidor, no momento da chamada à API externa. Filtra por org para não cruzar tenants.
export async function getIntegrationToken(organizationId: string, integrationId: string) {
  const { data, error } = await createAdminClient()
    .from("integration_secrets")
    .select("access_token_encrypted, refresh_token_encrypted, expires_at")
    .eq("integration_id", integrationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError("Esta integração não está conectada. Abra a página Integrações e conecte a conta novamente.");

  return {
    accessToken: decryptSecret(data.access_token_encrypted, integrationId),
    refreshToken: data.refresh_token_encrypted ? decryptSecret(data.refresh_token_encrypted, integrationId) : null,
    expiresAt: data.expires_at as string | null,
  };
}

// Sem 0/1/I/O para evitar confusão ao digitar no Telegram. 32 símbolos × 8 posições = 40 bits, válido por 10 min.
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_CODE_TTL_MS = 10 * 60_000;

export async function createTelegramLinkCode(ctx: { organizationId: string; userId: string | null }) {
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para gerar o código de vínculo.");
  const admin = createAdminClient();
  // Colisão de código é improvável; tenta de novo poucas vezes por segurança.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = Array.from({ length: 8 }, () => LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)]).join("");
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
    const { error } = await admin
      .from("telegram_link_codes")
      .insert({ code, organization_id: ctx.organizationId, user_id: ctx.userId, expires_at: expiresAt });
    if (!error) return { code, expiresAt };
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("não foi possível gerar um código único");
}

// Bot da plataforma: "<chatId>". Bot próprio da empresa: "<botId>:<chatId>" — os dois nunca se confundem.
const telegramAccountId = (chatId: number, scope?: TelegramScope) => (scope ? `${scope.botId}:${chatId}` : String(chatId));

// Bot da plataforma: um chat fica vinculado a uma conta por vez (o vínculo novo remove os de outras empresas).
// Bot próprio: só aceita código da empresa dona do bot e não mexe em vínculos de outras empresas.
export async function linkTelegramChat(
  code: string,
  chat: { chatId: number; displayName: string | null },
  scope?: TelegramScope,
) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "consume_telegram_link_code",
    scope ? { p_code: code, p_organization_id: scope.organizationId } : { p_code: code },
  );
  if (error) throw new Error(error.message);
  const link = (data as { organization_id: string; user_id: string }[] | null)?.[0];
  if (!link) return null;

  const externalAccountId = telegramAccountId(chat.chatId, scope);
  if (!scope) {
    const { error: cleanupError } = await admin
      .from("integrations")
      .delete()
      .eq("provider", "telegram")
      .eq("external_account_id", externalAccountId)
      .neq("organization_id", link.organization_id);
    if (cleanupError) throw new Error(cleanupError.message);
  }

  await saveIntegration({
    organizationId: link.organization_id,
    provider: "telegram",
    externalAccountId,
    displayName: chat.displayName,
    metadata: scope ? { user_id: link.user_id, bot: "org" } : { user_id: link.user_id },
    connectedBy: link.user_id,
  });
  return link;
}

// Chat vinculado → org e usuário. Leitura via admin (o webhook não tem sessão de usuário).
export async function findTelegramLink(chatId: number, scope?: TelegramScope) {
  let query = createAdminClient()
    .from("integrations")
    .select("id, organization_id, metadata")
    .eq("provider", "telegram")
    .eq("external_account_id", telegramAccountId(chatId, scope))
    .eq("status", "connected");
  if (scope) query = query.eq("organization_id", scope.organizationId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  const userId = (data?.metadata as { user_id?: string } | undefined)?.user_id;
  return data && userId ? { integrationId: data.id as string, organizationId: data.organization_id as string, userId } : null;
}

// Qualquer papel desvincula o PRÓPRIO chat do Telegram. Admin client porque o RLS de delete é só de admin;
// o filtro por org + provider + metadata.user_id garante que ninguém remove o vínculo de outra pessoa.
export async function unlinkOwnTelegram(ctx: { organizationId: string; userId: string | null }, integrationId: string) {
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para desvincular o Telegram.");
  const { data, error } = await createAdminClient()
    .from("integrations")
    .delete()
    .eq("id", integrationId)
    .eq("organization_id", ctx.organizationId)
    .eq("provider", "telegram")
    .eq("metadata->>user_id", ctx.userId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ServiceError("Este Telegram não está vinculado à sua conta ou já foi desvinculado.");
}

// RLS: só owner/admin excluem; segredos caem em cascata.
export async function disconnectIntegration(ctx: Ctx, integrationId: string): Promise<void> {
  const { data, error } = await ctx.supabase.from("integrations").delete().eq("id", integrationId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new ServiceError("Não foi possível desconectar: a integração não existe ou apenas administradores podem desconectá-la.");
  }
}
