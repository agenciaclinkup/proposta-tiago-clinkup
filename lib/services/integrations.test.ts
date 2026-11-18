import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/vault";
import { ServiceError } from "./errors";

// Cliente admin falso: registra o que foi gravado em cada tabela e devolve respostas configuráveis.
const writes: Record<string, unknown[]> = {};
let secretRow: unknown = null;
const admin = {
  from: (table: string) => ({
    upsert: (payload: unknown) => {
      (writes[table] ??= []).push(payload);
      return table === "integrations"
        ? { select: () => ({ single: async () => ({ data: { id: "int-1" }, error: null }) }) }
        : Promise.resolve({ error: null });
    },
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: secretRow, error: null }) }) }) }),
  }),
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const { getIntegrationToken, saveIntegration, summarizeIntegrations } = await import("./integrations");

beforeEach(() => {
  vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  for (const key of Object.keys(writes)) delete writes[key];
  secretRow = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("saveIntegration", () => {
  it("grava a conexão sem tokens e cifra os tokens presos ao id da integração", async () => {
    const id = await saveIntegration({
      organizationId: "org-1",
      provider: "instagram",
      externalAccountId: "ig-123",
      displayName: "@clinkup",
      accessToken: "EAAG-access",
      refreshToken: "EAAG-refresh",
    });
    expect(id).toBe("int-1");

    const integrationRow = JSON.stringify(writes.integrations);
    expect(integrationRow).not.toContain("EAAG");

    const secret = writes.integration_secrets[0] as Record<string, string>;
    expect(JSON.stringify(secret)).not.toContain("EAAG");
    expect(decryptSecret(secret.access_token_encrypted, "int-1")).toBe("EAAG-access");
    expect(decryptSecret(secret.refresh_token_encrypted, "int-1")).toBe("EAAG-refresh");
    expect(() => decryptSecret(secret.access_token_encrypted, "int-2")).toThrow();
  });
});

describe("getIntegrationToken", () => {
  it("decifra o token só no servidor", async () => {
    secretRow = { access_token_encrypted: encryptSecret("tok", "int-1"), refresh_token_encrypted: null, expires_at: null };
    await expect(getIntegrationToken("org-1", "int-1")).resolves.toEqual({ accessToken: "tok", refreshToken: null, expiresAt: null });
  });

  it("orienta reconectar quando não há segredo para a org", async () => {
    await expect(getIntegrationToken("org-1", "int-x")).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("summarizeIntegrations", () => {
  it("mostra todos os provedores com status para o usuário", () => {
    const summary = summarizeIntegrations([
      { provider: "instagram", status: "connected", display_name: "@clinkup", external_account_id: "ig-1" },
      { provider: "meta_ads", status: "needs_attention", display_name: null, external_account_id: "act_9" },
    ]);
    const byProvider = Object.fromEntries(summary.map((item) => [item.provider, item]));
    expect(byProvider.instagram).toMatchObject({ status: "connected", accounts: ["@clinkup"] });
    expect(byProvider.meta_ads).toMatchObject({ status: "needs_attention", accounts: ["act_9"] });
    expect(byProvider.telegram).toMatchObject({ status: "not_connected", accounts: [] });
    expect(summary).toHaveLength(6);
  });
});
