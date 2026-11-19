import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";

const rpc = vi.fn();
const runClaim = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("./social-publish-worker", () => ({ runClaim }));
const { confirmSocialAction } = await import("./social-confirmations");
const ctx = { organizationId: "org", userId: "user", channel: "web", via: "manual", planId: "starter" } as ServiceContext;

describe("confirmação social", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("não aceita prova inválida ou apenas um sinalizador de confirmação", async () => {
    await expect(confirmSocialAction(ctx, { conversationId: null }, "true")).rejects.toThrow("inválida");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("envia o hash, o vínculo e o limite à transação e usa o publicador compartilhado", async () => {
    const snapshot = { account: { account: "external", provider: "facebook_page", status: "connected" } };
    rpc.mockResolvedValue({ data: { operation: "publish_now", postId: "post", organizationId: "org", leaseToken: "lease", integrationSnapshot: snapshot }, error: null });
    runClaim.mockResolvedValue(true);
    await confirmSocialAction(ctx, { conversationId: null }, "a".repeat(32));
    expect(rpc).toHaveBeenCalledWith("confirm_social_action", expect.objectContaining({ p_org: "org", p_user: "user", p_channel: "web", p_conversation: null, p_limit: 30, p_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
    expect(runClaim).toHaveBeenCalledWith({ id: "post", organizationId: "org", leaseToken: "lease" }, snapshot);
  });
  it("não despacha quando a transação recusa a confirmação", async () => {
    rpc.mockResolvedValue({ error: { message: "confirmation_invalid" } });
    await expect(confirmSocialAction(ctx, { conversationId: null }, "a".repeat(32))).rejects.toThrow("expirou");
    expect(runClaim).not.toHaveBeenCalled();
  });
});
