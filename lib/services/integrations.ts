import "server-only";
import { INTEGRATION_CATALOG, type IntegrationProvider } from "@/lib/integrations/catalog";
import { createAdminClient } from "@/lib/supabase/admin";
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
  provider: IntegrationProvider;
  externalAccountId: string;
  displayName?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  connectedBy?: string | null;
  accessToken: string;
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

// RLS: só owner/admin excluem; segredos caem em cascata.
export async function disconnectIntegration(ctx: Ctx, integrationId: string): Promise<void> {
  const { data, error } = await ctx.supabase.from("integrations").delete().eq("id", integrationId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new ServiceError("Não foi possível desconectar: a integração não existe ou apenas administradores podem desconectá-la.");
  }
}
