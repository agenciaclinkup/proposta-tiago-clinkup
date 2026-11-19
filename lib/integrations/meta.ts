import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SaveIntegrationInput } from "@/lib/services/integrations";

// Versão conferida na documentação oficial (changelog da Graph API) em 2026-11-18. Atualizar de forma explícita.
export const META_GRAPH_VERSION = "v27.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// Permissões (Facebook Login) conferidas na referência oficial de permissões. Todas exigem App Review.
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management",
  "ads_management",
  "ads_read",
];

export function metaAuthorizeUrl({ appId, redirectUri, state }: { appId: string; redirectUri: string; state: string }) {
  const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES.join(","));
  return url.toString();
}

// signed_request dos callbacks de exclusão de dados e desautorização: "<assinatura>.<payload>" em base64url, HMAC-SHA256.
export function verifySignedRequest(signedRequest: string, appSecret: string): { user_id: string } | null {
  const [signature, payload] = signedRequest.split(".", 2);
  if (!signature || !payload) return null;
  const expected = createHmac("sha256", appSecret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { algorithm?: string; user_id?: string };
    return data.algorithm?.toUpperCase() === "HMAC-SHA256" && data.user_id ? { user_id: String(data.user_id) } : null;
  } catch {
    return null;
  }
}

type GraphError = { error?: { message?: string; code?: number } };

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const body = (await response.json()) as T & GraphError;
  if (!response.ok || body.error) throw new Error(`meta graph ${path}: ${body.error?.message ?? response.status}`);
  return body;
}

export async function exchangeMetaCode(code: string, redirectUri: string) {
  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const short = await graph<{ access_token: string }>("oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: short.access_token,
  });
  return {
    accessToken: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
  };
}

export type MetaAccounts = {
  metaUserId: string;
  grantedScopes: string[];
  pages: { id: string; name: string; accessToken: string; instagram: { id: string; username: string | null } | null }[];
  adAccounts: { id: string; name: string; accountStatus: number; business: { id: string; name: string } | null; pixelId: string | null }[];
};

// Lê tudo que o usuário autorizou. Falha em anúncios/pixels não impede conectar Páginas e Instagram.
export async function fetchMetaAccounts(userToken: string): Promise<MetaAccounts> {
  const me = await graph<{ id: string }>("me", { fields: "id", access_token: userToken });
  const permissions = await graph<{ data: { permission: string; status: string }[] }>("me/permissions", { access_token: userToken });
  const grantedScopes = permissions.data.filter((p) => p.status === "granted").map((p) => p.permission);

  const accounts = await graph<{ data: { id: string; name: string; access_token: string }[] }>(`${me.id}/accounts`, {
    fields: "id,name,access_token",
    access_token: userToken,
  });
  const pages = await Promise.all(
    accounts.data.map(async (page) => {
      const detail = await graph<{ instagram_business_account?: { id: string } }>(page.id, {
        fields: "instagram_business_account",
        access_token: page.access_token,
      }).catch(() => ({}) as { instagram_business_account?: { id: string } });
      const igId = detail.instagram_business_account?.id;
      const ig = igId
        ? await graph<{ username?: string }>(igId, { fields: "username", access_token: page.access_token }).catch(() => ({}) as { username?: string })
        : null;
      return {
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        instagram: igId ? { id: igId, username: ig?.username ?? null } : null,
      };
    }),
  );

  let adAccounts: MetaAccounts["adAccounts"] = [];
  try {
    const ads = await graph<{ data: { id: string; name: string; account_status: number; business?: { id: string; name: string } }[] }>(
      "me/adaccounts",
      { fields: "id,name,account_status,business{id,name}", access_token: userToken },
    );
    adAccounts = await Promise.all(
      ads.data.map(async (account) => {
        const pixels = await graph<{ data: { id: string }[] }>(`${account.id}/adspixels`, { fields: "id", access_token: userToken }).catch(
          () => ({ data: [] }),
        );
        return {
          id: account.id,
          name: account.name,
          accountStatus: account.account_status,
          business: account.business ?? null,
          pixelId: pixels.data[0]?.id ?? null,
        };
      }),
    );
  } catch (error) {
    console.error("[meta] não foi possível ler contas de anúncios", error);
  }

  return { metaUserId: me.id, grantedScopes, pages, adAccounts };
}

// Função pura: respostas da Meta → linhas de integração (token certo para cada tipo).
export function mapMetaConnections(
  input: MetaAccounts & {
    organizationId: string;
    userId: string;
    userToken: { accessToken: string; expiresAt: string | null };
  },
): SaveIntegrationInput[] {
  const base = { organizationId: input.organizationId, connectedBy: input.userId, scopes: input.grantedScopes };
  const rows: SaveIntegrationInput[] = [];

  for (const page of input.pages) {
    rows.push({
      ...base,
      provider: "facebook_page",
      externalAccountId: page.id,
      displayName: page.name,
      accessToken: page.accessToken,
      expiresAt: null,
      metadata: { meta_user_id: input.metaUserId, page_id: page.id },
    });
    if (page.instagram) {
      rows.push({
        ...base,
        provider: "instagram",
        externalAccountId: page.instagram.id,
        displayName: page.instagram.username ? `@${page.instagram.username}` : page.name,
        // Publicação no Instagram via Facebook Login usa o token da Página vinculada.
        accessToken: page.accessToken,
        expiresAt: null,
        metadata: { meta_user_id: input.metaUserId, page_id: page.id, page_name: page.name },
      });
    }
  }

  for (const account of input.adAccounts) {
    rows.push({
      ...base,
      provider: "meta_ads",
      externalAccountId: account.id,
      displayName: account.name,
      accessToken: input.userToken.accessToken,
      expiresAt: input.userToken.expiresAt,
      // account_status 1 = ativa; qualquer outro valor pede atenção (pagamento, bloqueio, revisão).
      status: account.accountStatus === 1 ? "connected" : "needs_attention",
      metadata: {
        meta_user_id: input.metaUserId,
        account_status: account.accountStatus,
        business_id: account.business?.id ?? null,
        business_name: account.business?.name ?? null,
        pixel_id: account.pixelId,
      },
    });
  }
  return rows;
}
