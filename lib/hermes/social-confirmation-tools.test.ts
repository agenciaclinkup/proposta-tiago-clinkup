import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";

const confirm = vi.fn();
const propose = vi.fn();
vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog: vi.fn() }));
vi.mock("@/lib/services/social-confirmations", () => ({ confirmSocialAction: confirm, proposeSocialWeek: vi.fn(), proposePublishNow: propose }));
const { buildHermesTools } = await import("./tools");
const ctx = { organizationId: "org", userId: "user", channel: "telegram", via: "hermes", planId: "starter" } as ServiceContext;
const proof = "a".repeat(32);
// Chama a Tool como o AI SDK faria, sem depender do tipo genérico de ToolExecutionOptions.
const run = (tools: ReturnType<typeof buildHermesTools>, name: string, input: unknown) => (tools[name] as unknown as { execute: (input: unknown, options: object) => Promise<unknown> }).execute(input, { toolCallId: "t", messages: [] });

describe("confirmações do calendário no Hermes", () => {
  beforeEach(() => { vi.clearAllMocks(); confirm.mockResolvedValue({ operation: "weekly", posts: [] }); });
  it("não aceita uma confirmação fornecida pelo modelo sem mensagem confiável", async () => {
    const tools = buildHermesTools(ctx, { conversationId: "conversation", proof: null });
    const result = await run(tools, "confirm_calendar_action", { proof });
    expect(result).toMatchObject({ ok: false });
    expect(confirm).not.toHaveBeenCalled();
  });
  it("usa somente a confirmação recebida do canal e preserva a conversa", async () => {
    const tools = buildHermesTools(ctx, { conversationId: "conversation", proof });
    await run(tools, "confirm_calendar_action", {});
    expect(confirm).toHaveBeenCalledWith(ctx, { conversationId: "conversation" }, proof);
  });
});
