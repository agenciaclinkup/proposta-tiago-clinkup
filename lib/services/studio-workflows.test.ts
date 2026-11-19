import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const carouselId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const integrationId = "55555555-5555-4555-8555-555555555555";

const studio = { getCarousel: vi.fn(), saveCarousel: vi.fn(), beginStudioGeneration: vi.fn(), finishStudioGeneration: vi.fn(), getStudioAssetUrl: vi.fn() };
const saveSocialPost = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const getBrandContext = vi.fn();
vi.mock("./studio", async (original) => ({ ...(await original<typeof import("./studio")>()), ...studio }));
vi.mock("./social-posts", async (original) => ({ ...(await original<typeof import("./social-posts")>()), saveSocialPost }));
vi.mock("./brand", () => ({ getBrandContext }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: (bucket: string) => ({ upload: (...args: unknown[]) => upload(bucket, ...args), remove: (...args: unknown[]) => remove(bucket, ...args) }) } }) }));
const { exportCarouselToCalendar, generateCarousel, STALE_GENERATION_MS } = await import("./studio-workflows");

const ctx = { organizationId: org, userId: user, planId: "starter", role: "member", via: "manual", channel: "web" } as ServiceContext;
const row = (status = "ready", slides = [{ position: 1, role: "cta", heading: "Agende", body: "Link na bio", image_path: null }, { position: 0, role: "hook", heading: "Sorriso novo", body: "Em 1 hora", image_path: `${org}/foto.png` }]) =>
  ({ id: carouselId, title: "Campanha", status, theme: { primaryColor: "#00D4FF" }, studio_slides: slides });
const generated = [{ role: "hook", heading: "Novo", body: "Texto", imagePath: null }, { role: "cta", heading: "Fale conosco", body: "", imagePath: null }] as const;
const generator = (billable: boolean, result: unknown = generated) => ({ billable, generate: vi.fn(async () => { if (result instanceof Error) throw result; return result as typeof generated[number][]; }) });

beforeEach(() => {
  vi.clearAllMocks();
  studio.getCarousel.mockResolvedValue(row());
  studio.getStudioAssetUrl.mockResolvedValue("https://assinado.test/foto.png");
  getBrandContext.mockResolvedValue({ master_context: "Clínica premium" });
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  saveSocialPost.mockResolvedValue({ id: "post" });
});

describe("geração assistida por IA", () => {
  const input = { requestId, carouselId, prompt: "Campanha de novembro" };
  it("cobra uma vez, registra o resultado e aplica os slides mantendo as imagens", async () => {
    studio.beginStudioGeneration.mockResolvedValue({ created: true, generation: { status: "started" } });
    const gen = generator(true);
    const result = await generateCarousel(ctx, input, gen);
    expect(result).toMatchObject({ status: "succeeded", charged: true });
    expect(studio.beginStudioGeneration).toHaveBeenCalledWith(ctx, { ...input, kind: "carousel" });
    expect(gen.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: input.prompt, brandContext: "Clínica premium" }));
    expect(studio.finishStudioGeneration).toHaveBeenCalledWith(ctx, { requestId, status: "succeeded", result: { slides: generated } });
    expect(studio.saveCarousel).toHaveBeenCalledWith(ctx, expect.objectContaining({ carouselId, status: "draft", slides: [{ ...generated[0], imagePath: `${org}/foto.png` }, generated[1]] }));
  });
  it("estorna o crédito quando o provedor falha e não salva slides", async () => {
    studio.beginStudioGeneration.mockResolvedValue({ created: true, generation: { status: "started" } });
    await expect(generateCarousel(ctx, input, generator(true, new Error("timeout")))).rejects.toThrow(/crédito foi devolvido/);
    expect(studio.finishStudioGeneration).toHaveBeenCalledWith(ctx, expect.objectContaining({ requestId, status: "failed" }));
    expect(studio.saveCarousel).not.toHaveBeenCalled();
  });
  it("não gera novamente quando a solicitação já existe", async () => {
    studio.beginStudioGeneration.mockResolvedValue({ created: false, generation: { status: "succeeded", created_at: new Date().toISOString(), result: { slides: generated } } });
    const gen = generator(true);
    expect(await generateCarousel(ctx, input, gen)).toMatchObject({ status: "succeeded", charged: false, slides: generated });
    expect(gen.generate).not.toHaveBeenCalled();
    expect(studio.finishStudioGeneration).not.toHaveBeenCalled();
    expect(studio.saveCarousel).not.toHaveBeenCalled();
  });
  it("informa geração em andamento sem cobrar de novo", async () => {
    studio.beginStudioGeneration.mockResolvedValue({ created: false, generation: { status: "started", created_at: new Date().toISOString(), result: null } });
    const gen = generator(true);
    expect(await generateCarousel(ctx, input, gen)).toMatchObject({ status: "started", charged: false });
    expect(gen.generate).not.toHaveBeenCalled();
    expect(studio.finishStudioGeneration).not.toHaveBeenCalled();
  });
  it("encerra geração interrompida com estorno e sem chamar o provedor", async () => {
    studio.beginStudioGeneration.mockResolvedValue({ created: false, generation: { status: "started", created_at: new Date(Date.now() - STALE_GENERATION_MS - 1000).toISOString(), result: null } });
    const gen = generator(true);
    expect(await generateCarousel(ctx, input, gen)).toMatchObject({ status: "failed", charged: false });
    expect(studio.finishStudioGeneration).toHaveBeenCalledWith(ctx, expect.objectContaining({ requestId, status: "failed" }));
    expect(gen.generate).not.toHaveBeenCalled();
  });
  it("usa o modelo local sem registrar cobrança", async () => {
    const result = await generateCarousel(ctx, input, generator(false));
    expect(result).toMatchObject({ status: "succeeded", charged: false });
    expect(studio.beginStudioGeneration).not.toHaveBeenCalled();
    expect(studio.saveCarousel).toHaveBeenCalled();
  });
  it("valida a entrada antes de qualquer cobrança", async () => {
    await expect(generateCarousel(ctx, { ...input, prompt: "" }, generator(true))).rejects.toBeInstanceOf(ServiceError);
    expect(studio.beginStudioGeneration).not.toHaveBeenCalled();
  });
});

describe("exportação para o calendário", () => {
  const render = vi.fn(async () => new Uint8Array([1, 2, 3]));
  it("cria rascunho com imagens da empresa no bucket social, na ordem dos slides", async () => {
    const result = await exportCarouselToCalendar(ctx, { carouselId, schedule: null }, render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(1, expect.objectContaining({ index: 0, total: 2, backgroundUrl: "https://assinado.test/foto.png", slide: expect.objectContaining({ role: "hook" }) }));
    expect(studio.getStudioAssetUrl).toHaveBeenCalledWith(ctx, `${org}/foto.png`);
    const paths = upload.mock.calls.map(([bucket, path]) => { expect(bucket).toBe("social-media"); return path as string; });
    paths.forEach((path) => expect(path).toMatch(new RegExp(`^${org}/[0-9a-f-]+\\.png$`)));
    expect(saveSocialPost).toHaveBeenCalledWith(ctx, { status: "draft", post: expect.objectContaining({ format: "carousel", media: paths.map((path) => ({ path, type: "image" })), targets: [], scheduledAt: null }) });
    expect(saveSocialPost.mock.calls[0]?.[1].post.caption).toContain("Sorriso novo");
    expect(result.mediaPaths).toEqual(paths);
  });
  it("agenda somente com data e canais escolhidos explicitamente", async () => {
    const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
    await exportCarouselToCalendar(ctx, { carouselId, schedule: { scheduledAt, targets: [{ channel: "instagram", integrationId }] } }, render);
    expect(saveSocialPost).toHaveBeenCalledWith(ctx, { status: "scheduled", post: expect.objectContaining({ scheduledAt, targets: [{ channel: "instagram", integrationId }] }) });
  });
  it("usa formato feed para peça única", async () => {
    studio.getCarousel.mockResolvedValue(row("ready", [{ position: 0, role: "hook", heading: "Peça", body: "", image_path: null }]));
    await exportCarouselToCalendar(ctx, { carouselId, schedule: null }, render);
    expect(saveSocialPost.mock.calls[0]?.[1].post.format).toBe("feed");
  });
  it("exige carrossel concluído e no máximo 10 slides", async () => {
    studio.getCarousel.mockResolvedValueOnce(row("draft"));
    await expect(exportCarouselToCalendar(ctx, { carouselId, schedule: null }, render)).rejects.toThrow(/concluído/);
    studio.getCarousel.mockResolvedValueOnce(row("ready", Array.from({ length: 11 }, (_, position) => ({ position, role: "content", heading: "x", body: "", image_path: null }))));
    await expect(exportCarouselToCalendar(ctx, { carouselId, schedule: null }, render)).rejects.toThrow(/10 slides/);
    expect(upload).not.toHaveBeenCalled();
  });
  it("remove arquivos enviados quando o post não pode ser salvo", async () => {
    saveSocialPost.mockRejectedValue(new ServiceError("Limite atingido"));
    await expect(exportCarouselToCalendar(ctx, { carouselId, schedule: null }, render)).rejects.toThrow("Limite atingido");
    expect(remove).toHaveBeenCalledWith("social-media", upload.mock.calls.map(([, path]) => path));
  });
  it("remove o que já foi enviado quando um upload falha", async () => {
    upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "quota" } });
    await expect(exportCarouselToCalendar(ctx, { carouselId, schedule: null }, render)).rejects.toBeInstanceOf(ServiceError);
    expect(remove).toHaveBeenCalledWith("social-media", [upload.mock.calls[0]?.[1]]);
    expect(saveSocialPost).not.toHaveBeenCalled();
  });
});
