import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapMetaConnections, META_GRAPH_VERSION, META_SCOPES, metaAuthorizeUrl, verifySignedRequest } from "./meta";

const sign = (payload: object, secret: string) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
};

describe("metaAuthorizeUrl", () => {
  it("monta o diálogo OAuth da versão fixada com escopos, state e redirect", () => {
    const url = new URL(metaAuthorizeUrl({ appId: "123", redirectUri: "https://app.x/api/integrations/meta/callback", state: "st" }));
    expect(url.origin + url.pathname).toBe(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")?.split(",")).toEqual(META_SCOPES);
    expect(META_SCOPES).toEqual(expect.arrayContaining(["instagram_content_publish", "pages_manage_posts", "ads_management"]));
  });
});

describe("verifySignedRequest", () => {
  it("devolve o payload quando a assinatura HMAC-SHA256 confere", () => {
    const signed = sign({ algorithm: "HMAC-SHA256", user_id: "meta-42", issued_at: 1 }, "app-secret");
    expect(verifySignedRequest(signed, "app-secret")).toEqual(expect.objectContaining({ user_id: "meta-42" }));
  });

  it("recusa assinatura de outro segredo, algoritmo diferente ou formato inválido", () => {
    expect(verifySignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "x" }, "outro"), "app-secret")).toBeNull();
    expect(verifySignedRequest(sign({ algorithm: "PLAIN", user_id: "x" }, "app-secret"), "app-secret")).toBeNull();
    expect(verifySignedRequest("sem-ponto", "app-secret")).toBeNull();
    expect(verifySignedRequest(sign({ algorithm: "HMAC-SHA256" }, "app-secret"), "app-secret")).toBeNull();
  });
});

describe("mapMetaConnections", () => {
  const input = {
    organizationId: "org-1",
    userId: "u-1",
    metaUserId: "meta-42",
    grantedScopes: ["pages_show_list", "ads_management"],
    userToken: { accessToken: "user-long", expiresAt: "2027-01-17T00:00:00.000Z" },
    pages: [
      { id: "p1", name: "Clinkup", accessToken: "page-tok-1", instagram: { id: "ig1", username: "clinkup" } },
      { id: "p2", name: "Sem Instagram", accessToken: "page-tok-2", instagram: null },
    ],
    adAccounts: [
      { id: "act_1", name: "Conta Principal", accountStatus: 1, business: { id: "b1", name: "Clinkup BM" }, pixelId: "px1" },
      { id: "act_2", name: "Conta Bloqueada", accountStatus: 2, business: null, pixelId: null },
    ],
  };

  it("gera Página, Instagram e contas de anúncios com o token certo para cada uma", () => {
    const rows = mapMetaConnections(input);
    const by = (provider: string, id: string) => rows.find((r) => r.provider === provider && r.externalAccountId === id)!;

    expect(by("facebook_page", "p1")).toMatchObject({ displayName: "Clinkup", accessToken: "page-tok-1", expiresAt: null });
    expect(by("instagram", "ig1")).toMatchObject({ displayName: "@clinkup", accessToken: "page-tok-1", metadata: expect.objectContaining({ page_id: "p1" }) });
    expect(rows.filter((r) => r.provider === "instagram")).toHaveLength(1);
    expect(by("meta_ads", "act_1")).toMatchObject({
      accessToken: "user-long",
      expiresAt: "2027-01-17T00:00:00.000Z",
      status: "connected",
      metadata: expect.objectContaining({ business_id: "b1", pixel_id: "px1" }),
    });
  });

  it("marca conta de anúncios não ativa como precisando de atenção e guarda o usuário Meta para exclusão de dados", () => {
    const rows = mapMetaConnections(input);
    expect(rows.find((r) => r.externalAccountId === "act_2")?.status).toBe("needs_attention");
    expect(rows.every((r) => r.metadata?.meta_user_id === "meta-42" && r.organizationId === "org-1" && r.connectedBy === "u-1")).toBe(true);
    expect(rows.every((r) => r.scopes?.join() === "pages_show_list,ads_management")).toBe(true);
  });
});
