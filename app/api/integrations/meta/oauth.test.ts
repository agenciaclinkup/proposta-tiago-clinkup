import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthState } from "@/lib/integrations/oauth-state";

const loadWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({ loadWorkspace }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { integrationsUser: {} } }));
const exchangeMetaCode = vi.fn();
const fetchMetaAccounts = vi.fn();
vi.mock("@/lib/integrations/meta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/meta")>()),
  exchangeMetaCode,
  fetchMetaAccounts,
}));
const saveIntegration = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ saveIntegration }));

const { GET: start } = await import("./start/route");
const { GET: callback } = await import("./callback/route");

const workspace = { user: { id: "u-1" }, role: "owner", organization: { id: "org-1" } };
const location = (res: Response) => res.headers.get("location") ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("META_APP_ID", "app-123");
  vi.stubEnv("META_APP_SECRET", "secret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.clinkup.com.br");
  loadWorkspace.mockResolvedValue({ status: "ok", workspace });
  rateLimit.mockResolvedValue(true);
  exchangeMetaCode.mockResolvedValue({ accessToken: "user-long", expiresAt: null });
  fetchMetaAccounts.mockResolvedValue({
    metaUserId: "meta-42",
    grantedScopes: ["pages_show_list"],
    pages: [{ id: "p1", name: "Clinkup", accessToken: "page-tok", instagram: { id: "ig1", username: "clinkup" } }],
    adAccounts: [{ id: "act_1", name: "Conta", accountStatus: 1, business: null, pixelId: null }],
  });
  saveIntegration.mockResolvedValue("int-1");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/integrations/meta/start", () => {
  it("redireciona ao diálogo da Meta com state assinado e nonce em cookie httpOnly", async () => {
    const res = await start(new NextRequest("https://app.clinkup.com.br/api/integrations/meta/start"));
    const target = new URL(location(res));
    expect(target.hostname).toBe("www.facebook.com");
    expect(target.searchParams.get("redirect_uri")).toBe("https://app.clinkup.com.br/api/integrations/meta/callback");
    expect(target.searchParams.get("state")).toContain(".");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("oauth_nonce=");
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("só owner/admin, com rate limit e configuração presente", async () => {
    loadWorkspace.mockResolvedValueOnce({ status: "ok", workspace: { ...workspace, role: "member" } });
    expect(location(await start(new NextRequest("https://x/api/integrations/meta/start")))).toContain("meta=forbidden");
    rateLimit.mockResolvedValueOnce(false);
    expect(location(await start(new NextRequest("https://x/api/integrations/meta/start")))).toContain("meta=rate_limited");
    vi.stubEnv("META_APP_ID", "");
    expect(location(await start(new NextRequest("https://x/api/integrations/meta/start")))).toContain("meta=unavailable");
  });
});

describe("GET /api/integrations/meta/callback", () => {
  const callbackRequest = (params: Record<string, string>, nonce?: string) =>
    new NextRequest(`https://app.clinkup.com.br/api/integrations/meta/callback?${new URLSearchParams(params)}`, {
      headers: nonce ? { cookie: `oauth_nonce=${nonce}` } : {},
    });
  const validState = () => createOAuthState({ organizationId: "org-1", userId: "u-1", provider: "meta" });

  it("conecta Páginas, Instagram e anúncios com tokens no cofre e volta para /integrations", async () => {
    const { state, nonce } = validState();
    const res = await callback(callbackRequest({ code: "c0de", state }, nonce));
    expect(exchangeMetaCode).toHaveBeenCalledWith("c0de", "https://app.clinkup.com.br/api/integrations/meta/callback");
    expect(saveIntegration).toHaveBeenCalledTimes(3);
    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "instagram", accessToken: "page-tok", organizationId: "org-1" }),
    );
    expect(location(res)).toContain("meta=connected");
    expect(res.headers.get("set-cookie")).toContain("oauth_nonce=;");
  });

  it("recusa state inválido, sem cookie ou de outro usuário, sem trocar o code", async () => {
    const { state, nonce } = validState();
    expect(location(await callback(callbackRequest({ code: "c", state }, "outro-nonce")))).toContain("meta=invalid_state");
    expect(location(await callback(callbackRequest({ code: "c", state })))).toContain("meta=invalid_state");
    loadWorkspace.mockResolvedValueOnce({ status: "ok", workspace: { ...workspace, user: { id: "u-2" } } });
    expect(location(await callback(callbackRequest({ code: "c", state }, nonce)))).toContain("meta=invalid_state");
    expect(exchangeMetaCode).not.toHaveBeenCalled();
  });

  it("trata cancelamento, nenhuma conta encontrada e erro da Meta", async () => {
    expect(location(await callback(callbackRequest({ error: "access_denied", error_reason: "user_denied" })))).toContain(
      "meta=cancelled",
    );
    const first = validState();
    fetchMetaAccounts.mockResolvedValueOnce({ metaUserId: "m", grantedScopes: [], pages: [], adAccounts: [] });
    expect(location(await callback(callbackRequest({ code: "c", state: first.state }, first.nonce)))).toContain("meta=none");
    const second = validState();
    exchangeMetaCode.mockRejectedValueOnce(new Error("graph down"));
    expect(location(await callback(callbackRequest({ code: "c", state: second.state }, second.nonce)))).toContain("meta=error");
  });

  it("member não conecta mesmo com state válido", async () => {
    const { state, nonce } = validState();
    loadWorkspace.mockResolvedValueOnce({ status: "ok", workspace: { ...workspace, role: "member" } });
    expect(location(await callback(callbackRequest({ code: "c", state }, nonce)))).toContain("meta=forbidden");
    expect(exchangeMetaCode).not.toHaveBeenCalled();
  });
});
