import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/vault";
import { ServiceError } from "./errors";

// Cliente admin falso: registra o que foi gravado em cada tabela e devolve respostas configuráveis.
const writes: Record<string, unknown[]> = {};
let secretRow: unknown = null;
const inserts: unknown[] = [];
let linkRows: unknown[] = [];
const deletes: { table: string; filters: string[] }[] = [];
// Encadeia filtros (.eq/.neq) e resolve como uma query do supabase-js.
const filterChain = (filters: string[], result: () => unknown) => {
  const chain = {
    eq: (column: string, value: unknown) => (filters.push(`${column}=${value}`), chain),
    neq: (column: string, value: unknown) => (filters.push(`${column}!=${value}`), chain),
    maybeSingle: async () => ({ data: result(), error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  return chain;
};
const admin = {
  rpc: async () => ({ data: linkRows, error: null }),
  from: (table: string) => ({
    delete: () => {
      const entry = { table, filters: [] as string[] };
      deletes.push(entry);
      return filterChain(entry.filters, () => null);
    },
    insert: async (payload: unknown) => {
      inserts.push(payload);
      return { error: null };
    },
    upsert: (payload: unknown) => {
      (writes[table] ??= []).push(payload);
      return table === "integrations"
        ? { select: () => ({ single: async () => ({ data: { id: "int-1" }, error: null }) }) }
        : Promise.resolve({ error: null });
    },
    select: () => filterChain([], () => secretRow),
  }),
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const {
  createTelegramLinkCode,
  findTelegramLink,
  getIntegrationToken,
  LINK_CODE_ALPHABET,
  linkTelegramChat,
  saveIntegration,
  summarizeIntegrations,
} = await import("./integrations");

beforeEach(() => {
  vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  for (const key of Object.keys(writes)) delete writes[key];
  secretRow = null;
  linkRows = [];
  deletes.length = 0;
});

describe("linkTelegramChat", () => {
  it("vincula o chat à org do código e remove vínculos do mesmo chat em outras orgs", async () => {
    linkRows = [{ organization_id: "org-1", user_id: "u-1" }];
    expect(await linkTelegramChat("ABCD2345", { chatId: 777, displayName: "@ana" })).toEqual(linkRows[0]);
    expect(deletes).toEqual([
      { table: "integrations", filters: ["provider=telegram", "external_account_id=777", "organization_id!=org-1"] },
    ]);
    expect(writes.integrations[0]).toMatchObject({
      organization_id: "org-1",
      provider: "telegram",
      external_account_id: "777",
      display_name: "@ana",
      metadata: { user_id: "u-1" },
    });
    expect(writes.integration_secrets).toBeUndefined();
  });

  it("não grava nada com código inválido, usado ou expirado", async () => {
    expect(await linkTelegramChat("ABCD2345", { chatId: 777, displayName: null })).toBeNull();
    expect(deletes).toHaveLength(0);
    expect(writes.integrations).toBeUndefined();
  });
});

describe("findTelegramLink", () => {
  it("traduz o chat vinculado em org e usuário", async () => {
    secretRow = { id: "int-9", organization_id: "org-1", metadata: { user_id: "u-1" } };
    expect(await findTelegramLink(777)).toEqual({ integrationId: "int-9", organizationId: "org-1", userId: "u-1" });
  });

  it("ignora vínculo sem usuário", async () => {
    secretRow = { id: "int-9", organization_id: "org-1", metadata: {} };
    expect(await findTelegramLink(777)).toBeNull();
  });
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

describe("saveIntegration sem token", () => {
  it("não grava segredo quando a integração não tem token (vínculo do bot da plataforma)", async () => {
    await saveIntegration({ organizationId: "org-1", provider: "telegram", externalAccountId: "99", metadata: { user_id: "u-1" } });
    expect(writes.integrations).toHaveLength(1);
    expect(writes.integration_secrets).toBeUndefined();
  });
});

describe("createTelegramLinkCode", () => {
  it("gera código de 8 caracteres sem letras ambíguas, do usuário e da org do contexto", async () => {
    inserts.length = 0;
    const { code, expiresAt } = await createTelegramLinkCode({ organizationId: "org-1", userId: "u-1" });
    expect(code).toMatch(new RegExp(`^[${LINK_CODE_ALPHABET}]{8}$`));
    expect(LINK_CODE_ALPHABET).not.toMatch(/[01IO]/);
    expect(inserts[0]).toMatchObject({ code, organization_id: "org-1", user_id: "u-1" });
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it("gera códigos diferentes a cada chamada", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add((await createTelegramLinkCode({ organizationId: "org-1", userId: "u-1" })).code);
    expect(codes.size).toBe(20);
  });
});
