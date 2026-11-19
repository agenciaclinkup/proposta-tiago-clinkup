import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { saveSocialPost, socialPostSchema } from "./social-posts";

const id = "11111111-1111-4111-8111-111111111111";
const ctx = { organizationId: id, userId: id, via: "hermes", planId: "starter" } as ServiceContext;
const post = { format: "feed", caption: "Olá", hashtags: [], media: [], targets: [{ channel: "instagram", integrationId: id }], scheduledAt: "2030-01-01T12:00:00Z" } as const;
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: { id }, error: null }); });
describe("social posts", () => {
  it("envia contexto, destino e limite do plano para a transação", async () => {
    await saveSocialPost(ctx, { status: "scheduled", post: socialPostSchema.parse(post) });
    expect(rpc).toHaveBeenCalledWith("save_social_post", expect.objectContaining({ p_organization_id: id, p_user_id: id, p_via: "hermes", p_status: "scheduled", p_limit: 30, p_payload: expect.objectContaining({ targets: [{ channel: "instagram", integration_id: id }] }) }));
  });
  it("rejeita canais repetidos e datas sem fuso", () => {
    expect(socialPostSchema.safeParse({ ...post, targets: [post.targets[0], post.targets[0]] }).success).toBe(false);
    expect(socialPostSchema.safeParse({ ...post, scheduledAt: "2030-01-01T12:00" }).success).toBe(false);
  });
  it("traduz limite e integração inválida sem expor erro interno", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "social_limit_reached:30" } });
    await expect(saveSocialPost(ctx, { status: "scheduled", post: socialPostSchema.parse(post) })).rejects.toThrow("limite");
    rpc.mockResolvedValueOnce({ error: { message: "social_integration_invalid" } });
    await expect(saveSocialPost(ctx, { status: "scheduled", post: socialPostSchema.parse(post) })).rejects.toThrow("integração");
  });
  it("recusa caminho de mídia de outra empresa antes de gravar", async () => {
    await expect(saveSocialPost(ctx, { status: "draft", post: socialPostSchema.parse({ ...post, media: [{ path: "outra-empresa/arquivo.jpg", type: "image" }] }) })).rejects.toThrow("pertencer à sua empresa");
    expect(rpc).not.toHaveBeenCalled();
  });
});
