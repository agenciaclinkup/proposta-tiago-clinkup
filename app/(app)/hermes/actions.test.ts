import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const requireWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { hermesDeleteUser: {} }, RATE_LIMIT_MESSAGE: "Muitas tentativas." }));
const deleteConversation = vi.fn();
vi.mock("@/lib/services/conversations", () => ({ deleteConversation }));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { deleteConversationAction } = await import("./actions");

const id = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
const form = (value: string) => {
  const data = new FormData();
  data.set("conversationId", value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspace.mockResolvedValue({ supabase: {}, user: { id: "u-1" }, organization: { id: "org-1", plan_id: "starter" } });
  rateLimit.mockResolvedValue(true);
  deleteConversation.mockResolvedValue(undefined);
});

describe("deleteConversationAction", () => {
  it("valida o id com Zod antes de tocar no banco", async () => {
    expect(await deleteConversationAction(undefined, form("abc"))).toEqual({ error: expect.any(String) });
    expect(deleteConversation).not.toHaveBeenCalled();
  });

  it("aplica rate limit por usuário", async () => {
    rateLimit.mockResolvedValue(false);
    expect(await deleteConversationAction(undefined, form(id))).toEqual({ error: "Muitas tentativas." });
    expect(rateLimit).toHaveBeenCalledWith("hermes-delete:user:u-1", expect.anything());
  });

  it("exclui pelo service (RLS) e volta para uma conversa nova", async () => {
    await expect(deleteConversationAction(undefined, form(id))).rejects.toThrow("REDIRECT:/hermes");
    expect(deleteConversation).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }), id);
  });

  it("mostra a mensagem quando a conversa não pertence ao usuário", async () => {
    deleteConversation.mockRejectedValue(new ServiceError("Não encontramos esta conversa."));
    expect(await deleteConversationAction(undefined, form(id))).toEqual({ error: "Não encontramos esta conversa." });
  });
});
