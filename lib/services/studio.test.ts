import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";
const rpc = vi.fn();
const membership = vi.fn();
const signedUrl = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => { const query = { select: () => query, eq: () => query, maybeSingle: membership }; return query; }, storage: { from: () => ({ createSignedUrl: signedUrl }) } }) }));
const { saveCarousel, beginStudioGeneration, saveLandingPage, getStudioAssetUrl, finishStudioGeneration, listCarousels } = await import("./studio");
const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const ctx = { organizationId: org, userId: user, planId: "starter", via: "hermes", channel: "telegram" } as ServiceContext;
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: { id: user }, error: null }); });

describe("serviço compartilhado do Estúdio", () => {
  it("valida slides e envia a empresa, o usuário e o canal de criação", async () => {
    await saveCarousel(ctx, { title: "Lançamento", status: "draft", theme: { primaryColor: "#00D4FF" }, slides: [{ role: "hook", heading: "Olá", body: "Conteúdo", imagePath: null }] });
    expect(rpc).toHaveBeenCalledWith("save_studio_carousel", expect.objectContaining({ p_org: org, p_user: user, p_via: "hermes" }));
  });
  it("recusa imagens de outras empresas antes de gravar", async () => {
    await expect(saveCarousel(ctx, { title: "Post", status: "draft", theme: {}, slides: [{ role: "hook", heading: "Oi", body: "", imagePath: `${user}/image.png` }] })).rejects.toThrow("empresa");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("usa a cota mensal existente e uma chave idempotente para geração", async () => {
    await beginStudioGeneration(ctx, { requestId: user, carouselId: user, kind: "carousel", prompt: "Crie uma campanha" });
    expect(rpc).toHaveBeenCalledWith("begin_studio_generation", expect.objectContaining({ p_org: org, p_user: user, p_request_id: user, p_limit: 500 }));
  });
  it("traduz limite de créditos e não solicita outra cobrança", async () => {
    rpc.mockResolvedValue({ error: { message: "studio_limit_reached:500" } });
    await expect(beginStudioGeneration(ctx, { requestId: user, carouselId: user, kind: "carousel", prompt: "Crie uma campanha" })).rejects.toThrow("limite");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("valida o slug antes de salvar uma landing page", async () => {
    await expect(saveLandingPage(ctx, { title: "Página", slug: "Página inválida!", sections: [], pipelineId: null, stageId: null, published: false })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("impede criar URL assinada para assets de outra empresa ou caminhos inválidos", async () => {
    await expect(getStudioAssetUrl(ctx, `${user}/image.png`)).rejects.toThrow("empresa");
    await expect(getStudioAssetUrl(ctx, `${org}/../image.png`)).rejects.toThrow("empresa");
  });
  it("confere associação antes de entregar uma URL assinada", async () => {
    membership.mockResolvedValueOnce({ data: null, error: null });
    await expect(getStudioAssetUrl(ctx, `${org}/image.png`)).rejects.toThrow("acesso");
    expect(signedUrl).not.toHaveBeenCalled();
    membership.mockResolvedValueOnce({ data: { user_id: user }, error: null });
    signedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://example.test/temporary" }, error: null });
    expect(await getStudioAssetUrl(ctx, `${org}/image.png`)).toBe("https://example.test/temporary");
    expect(signedUrl).toHaveBeenCalledWith(`${org}/image.png`, 300);
  });
  it("recusa leitura com cliente privilegiado quando a associação foi revogada", async () => {
    membership.mockResolvedValueOnce({ data: null, error: null });
    await expect(listCarousels(ctx)).rejects.toThrow("acesso");
  });
  it("não finaliza geração com imagem de outra empresa", async () => {
    await expect(finishStudioGeneration(ctx, { requestId: user, status: "succeeded", result: { slides: [{ role: "cta", heading: "Oi", body: "", imagePath: `${user}/foto.png` }] } })).rejects.toThrow("empresa");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("mantém exportações em paths da empresa", async () => {
    await expect(saveCarousel(ctx, { title: "Post", status: "draft", theme: {}, slides: [], exportPaths: [`${user}/slide.png`] })).rejects.toThrow("empresa");
    expect(rpc).not.toHaveBeenCalled();
  });
});
