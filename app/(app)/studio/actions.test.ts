import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";
const workspace = vi.fn();
const rateLimit = vi.fn();
const studio = { saveCarousel: vi.fn(), saveLandingPage: vi.fn(), prepareStudioAssetUpload: vi.fn(), getStudioAssetUrl: vi.fn() };
const workflows = { generateCarousel: vi.fn(), exportCarouselToCalendar: vi.fn() };
const revalidatePath = vi.fn();
vi.mock("@/lib/workspace", () => ({ requireWorkspace: workspace }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMIT_MESSAGE: "Muitas tentativas.", RATE_LIMITS: { studioUser: {}, studioGenerateUser: {} } }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/services/studio", async (original) => ({ ...(await original<typeof import("@/lib/services/studio")>()), ...studio }));
vi.mock("@/lib/services/studio-workflows", async (original) => ({ ...(await original<typeof import("@/lib/services/studio-workflows")>()), ...workflows }));
const actions = await import("./actions");
const err = (result: object) => (result as { error?: string }).error;

const id = "11111111-1111-4111-8111-111111111111";
const carousel = { title: "Campanha", status: "draft", theme: {}, slides: [{ role: "hook", heading: "Oi", body: "", imagePath: null }] };
beforeEach(() => {
  vi.clearAllMocks();
  workspace.mockResolvedValue({ supabase: {}, user: { id: "user" }, organization: { id: "org", plan_id: "starter" }, role: "member" });
  rateLimit.mockResolvedValue(true);
});

describe("ações do Estúdio", () => {
  it("salva carrossel pelo serviço compartilhado com contexto manual", async () => {
    studio.saveCarousel.mockResolvedValue({ id });
    expect(await actions.saveCarouselAction(carousel)).toEqual({ id });
    expect(studio.saveCarousel).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org", userId: "user", via: "manual" }), expect.objectContaining({ title: "Campanha" }));
    expect(revalidatePath).toHaveBeenCalledWith("/studio");
  });
  it("valida payload e limite de requisições antes do serviço", async () => {
    expect(err(await actions.saveCarouselAction({ ...carousel, status: "ready", slides: [] }))).toMatch(/ao menos um slide/);
    rateLimit.mockResolvedValue(false);
    expect(err(await actions.saveLandingPageAction({}))).toBe("Muitas tentativas.");
    expect(studio.saveCarousel).not.toHaveBeenCalled();
    expect(studio.saveLandingPage).not.toHaveBeenCalled();
  });
  it("devolve mensagens seguras e esconde erros internos", async () => {
    studio.saveCarousel.mockRejectedValueOnce(new ServiceError("Você não tem acesso a esta empresa."));
    expect(err(await actions.saveCarouselAction(carousel))).toBe("Você não tem acesso a esta empresa.");
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    studio.saveCarousel.mockRejectedValueOnce(new Error("relation secret_table"));
    expect(err(await actions.saveCarouselAction(carousel))).not.toContain("secret");
  });
  it("gera com chave de solicitação e limite próprio de IA", async () => {
    workflows.generateCarousel.mockResolvedValue({ status: "succeeded", slides: [], charged: true });
    const input = { requestId: id, carouselId: id, prompt: "Campanha", slideCount: 4 };
    expect(await actions.generateCarouselAction(input)).toMatchObject({ status: "succeeded" });
    expect(rateLimit).toHaveBeenCalledWith("studio:generate:user", expect.anything());
    expect(workflows.generateCarousel).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org" }), input);
  });
  it("exporta para o calendário e atualiza as duas telas", async () => {
    workflows.exportCarouselToCalendar.mockResolvedValue({ post: { id }, mediaPaths: [] });
    expect(await actions.exportCarouselAction({ carouselId: id, schedule: null })).toEqual({ postId: id });
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(err(await actions.exportCarouselAction({ carouselId: "x", schedule: null }))).toBeTruthy();
  });
  it("prepara envio e leitura de imagens somente pelo serviço da empresa", async () => {
    studio.prepareStudioAssetUpload.mockResolvedValue({ path: "org/a.png", token: "t" });
    expect(await actions.prepareStudioUploadAction({ type: "image/png", size: 10 })).toEqual({ path: "org/a.png", token: "t" });
    expect(err(await actions.prepareStudioUploadAction({ type: "image/gif", size: 10 }))).toBeTruthy();
    studio.getStudioAssetUrl.mockResolvedValue("https://assinado.test");
    expect(await actions.studioAssetUrlsAction(["org/a.png"])).toEqual({ urls: { "org/a.png": "https://assinado.test" } });
    expect(err(await actions.studioAssetUrlsAction(Array.from({ length: 21 }, () => "org/a.png")))).toBeTruthy();
  });
});
