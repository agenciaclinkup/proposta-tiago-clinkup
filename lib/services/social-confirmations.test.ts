import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";

const rpc = vi.fn();
const runClaim = vi.fn();
const insert = vi.fn();
const getSocialPost = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { user_id: "user" }, error: null }), insert }; return query; } }) }));
vi.mock("./social-posts", async (original) => ({ ...(await original<typeof import("./social-posts")>()), getSocialPost }));
vi.mock("./social-publish-worker", () => ({ runClaim }));
const { confirmSocialAction, proposeScheduledPost } = await import("./social-confirmations");
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

describe("agendamento confirmado de rascunho", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const integrationId = "22222222-2222-4222-8222-222222222222";
  const owned = { ...ctx, organizationId: org, channel: "telegram" } as ServiceContext;
  const draft = { id: "post", status: "draft", updated_at: "2026-11-19T10:00:00Z", format: "carousel", caption: "Olá", hashtags: [], media: [{ path: `${org}/a.png`, type: "image" }, { path: `${org}/b.png`, type: "image" }], social_post_targets: [] };
  const schedule = { postId: "post", scheduledAt: "2031-01-01T12:00:00-03:00", targets: [{ channel: "instagram" as const, integrationId }] };
  beforeEach(() => { vi.clearAllMocks(); insert.mockResolvedValue({ error: null }); getSocialPost.mockResolvedValue(draft); });
  it("grava proposta vinculada ao post e à versão, sem expor o código no banco", async () => {
    const result = await proposeScheduledPost(owned, { conversationId: "conversation" }, schedule);
    expect(result.code).toMatch(/^[0-9a-f]{32}$/);
    const row = insert.mock.calls[0]?.[0];
    expect(row).toMatchObject({ organization_id: org, user_id: "user", channel: "telegram", conversation_id: "conversation", operation: "schedule_post", payload: { postId: "post", updatedAt: draft.updated_at, post: { format: "carousel", scheduled_at: schedule.scheduledAt, targets: [{ channel: "instagram", integration_id: integrationId }] } } });
    expect(JSON.stringify(row)).not.toContain(result.code);
  });
  it("aceita somente rascunhos e valida as regras do canal antes de propor", async () => {
    getSocialPost.mockResolvedValueOnce({ ...draft, status: "scheduled" });
    await expect(proposeScheduledPost(owned, { conversationId: null }, schedule)).rejects.toThrow("rascunho");
    getSocialPost.mockResolvedValueOnce({ ...draft, format: "carousel", media: [draft.media[0]] });
    await expect(proposeScheduledPost(owned, { conversationId: null }, schedule)).rejects.toBeInstanceOf(Error);
    expect(insert).not.toHaveBeenCalled();
  });
  it("devolve o post agendado pela confirmação", async () => {
    rpc.mockResolvedValue({ data: { operation: "schedule_post", post: { id: "post", status: "scheduled" } }, error: null });
    expect(await confirmSocialAction(owned, { conversationId: null }, "a".repeat(32))).toEqual({ operation: "schedule_post", post: { id: "post", status: "scheduled" } });
    expect(runClaim).not.toHaveBeenCalled();
  });
});
