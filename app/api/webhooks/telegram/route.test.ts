import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleTelegramMessage = vi.fn();
vi.mock("@/lib/telegram/handler", () => ({ handleTelegramMessage }));
const scheduled: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => scheduled.push(task()),
}));

const { POST } = await import("./route");

const update = { update_id: 5, message: { message_id: 1, chat: { id: 9, type: "private" }, text: "oi" } };
const post = (body: unknown, secret?: string) =>
  POST(
    new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  scheduled.length = 0;
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "segredo-do-webhook");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/webhooks/telegram", () => {
  it("rejeita sem o segredo do bot", async () => {
    expect((await post(update)).status).toBe(401);
    expect((await post(update, "errado")).status).toBe(401);
    expect(handleTelegramMessage).not.toHaveBeenCalled();
  });

  it("responde 200 e ignora payload inválido ou sem mensagem (Telegram não reenvia)", async () => {
    expect((await post("{lixo", "segredo-do-webhook")).status).toBe(200);
    expect((await post({ update_id: 6 }, "segredo-do-webhook")).status).toBe(200);
    expect(handleTelegramMessage).not.toHaveBeenCalled();
  });

  it("responde 200 na hora e processa a mensagem depois da resposta", async () => {
    const res = await post(update, "segredo-do-webhook");
    expect(res.status).toBe(200);
    await Promise.all(scheduled);
    expect(handleTelegramMessage).toHaveBeenCalledWith("123:abc", 5, expect.objectContaining({ text: "oi" }));
  });

  it("falha fechado se o servidor não tiver segredo configurado", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await post(update, "")).status).toBe(401);
  });
});
