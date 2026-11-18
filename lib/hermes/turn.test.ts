import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";

const consumeUsage = vi.fn();
const refundUsage = vi.fn();
vi.mock("@/lib/services/usage", async () => {
  const { ServiceError } = await import("@/lib/services/errors");
  class PlanLimitError extends ServiceError {}
  return { consumeUsage, refundUsage, PlanLimitError };
});
const loadConversationMessages = vi.fn();
const saveConversationMessages = vi.fn();
vi.mock("@/lib/services/conversations", () => ({ loadConversationMessages, saveConversationMessages }));
vi.mock("@/lib/services/brand", () => ({ getBrandContext: vi.fn().mockResolvedValue({ master_context: "Empresa: Clinkup" }) }));
vi.mock("@/lib/hermes/tools", () => ({ buildHermesTools: (ctx: ServiceContext) => ({ get_brand_context: { channel: ctx.channel } }) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: (id: string) => ({ id }) }));

const { startHermesTurn } = await import("./turn");
const { PlanLimitError } = (await import("@/lib/services/usage")) as unknown as { PlanLimitError: new (m: string) => Error };

const ctx = { organizationId: "org-1", userId: "u-1", channel: "telegram", via: "hermes", role: "member" } as ServiceContext;
const input = {
  conversationId: "conv-1",
  userMessage: { id: "m-new", role: "user" as const, parts: [{ type: "text" as const, text: "Qual é o meu plano?" }] },
  organizationName: "Clinkup",
  userName: "Ana",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  consumeUsage.mockResolvedValue({ used: 1, limit: 500 });
  refundUsage.mockResolvedValue(undefined);
  loadConversationMessages.mockResolvedValue([{ id: "m-old", role: "user", parts: [{ type: "text", text: "Oi" }] }]);
  saveConversationMessages.mockResolvedValue(undefined);
});

describe("startHermesTurn", () => {
  it("cobra 1 crédito e monta o mesmo modelo, prompt e Tools para qualquer canal", async () => {
    const turn = await startHermesTurn(ctx, input);
    expect(consumeUsage).toHaveBeenCalledWith(ctx, "ai_credits", 1);
    expect(turn.settings.model).toEqual({ id: "claude-opus-5-5" });
    expect(turn.settings.system).toContain("Empresa: Clinkup");
    expect(turn.settings.tools).toEqual({ get_brand_context: { channel: "telegram" } });
    expect(JSON.stringify(turn.settings.messages)).toContain("Oi");
    expect(turn.messages.map((m) => m.id)).toEqual(["m-old", "m-new"]);
  });

  it("estorna no máximo uma vez", async () => {
    const turn = await startHermesTurn(ctx, input);
    turn.refund();
    turn.refund();
    expect(refundUsage).toHaveBeenCalledTimes(1);
  });

  it("estorna e propaga o erro se falhar depois de cobrar", async () => {
    loadConversationMessages.mockRejectedValue(new Error("db down"));
    await expect(startHermesTurn(ctx, input)).rejects.toThrow("db down");
    expect(refundUsage).toHaveBeenCalledTimes(1);
  });

  it("não estorna quando o limite do plano impediu a cobrança", async () => {
    consumeUsage.mockRejectedValue(new PlanLimitError("Limite atingido."));
    await expect(startHermesTurn(ctx, input)).rejects.toBeInstanceOf(PlanLimitError);
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("salva só as mensagens novas do turno", async () => {
    const turn = await startHermesTurn(ctx, input);
    await turn.persist([...turn.messages, { id: "resp", role: "assistant", parts: [{ type: "text", text: "Starter" }] }]);
    expect(saveConversationMessages.mock.calls[0][2].map((m: { id: string }) => m.id)).toEqual(["m-new", "resp"]);
  });
});
