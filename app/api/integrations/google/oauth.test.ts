import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthState } from "@/lib/integrations/oauth-state";

const loadWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({ loadWorkspace }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { integrationsUser: {} } }));
const exchangeGoogleCode = vi.fn();
const fetchGoogleBusinessLocations = vi.fn();
const fetchGooglePrimaryCalendar = vi.fn();
vi.mock("@/lib/integrations/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/google")>()),
  exchangeGoogleCode,
  fetchGoogleBusinessLocations,
  fetchGooglePrimaryCalendar,
}));
const saveIntegration = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ saveIntegration }));

const { GET: start } = await import("./start/route");
const { GET: callback } = await import("./callback/route");

const workspace = { user: { id: "u-1" }, role: "admin", organization: { id: "org-1" } };
const location = (res: Response) => res.headers.get("location") ?? "";
const startRequest = (product: string) => new NextRequest(`https://app.clinkup.com.br/api/integrations/google/start?product=${product}`);
const callbackRequest = (params: Record<string, string>, nonce?: string) =>
  new NextRequest(`https://app.clinkup.com.br/api/integrations/google/callback?${new URLSearchParams(params)}`, {
    headers: nonce ? { cookie: `oauth_nonce=${nonce}` } : {},
  });
const stateFor = (context: string) => createOAuthState({ organizationId: "org-1", userId: "u-1", provider: "google", context });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "csecret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.clinkup.com.br");
  loadWorkspace.mockResolvedValue({ status: "ok", workspace });
  rateLimit.mockResolvedValue(true);
  exchangeGoogleCode.mockResolvedValue({ accessToken: "ya29", refreshToken: "1//rt", expiresAt: null, scopes: [] });
  fetchGoogleBusinessLocations.mockResolvedValue([{ name: "locations/1", title: "Loja Centro" }]);
  fetchGooglePrimaryCalendar.mockResolvedValue({ id: "ana@empresa.com", summary: "ana@empresa.com" });
  saveIntegration.mockResolvedValue("int-1");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/integrations/google/start", () => {
  it("redireciona ao Google com o produto assinado no state e nonce em cookie httpOnly", async () => {
    const res = await start(startRequest("calendar"));
    const target = new URL(location(res));
    expect(target.hostname).toBe("accounts.google.com");
    expect(target.searchParams.get("redirect_uri")).toBe("https://app.clinkup.com.br/api/integrations/google/callback");
    expect(target.searchParams.get("access_type")).toBe("offline");
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("httponly");
  });

  it("valida o produto, o papel, o rate limit e a configuração", async () => {
    expect(location(await start(startRequest("drive")))).toContain("google=invalid");
    loadWorkspace.mockResolvedValueOnce({ status: "ok", workspace: { ...workspace, role: "member" } });
    expect(location(await start(startRequest("business")))).toContain("google=forbidden");
    rateLimit.mockResolvedValueOnce(false);
    expect(location(await start(startRequest("business")))).toContain("google=rate_limited");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(location(await start(startRequest("business")))).toContain("google=unavailable");
  });
});

describe("GET /api/integrations/google/callback", () => {
  it("conecta os locais do Google Meu Negócio com refresh token no cofre e grant compartilhado", async () => {
    fetchGoogleBusinessLocations.mockResolvedValueOnce([
      { name: "locations/1", title: "Loja Centro" },
      { name: "locations/2", title: "Loja Sul" },
    ]);
    const { state, nonce } = stateFor("business");
    const res = await callback(callbackRequest({ code: "c0de", state }, nonce));
    expect(exchangeGoogleCode).toHaveBeenCalledWith("c0de", "https://app.clinkup.com.br/api/integrations/google/callback");
    expect(saveIntegration).toHaveBeenCalledTimes(2);
    const [first, second] = saveIntegration.mock.calls.map((call) => call[0]);
    expect(first).toMatchObject({ provider: "google_business", refreshToken: "1//rt", organizationId: "org-1" });
    expect(first.metadata.google_grant_id).toBe(second.metadata.google_grant_id);
    expect(location(res)).toContain("google=connected");
    expect(res.headers.get("set-cookie")).toContain("oauth_nonce=;");
  });

  it("conecta a agenda principal no produto calendar", async () => {
    const { state, nonce } = stateFor("calendar");
    await callback(callbackRequest({ code: "c", state }, nonce));
    expect(saveIntegration).toHaveBeenCalledWith(expect.objectContaining({ provider: "google_calendar", externalAccountId: "ana@empresa.com" }));
    expect(fetchGoogleBusinessLocations).not.toHaveBeenCalled();
  });

  it("recusa state inválido ou de outro usuário sem trocar o code", async () => {
    const { state, nonce } = stateFor("business");
    expect(location(await callback(callbackRequest({ code: "c", state }, "outro")))).toContain("google=invalid_state");
    loadWorkspace.mockResolvedValueOnce({ status: "ok", workspace: { ...workspace, user: { id: "u-2" } } });
    expect(location(await callback(callbackRequest({ code: "c", state }, nonce)))).toContain("google=invalid_state");
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("exige refresh token e trata cancelamento, nada encontrado e erro", async () => {
    expect(location(await callback(callbackRequest({ error: "access_denied" })))).toContain("google=cancelled");

    const a = stateFor("business");
    exchangeGoogleCode.mockResolvedValueOnce({ accessToken: "ya29", refreshToken: null, expiresAt: null, scopes: [] });
    expect(location(await callback(callbackRequest({ code: "c", state: a.state }, a.nonce)))).toContain("google=no_refresh");

    const b = stateFor("business");
    fetchGoogleBusinessLocations.mockResolvedValueOnce([]);
    expect(location(await callback(callbackRequest({ code: "c", state: b.state }, b.nonce)))).toContain("google=none");

    const c = stateFor("business");
    exchangeGoogleCode.mockRejectedValueOnce(new Error("down"));
    expect(location(await callback(callbackRequest({ code: "c", state: c.state }, c.nonce)))).toContain("google=error");
    expect(saveIntegration).not.toHaveBeenCalled();
  });
});
