import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), token: vi.fn(), publish: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/services/integrations", () => ({ getIntegrationToken: mocks.token }));
vi.mock("@/lib/integrations/google", () => ({ getGoogleAccessToken: vi.fn(), resolveGoogleBusinessLocation: vi.fn() }));
vi.mock("@/lib/integrations/social-publish", () => ({ publishFacebook: mocks.publish, publishInstagram: vi.fn(), publishGoogle: vi.fn(), checkPublishedStatus: mocks.check }));
const { reconcileSocialPublications, runSocialPublishBatch } = await import("./social-publish-worker");
const post = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
const integration = "33333333-3333-4333-8333-333333333333";
const lease = "44444444-4444-4444-8444-444444444444";
const filters: [string, unknown][] = [];
beforeEach(() => {
  vi.clearAllMocks(); filters.length = 0;
  mocks.rpc.mockImplementation(async (name: string) => name === "claim_social_posts" ? { data: [{ id: post, organization_id: org, lease_token: lease }], error: null } : { data: true, error: null });
  mocks.from.mockImplementation((table: string) => {
    const result = table === "social_posts" ? { format: "feed", caption: "Oi", hashtags: ["#marca"], media: [] } : table === "social_post_targets" ? [{ channel: "facebook", integration_id: integration }] : { provider: "facebook_page", status: "connected", external_account_id: "123" };
    const builder = { select: () => builder, eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; }, order: async () => ({ data: result, error: null }), single: async () => ({ data: result, error: null }), maybeSingle: async () => ({ data: result, error: null }) };
    return builder;
  });
  mocks.token.mockResolvedValue({ accessToken: "secreto" }); mocks.publish.mockResolvedValue("external-id");
});
describe("worker de publicações", () => {
  it("filtra por organização, utiliza token do destino e registra o resultado", async () => {
    expect(await runSocialPublishBatch()).toEqual({ claimed: 1, processed: 1 });
    expect(filters.filter(([key]) => key === "organization_id").every(([, value]) => value === org)).toBe(true);
    expect(mocks.token).toHaveBeenCalledWith(org, integration);
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ accountId: "123", caption: "Oi\n\n#marca" }));
    expect(mocks.rpc).toHaveBeenCalledWith("finish_social_target", expect.objectContaining({ p_org: org, p_lease: lease, p_result: "published", p_external_id: "external-id" }));
  });
  it("falha temporária antes de chamar provedor solicita retry seguro", async () => {
    mocks.token.mockRejectedValueOnce(new Error("serviço indisponível"));
    await runSocialPublishBatch();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("finish_social_target", expect.objectContaining({ p_result: "retry", p_external_id: null }));
  });
  it("reconcilia resultado por leitura sem reenviar a publicação", async () => {
    mocks.check.mockResolvedValue("published");
    mocks.from.mockImplementation((table: string) => {
      const value = table === "social_post_targets" ? [{ post_id: post, organization_id: org, integration_id: integration, channel: "facebook", external_id: "123" }] : { provider: "facebook_page", status: "connected" };
      const builder = { select: () => builder, eq: () => builder, not: () => builder, in: () => builder, order: () => builder, limit: async () => ({ data: value, error: null }), maybeSingle: async () => ({ data: value, error: null }) };
      return builder;
    });
    expect(await reconcileSocialPublications()).toEqual({ checked: 1 });
    expect(mocks.check).toHaveBeenCalledWith("facebook", "123", "secreto");
    expect(mocks.rpc).toHaveBeenCalledWith("reconcile_social_target", expect.objectContaining({ p_org: org, p_result: "published" }));
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
