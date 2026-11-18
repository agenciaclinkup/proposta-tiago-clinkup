import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleTelegramMessage = vi.fn();
vi.mock("@/lib/telegram/handler", () => ({ handleTelegramMessage }));
const scheduled: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => scheduled.push(task()),
}));
const findOrganizationBySlug = vi.fn();
const getOwnTelegramBot = vi.fn();
vi.mock("@/lib/services/telegram-bot", () => ({ findOrganizationBySlug, getOwnTelegramBot }));
const getIntegrationToken = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ getIntegrationToken }));

const { POST } = await import("./route");
const { deriveBotWebhookSecret } = await import("@/lib/telegram/telegram");

const update = { update_id: 5, message: { message_id: 1, chat: { id: 9, type: "private" }, text: "oi" } };
const post = (slug: string, secret?: string) =>
  POST(
    new Request(`http://localhost/api/webhooks/telegram/${slug}`, {
      method: "POST",
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      body: JSON.stringify(update),
    }) as never,
    { params: Promise.resolve({ slug }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  scheduled.length = 0;
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "segredo-mestre");
  findOrganizationBySlug.mockResolvedValue({ id: "org-1" });
  getOwnTelegramBot.mockResolvedValue({ integrationId: "int-bot", botId: "555", username: "marca_x_bot" });
  getIntegrationToken.mockResolvedValue({ accessToken: "org-token" });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/webhooks/telegram/[slug]", () => {
  it("rejeita sem segredo, com segredo da plataforma ou de outra empresa — antes de consultar o banco", async () => {
    expect((await post("marca-x")).status).toBe(401);
    expect((await post("marca-x", "segredo-mestre")).status).toBe(401);
    expect((await post("marca-x", deriveBotWebhookSecret("outra-empresa"))).status).toBe(401);
    expect(findOrganizationBySlug).not.toHaveBeenCalled();
  });

  it("404 para slug inválido, empresa inexistente ou sem bot próprio", async () => {
    expect((await post("../x", "qualquer")).status).toBe(404);
    findOrganizationBySlug.mockResolvedValueOnce(null);
    expect((await post("marca-x", deriveBotWebhookSecret("marca-x"))).status).toBe(404);
    getOwnTelegramBot.mockResolvedValueOnce(null);
    expect((await post("marca-x", deriveBotWebhookSecret("marca-x"))).status).toBe(404);
    expect(handleTelegramMessage).not.toHaveBeenCalled();
  });

  it("processa com o token do bot da empresa e escopo restrito a ela", async () => {
    expect((await post("marca-x", deriveBotWebhookSecret("marca-x"))).status).toBe(200);
    await Promise.all(scheduled);
    expect(getIntegrationToken).toHaveBeenCalledWith("org-1", "int-bot");
    expect(handleTelegramMessage).toHaveBeenCalledWith("org-token", 5, expect.objectContaining({ text: "oi" }), {
      organizationId: "org-1",
      botId: "555",
    });
  });
});
