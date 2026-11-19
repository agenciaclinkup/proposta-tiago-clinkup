import { beforeEach, describe, expect, it, vi } from "vitest";
const workspace = vi.fn();
const rateLimit = vi.fn();
const save = vi.fn();
const retry = vi.fn();
const signedUpload = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ createSignedUploadUrl: signedUpload }) } }) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: workspace }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMIT_MESSAGE: "Muitas tentativas.", RATE_LIMITS: { calendarUser: {} } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/services/social-posts", async (original) => ({ ...(await original<typeof import("@/lib/services/social-posts")>()), saveSocialPost: save, requestSocialRetry: retry }));
const { savePostAction, retryPostAction, prepareMediaUpload } = await import("./actions");
const post = { status: "draft", post: { format: "feed", caption: "Olá", hashtags: [], media: [], targets: [] } };
beforeEach(() => { vi.clearAllMocks(); workspace.mockResolvedValue({ supabase: {}, user: { id: "user" }, organization: { id: "org", plan_id: "starter" }, role: "member" }); rateLimit.mockResolvedValue(true); });
describe("savePostAction", () => {
  it("valida e chama serviço compartilhado com contexto manual", async () => {
    expect(await savePostAction(post)).toEqual({ success: true });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org", via: "manual" }), expect.objectContaining(post));
  });
  it("rejeita payload inválido e respeita limite de requisições", async () => {
    expect((await savePostAction({ ...post, status: "published" })).error).toBeTruthy();
    rateLimit.mockResolvedValue(false);
    expect((await savePostAction(post)).error).toBe("Muitas tentativas.");
    expect(save).not.toHaveBeenCalled();
  });
});
describe("retryPostAction", () => {
  it("exige confirmação explícita e utiliza o contexto da empresa", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await retryPostAction({ postId: id, integrationId: id, confirmed: false })).error).toBeTruthy();
    expect(retry).not.toHaveBeenCalled();
    expect((await retryPostAction({ postId: id, integrationId: id, confirmed: true })).success).toBe(true);
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org", userId: "user", via: "manual" }), { postId: id, integrationId: id, confirmed: true });
  });
});
describe("prepareMediaUpload", () => {
  it("assina somente caminho gerado para a organização", async () => {
    signedUpload.mockResolvedValue({ data: { token: "token" }, error: null });
    const result = await prepareMediaUpload({ type: "image/png", size: 100 });
    expect(result.path).toMatch(/^org\/[0-9a-f-]+\.png$/);
    expect(signedUpload).toHaveBeenCalledWith(result.path);
  });
  it("bloqueia formato e tamanho inválidos", async () => {
    expect((await prepareMediaUpload({ type: "text/html", size: 5 })).error).toBeTruthy();
    expect((await prepareMediaUpload({ type: "video/mp4", size: 52_428_801 })).error).toBeTruthy();
    expect(signedUpload).not.toHaveBeenCalled();
  });
});
