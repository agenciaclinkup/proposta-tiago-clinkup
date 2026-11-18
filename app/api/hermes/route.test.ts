import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const loadWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({ loadWorkspace }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { hermesChatUser: {} }, RATE_LIMIT_MESSAGE: "Muitas tentativas." }));
const ensureConversation = vi.fn();
const loadConversationMessages = vi.fn();
vi.mock("@/lib/services/conversations", () => ({ ensureConversation, loadConversationMessages, saveConversationMessages: vi.fn() }));
vi.mock("@/lib/services/brand", () => ({ getBrandContext: vi.fn().mockResolvedValue({ master_context: "Empresa: Clinkup" }) }));
const consumeUsage = vi.fn();
const refundUsage = vi.fn();
vi.mock("@/lib/services/usage", async () => {
  const { ServiceError: Base } = await import("@/lib/services/errors");
  class PlanLimitError extends Base {}
  return { consumeUsage, refundUsage, PlanLimitError };
});
vi.mock("@/lib/hermes/tools", () => ({ buildHermesTools: () => ({ get_brand_context: {} }) }));
const streamText = vi.fn();
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), streamText }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: (id: string) => ({ id }) }));

const { POST } = await import("./route");
const { PlanLimitError } = (await import("@/lib/services/usage")) as unknown as { PlanLimitError: new (m: string) => Error };

const conversationId = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
const body = { conversationId, message: { id: "m-new", role: "user", parts: [{ type: "text", text: "Qual é o meu plano?" }] } };
const post = (payload: unknown) =>
  POST(new Request("http://localhost/api/hermes", { method: "POST", body: JSON.stringify(payload) }) as never);
const workspace = {
  supabase: {},
  user: { id: "u-1" },
  profile: { full_name: "Ana Souza" },
  organization: { id: "org-1", name: "Clinkup", plan_id: "starter" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  loadWorkspace.mockResolvedValue({ status: "ok", workspace });
  rateLimit.mockResolvedValue(true);
  ensureConversation.mockResolvedValue(undefined);
  consumeUsage.mockResolvedValue({ used: 1, limit: 500 });
  loadConversationMessages.mockResolvedValue([{ id: "m-old", role: "user", parts: [{ type: "text", text: "Oi" }] }]);
  refundUsage.mockResolvedValue(undefined);
  streamText.mockReturnValue({
    toUIMessageStreamResponse: (options: StreamOptions) => {
      streamOptions = options;
      return new Response("stream");
    },
  });
});

type StreamOptions = {
  onError: (error: unknown) => string;
  onEnd: (event: { messages: unknown[]; outcome: { status: string } }) => Promise<void>;
};
let streamOptions: StreamOptions;

describe("estorno do crédito de IA", () => {
  it("estorna uma única vez quando o streaming falha", async () => {
    await post(body);
    expect(streamOptions.onError(new Error("overloaded"))).toContain("Tente enviar a mensagem novamente");
    await streamOptions.onEnd({ messages: [], outcome: { status: "failed" } });
    expect(refundUsage).toHaveBeenCalledTimes(1);
    expect(refundUsage).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }), "ai_credits", 1);
  });

  it("não estorna quando a resposta conclui ou o usuário interrompe", async () => {
    await post(body);
    await streamOptions.onEnd({ messages: [], outcome: { status: "completed" } });
    await post(body);
    await streamOptions.onEnd({ messages: [], outcome: { status: "aborted" } });
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("estorna quando falha ao preparar a conversa depois de cobrar", async () => {
    loadConversationMessages.mockRejectedValue(new Error("db down"));
    expect((await post(body)).status).toBe(500);
    expect(refundUsage).toHaveBeenCalledTimes(1);
  });

  it("não estorna quando o limite do plano impediu a cobrança", async () => {
    consumeUsage.mockRejectedValue(new PlanLimitError("Limite atingido."));
    await post(body);
    expect(refundUsage).not.toHaveBeenCalled();
  });
});

describe("POST /api/hermes", () => {
  it("exige sessão", async () => {
    loadWorkspace.mockResolvedValue({ status: "unauthenticated" });
    expect((await post(body)).status).toBe(401);
  });

  it("exige onboarding concluído", async () => {
    loadWorkspace.mockResolvedValue({ status: "onboarding" });
    expect((await post(body)).status).toBe(403);
  });

  it("valida o corpo com Zod", async () => {
    const res = await post({ conversationId, message: { ...body.message, role: "assistant" } });
    expect(res.status).toBe(400);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("aplica rate limit por usuário", async () => {
    rateLimit.mockResolvedValue(false);
    expect((await post(body)).status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("hermes:user:u-1", expect.anything());
  });

  it("responde 402 quando o limite de créditos do plano acabou", async () => {
    consumeUsage.mockRejectedValue(new PlanLimitError("Você atingiu o limite de créditos de IA."));
    const res = await post(body);
    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain("limite");
  });

  it("responde 404 quando a conversa pertence a outra pessoa", async () => {
    ensureConversation.mockRejectedValue(new ServiceError("Não encontramos esta conversa."));
    expect((await post(body)).status).toBe(404);
    expect(consumeUsage).not.toHaveBeenCalled();
  });

  it("envia ao modelo o histórico do banco + a mensagem nova, com Tools e Contexto Mestre", async () => {
    expect((await post(body)).status).toBe(200);
    const args = streamText.mock.calls[0][0];
    expect(args.model).toEqual({ id: "claude-opus-5-5" });
    expect(args.system).toContain("Empresa: Clinkup");
    expect(Object.keys(args.tools)).toEqual(["get_brand_context"]);
    expect(JSON.stringify(args.messages)).toContain("Oi");
    expect(JSON.stringify(args.messages)).toContain("Qual é o meu plano?");
    expect(consumeUsage).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", via: "hermes" }), "ai_credits", 1);
  });
});
