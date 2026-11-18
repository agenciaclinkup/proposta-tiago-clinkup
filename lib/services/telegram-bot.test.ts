import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "./errors";

// Admin falso: devolve o bot configurado (ou nenhum) e registra exclusões com seus filtros.
let botRow: unknown = null;
const deletes: string[][] = [];
const chain = (filters: string[], data: () => unknown) => {
  const c = {
    eq: (col: string, val: unknown) => (filters.push(`${col}=${val}`), c),
    like: (col: string, val: unknown) => (filters.push(`${col}~${val}`), c),
    maybeSingle: async () => ({ data: data(), error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return c;
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => chain([], () => botRow),
      delete: () => {
        const filters: string[] = [];
        deletes.push(filters);
        return chain(filters, () => null);
      },
    }),
  }),
}));
const saveIntegration = vi.fn();
const getIntegrationToken = vi.fn();
vi.mock("./integrations", () => ({ saveIntegration, getIntegrationToken }));
const callTelegram = vi.fn();
vi.mock("@/lib/telegram/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram/telegram")>()),
  callTelegram,
}));

const { canUseOwnBot, connectOwnTelegramBot, disconnectOwnTelegramBot } = await import("./telegram-bot");

const token = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";
const ctx = { organizationId: "org-1", userId: "u-1", role: "owner" as const };
const org = { slug: "marca-x", plan_id: "scale", is_white_label: false };

beforeEach(() => {
  vi.clearAllMocks();
  botRow = null;
  deletes.length = 0;
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "segredo-mestre");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.clinkup.com.br");
  callTelegram.mockImplementation(async (_t: string, method: string) =>
    method === "getMe" ? { ok: true, result: { id: 555, is_bot: true, username: "marca_x_bot" } } : { ok: true, result: true },
  );
  saveIntegration.mockResolvedValue("int-bot");
  getIntegrationToken.mockResolvedValue({ accessToken: "old-token" });
});
afterEach(() => vi.unstubAllEnvs());

describe("canUseOwnBot", () => {
  it("libera só para Scale ou White-Label", () => {
    expect(canUseOwnBot({ plan_id: "scale", is_white_label: false })).toBe(true);
    expect(canUseOwnBot({ plan_id: "starter", is_white_label: true })).toBe(true);
    expect(canUseOwnBot({ plan_id: "growth", is_white_label: false })).toBe(false);
  });
});

describe("connectOwnTelegramBot", () => {
  it("valida com getMe, registra o webhook da empresa com segredo derivado e guarda o token cifrado", async () => {
    const { deriveBotWebhookSecret } = await import("@/lib/telegram/telegram");
    expect(await connectOwnTelegramBot(ctx, token, org)).toEqual({ username: "marca_x_bot" });
    expect(callTelegram).toHaveBeenCalledWith(token, "setWebhook", {
      url: "https://app.clinkup.com.br/api/webhooks/telegram/marca-x",
      secret_token: deriveBotWebhookSecret("marca-x"),
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        provider: "telegram_bot",
        externalAccountId: "555",
        displayName: "@marca_x_bot",
        accessToken: token,
      }),
    );
  });

  it("recusa member, plano sem direito e token que o Telegram não reconhece", async () => {
    await expect(connectOwnTelegramBot({ ...ctx, role: "member" as const }, token, org)).rejects.toBeInstanceOf(ServiceError);
    await expect(connectOwnTelegramBot(ctx, token, { ...org, plan_id: "growth" })).rejects.toBeInstanceOf(ServiceError);
    callTelegram.mockResolvedValueOnce({ ok: false, description: "Unauthorized" });
    await expect(connectOwnTelegramBot(ctx, token, org)).rejects.toBeInstanceOf(ServiceError);
    expect(saveIntegration).not.toHaveBeenCalled();
  });

  it("não salva se o Telegram recusar o webhook", async () => {
    callTelegram.mockImplementation(async (_t: string, method: string) =>
      method === "getMe" ? { ok: true, result: { id: 555, is_bot: true, username: "marca_x_bot" } } : { ok: false },
    );
    await expect(connectOwnTelegramBot(ctx, token, org)).rejects.toBeInstanceOf(ServiceError);
    expect(saveIntegration).not.toHaveBeenCalled();
  });

  it("exige endereço público https para registrar o webhook", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(connectOwnTelegramBot(ctx, token, org)).rejects.toBeInstanceOf(ServiceError);
  });

  it("troca de bot remove o anterior e os vínculos feitos por ele", async () => {
    botRow = { id: "int-old", external_account_id: "444", display_name: "@antigo_bot", metadata: { username: "antigo_bot" } };
    await connectOwnTelegramBot(ctx, token, org);
    expect(callTelegram).toHaveBeenCalledWith("old-token", "deleteWebhook");
    expect(deletes).toEqual(
      expect.arrayContaining([
        ["id=int-old", "organization_id=org-1"],
        ["organization_id=org-1", "provider=telegram", "external_account_id~444:%"],
      ]),
    );
  });
});

describe("disconnectOwnTelegramBot", () => {
  it("remove o bot e os vínculos dele (só owner/admin)", async () => {
    botRow = { id: "int-bot", external_account_id: "555", display_name: "@marca_x_bot", metadata: {} };
    await expect(disconnectOwnTelegramBot({ ...ctx, role: "member" as const })).rejects.toBeInstanceOf(ServiceError);
    await disconnectOwnTelegramBot(ctx);
    expect(deletes).toEqual(expect.arrayContaining([["organization_id=org-1", "provider=telegram", "external_account_id~555:%"]]));
  });
});
