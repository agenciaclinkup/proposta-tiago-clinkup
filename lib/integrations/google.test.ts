import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

// Admin falso: cada select consome a próxima resposta da fila; updates ficam registrados com seus filtros.
const updates: { table: string; payload: Record<string, unknown>; filters: string[] }[] = [];
const selectQueue: unknown[] = [];
const chain = (filters: string[], data: unknown) => {
  const c = {
    eq: (col: string, val: unknown) => (filters.push(`${col}=${val}`), c),
    neq: (col: string, val: unknown) => (filters.push(`${col}!=${val}`), c),
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
  };
  return c;
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => chain([], selectQueue.shift() ?? null),
      update: (payload: Record<string, unknown>) => {
        const entry = { table, payload, filters: [] as string[] };
        updates.push(entry);
        return chain(entry.filters, null);
      },
    }),
  }),
}));
const getIntegrationToken = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ getIntegrationToken }));

const { decryptSecret } = await import("@/lib/vault");
const google = await import("./google");

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  selectQueue.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "csecret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("googleAuthorizeUrl", () => {
  it("pede acesso offline com consentimento (garante refresh_token) e o escopo do produto", () => {
    const url = new URL(google.googleAuthorizeUrl({ product: "calendar", redirectUri: "https://x/cb", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "cid",
      redirect_uri: "https://x/cb",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: "st",
    });
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(new URL(google.googleAuthorizeUrl({ product: "business", redirectUri: "x", state: "s" })).searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/business.manage",
    );
  });
});

describe("mapGoogleConnections", () => {
  const tokens = { accessToken: "ya29", refreshToken: "1//rt", expiresAt: "2026-11-19T00:00:00.000Z", scopes: ["s"] };

  it("um local do Business Profile por linha, todos com refresh token e o mesmo grant", () => {
    const rows = google.mapGoogleConnections({
      product: "business",
      organizationId: "org-1",
      userId: "u-1",
      grantId: "g-1",
      tokens,
      locations: [
        { name: "locations/1", title: "Loja Centro" },
        { name: "locations/2", title: "Loja Sul" },
      ],
      calendar: null,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      provider: "google_business",
      externalAccountId: "locations/1",
      displayName: "Loja Centro",
      accessToken: "ya29",
      refreshToken: "1//rt",
      expiresAt: tokens.expiresAt,
      metadata: { google_grant_id: "g-1" },
    });
  });

  it("agenda principal vira uma linha google_calendar", () => {
    const rows = google.mapGoogleConnections({
      product: "calendar",
      organizationId: "org-1",
      userId: "u-1",
      grantId: "g-2",
      tokens,
      locations: [],
      calendar: { id: "ana@empresa.com", summary: "ana@empresa.com" },
    });
    expect(rows).toEqual([expect.objectContaining({ provider: "google_calendar", externalAccountId: "ana@empresa.com" })]);
  });
});

describe("getGoogleAccessToken", () => {
  it("usa o access token salvo enquanto ele ainda vale", async () => {
    getIntegrationToken.mockResolvedValue({
      accessToken: "ya29-ok",
      refreshToken: "1//rt",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    expect(await google.getGoogleAccessToken("org-1", "int-1")).toBe("ya29-ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renova com o refresh token, cifra o novo token e grava a nova validade", async () => {
    getIntegrationToken.mockResolvedValue({ accessToken: "old", refreshToken: "1//rt", expiresAt: new Date(Date.now() - 1000).toISOString() });
    fetchMock.mockResolvedValue(Response.json({ access_token: "ya29-new", expires_in: 3599 }));
    expect(await google.getGoogleAccessToken("org-1", "int-1")).toBe("ya29-new");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_id: "cid",
      client_secret: "csecret",
      refresh_token: "1//rt",
      grant_type: "refresh_token",
    });
    const saved = updates.find((u) => u.table === "integration_secrets")!;
    expect(decryptSecret(saved.payload.access_token_encrypted as string, "int-1")).toBe("ya29-new");
    expect(saved.filters).toEqual(["integration_id=int-1", "organization_id=org-1"]);
  });

  it("marca a integração como precisando de atenção quando o Google revoga o acesso", async () => {
    getIntegrationToken.mockResolvedValue({ accessToken: "old", refreshToken: "1//rt", expiresAt: null });
    fetchMock.mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(google.getGoogleAccessToken("org-1", "int-1")).rejects.toBeInstanceOf(ServiceError);
    expect(updates.find((u) => u.table === "integrations")?.payload).toEqual({ status: "needs_attention" });
  });
});

describe("revogação ao desconectar", () => {
  it("devolve o refresh token quando é a última linha daquele grant e revoga no Google", async () => {
    selectQueue.push({ provider: "google_business", metadata: { google_grant_id: "g-1" } }, []);
    getIntegrationToken.mockResolvedValue({ accessToken: "a", refreshToken: "1//rt", expiresAt: null });
    expect(await google.googleTokenToRevoke("org-1", "int-1")).toBe("1//rt");

    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await google.revokeGoogleToken("1//rt");
    expect(fetchMock).toHaveBeenCalledWith("https://oauth2.googleapis.com/revoke", expect.objectContaining({ method: "POST" }));
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("token")).toBe("1//rt");
  });

  it("não revoga se outro local ainda usa o mesmo grant", async () => {
    selectQueue.push({ provider: "google_business", metadata: { google_grant_id: "g-1" } }, [{ id: "int-2" }]);
    expect(await google.googleTokenToRevoke("org-1", "int-1")).toBeNull();
    expect(getIntegrationToken).not.toHaveBeenCalled();
  });

  it("ignora integrações que não são do Google", async () => {
    selectQueue.push({ provider: "instagram", metadata: {} });
    expect(await google.googleTokenToRevoke("org-1", "int-9")).toBeNull();
  });
});
