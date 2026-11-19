import "server-only";
import { ServiceError } from "@/lib/services/errors";
import { getIntegrationToken, type SaveIntegrationInput } from "@/lib/services/integrations";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/vault";

// Endpoints e escopos conferidos na documentação oficial do Google em 2026-11-18.
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type GoogleProduct = "business" | "calendar";

export const GOOGLE_SCOPES: Record<GoogleProduct, string[]> = {
  business: ["https://www.googleapis.com/auth/business.manage"],
  // calendar.events: criar/editar eventos; calendarlist.readonly: identificar a agenda principal conectada.
  calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
};

const PROVIDER: Record<GoogleProduct, "google_business" | "google_calendar"> = {
  business: "google_business",
  calendar: "google_calendar",
};

// access_type=offline + prompt=consent: o Google só devolve refresh_token na 1ª autorização sem o prompt.
export function googleAuthorizeUrl({ product, redirectUri, state }: { product: GoogleProduct; redirectUri: string; state: string }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES[product].join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse & { ok: boolean }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  return { ...body, ok: response.ok && !body.error };
}

const expiresAtFrom = (seconds?: number) => (seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null);

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const body = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!body.ok || !body.access_token) throw new Error(`google token exchange failed: ${body.error ?? "unknown"}`);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: expiresAtFrom(body.expires_in),
    scopes: body.scope?.split(" ") ?? [],
  };
}

async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`google api ${new URL(url).pathname}: ${response.status}`);
  return (await response.json()) as T;
}

// Business Profile: contas → locais (até 100 por conta). Requer acesso aprovado à API pelo Google.
export async function fetchGoogleBusinessLocations(accessToken: string) {
  const accounts = await googleGet<{ accounts?: { name: string }[] }>(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    accessToken,
  );
  const locations: { name: string; title: string }[] = [];
  for (const account of accounts.accounts ?? []) {
    const page = await googleGet<{ locations?: { name: string; title?: string }[] }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`,
      accessToken,
    );
    for (const location of page.locations ?? []) locations.push({ name: location.name, title: location.title ?? location.name });
  }
  return locations;
}

export async function fetchGooglePrimaryCalendar(accessToken: string) {
  const calendar = await googleGet<{ id: string; summary?: string }>(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary",
    accessToken,
  );
  return { id: calendar.id, summary: calendar.summary ?? calendar.id };
}

// Função pura: uma autorização → linhas de integração. `grantId` agrupa as linhas que compartilham o mesmo refresh token.
export function mapGoogleConnections(input: {
  product: GoogleProduct;
  organizationId: string;
  userId: string;
  grantId: string;
  tokens: { accessToken: string; refreshToken: string; expiresAt: string | null; scopes: string[] };
  locations: { name: string; title: string }[];
  calendar: { id: string; summary: string } | null;
}): SaveIntegrationInput[] {
  const base = {
    organizationId: input.organizationId,
    provider: PROVIDER[input.product],
    connectedBy: input.userId,
    scopes: input.tokens.scopes,
    accessToken: input.tokens.accessToken,
    refreshToken: input.tokens.refreshToken,
    expiresAt: input.tokens.expiresAt,
    metadata: { google_grant_id: input.grantId },
  };
  if (input.product === "business") {
    return input.locations.map((location) => ({ ...base, externalAccountId: location.name, displayName: location.title }));
  }
  return input.calendar ? [{ ...base, externalAccountId: input.calendar.id, displayName: input.calendar.summary }] : [];
}

const RECONNECT = "O acesso ao Google expirou ou foi removido. Peça a um administrador para reconectar em Integrações.";

// Access token válido para chamar as APIs do Google; renova com o refresh token quando faltar menos de 1 minuto.
export async function getGoogleAccessToken(organizationId: string, integrationId: string): Promise<string> {
  const current = await getIntegrationToken(organizationId, integrationId);
  if (current.expiresAt && new Date(current.expiresAt).getTime() > Date.now() + 60_000) return current.accessToken;
  if (!current.refreshToken) throw new ServiceError(RECONNECT);

  const admin = createAdminClient();
  const body = await tokenRequest({ refresh_token: current.refreshToken, grant_type: "refresh_token" });
  if (!body.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      await admin.from("integrations").update({ status: "needs_attention" }).eq("id", integrationId).eq("organization_id", organizationId);
      throw new ServiceError(RECONNECT);
    }
    throw new Error(`google token refresh failed: ${body.error ?? "unknown"}`);
  }

  const { error } = await admin
    .from("integration_secrets")
    .update({ access_token_encrypted: encryptSecret(body.access_token, integrationId), expires_at: expiresAtFrom(body.expires_in) })
    .eq("integration_id", integrationId)
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  return body.access_token;
}

// Antes de desconectar: refresh token a revogar, só se esta é a última linha do mesmo grant (revogar quebra todas).
export async function googleTokenToRevoke(organizationId: string, integrationId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("provider, metadata")
    .eq("id", integrationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data || (data.provider !== "google_business" && data.provider !== "google_calendar")) return null;

  const grantId = (data.metadata as { google_grant_id?: string } | null)?.google_grant_id;
  if (grantId) {
    const { data: others } = await admin
      .from("integrations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("metadata->>google_grant_id", grantId)
      .neq("id", integrationId);
    if ((others as unknown[] | null)?.length) return null;
  }

  const token = await getIntegrationToken(organizationId, integrationId).catch(() => null);
  return token?.refreshToken ?? token?.accessToken ?? null;
}

// Melhor esforço: a integração já foi removida da plataforma; falha aqui só fica no log.
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    if (!response.ok) console.error("[google] revogação recusada", response.status);
  } catch (error) {
    console.error("[google] falha ao revogar token", error);
  }
}
