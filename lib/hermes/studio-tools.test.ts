import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";

const studio = { listCarousels: vi.fn(), listLandingPages: vi.fn(), getCarousel: vi.fn(), saveCarousel: vi.fn(), saveLandingPage: vi.fn() };
const workflows = { generateCarousel: vi.fn(), exportCarouselToCalendar: vi.fn() };
const crm = { listStages: vi.fn(), resolveStage: vi.fn() };
const proposeScheduledPost = vi.fn();
const rateLimit = vi.fn();
vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMIT_MESSAGE: "Muitas tentativas.", RATE_LIMITS: { studioGenerateUser: { limit: 10, windowSeconds: 60 } } }));
vi.mock("@/lib/services/studio", async (original) => ({ ...(await original<typeof import("@/lib/services/studio")>()), ...studio }));
vi.mock("@/lib/services/studio-workflows", async (original) => ({ ...(await original<typeof import("@/lib/services/studio-workflows")>()), ...workflows }));
vi.mock("@/lib/services/crm", async (original) => ({ ...(await original<typeof import("@/lib/services/crm")>()), ...crm }));
vi.mock("@/lib/services/social-confirmations", async (original) => ({ ...(await original<typeof import("@/lib/services/social-confirmations")>()), proposeScheduledPost }));
const { HERMES_TOOLS, buildHermesTools } = await import("./tools");
const { toolLabel } = await import("./tool-labels");

const org = "11111111-1111-4111-8111-111111111111";
const carouselId = "33333333-3333-4333-8333-333333333333";
const integrationId = "55555555-5555-4555-8555-555555555555";
const ctx = { organizationId: org, userId: "user", via: "hermes", channel: "telegram", planId: "starter", role: "member" } as ServiceContext;
const binding = { conversationId: "conversation", proof: null, messageId: "message-1" };
type Result = { ok: boolean; data?: Record<string, unknown>; error?: string };
const call = (name: string, input: unknown, tools = buildHermesTools(ctx, binding), toolCallId = "call-1") =>
  (tools[name] as unknown as { execute: (input: unknown, options: object) => Promise<Result> }).execute(input, { toolCallId, messages: [] });

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue(true);
  workflows.generateCarousel.mockResolvedValue({ status: "succeeded", slides: [{ role: "hook", heading: "Oi", body: "", imagePath: null }], charged: true });
});

describe("Tools do Estúdio no Hermes", () => {
  it("registra as Tools com rótulos em português", () => {
    const names = Object.keys(buildHermesTools(ctx, binding));
    for (const name of ["list_studio_projects", "get_studio_project", "save_carousel", "save_landing_page", "generate_carousel", "export_carousel_to_calendar"]) {
      expect(names).toContain(name);
      expect(toolLabel(name).running).toMatch(/…$/);
      expect(toolLabel(name).done).not.toBe("Ação executada");
    }
    expect(HERMES_TOOLS.map((tool) => tool.name)).not.toContain("delete_carousel");
  });

  it("lista projetos com resumo, sem enviar todos os slides", async () => {
    studio.listCarousels.mockResolvedValue([{ id: carouselId, title: "Campanha", status: "ready", updated_at: "2026-11-19T10:00:00Z", studio_slides: [{}, {}] }]);
    studio.listLandingPages.mockResolvedValue([{ id: "page", title: "Página", slug: "pagina", published: false, stage_id: null, sections: [{}] }]);
    const result = await call("list_studio_projects", {});
    expect(result.data).toEqual({ carousels: [{ carouselId, title: "Campanha", status: "ready", slideCount: 2, updatedAt: "2026-11-19T10:00:00Z" }], landingPages: [{ pageId: "page", title: "Página", slug: "pagina", published: false, connectedToCrm: false, sectionCount: 1 }] });
    expect(studio.listCarousels).toHaveBeenCalledWith(ctx);
  });

  it("devolve o carrossel no formato aceito para edição", async () => {
    studio.getCarousel.mockResolvedValue({ id: carouselId, title: "Campanha", status: "draft", theme: {}, studio_slides: [{ position: 1, role: "cta", heading: "B", body: "", image_path: null }, { position: 0, role: "hook", heading: "A", body: "x", image_path: `${org}/a.png` }] });
    const result = await call("get_studio_project", { type: "carousel", id: carouselId });
    expect(result.data).toMatchObject({ carouselId, slides: [{ role: "hook", heading: "A", body: "x", imagePath: `${org}/a.png` }, { role: "cta", heading: "B", body: "", imagePath: null }] });
  });

  it("salva carrossel pelo serviço compartilhado com o mesmo schema", async () => {
    studio.saveCarousel.mockResolvedValue({ id: carouselId, title: "Nova", status: "draft" });
    const input = { title: "Nova", status: "draft", theme: {}, slides: [{ role: "hook", heading: "Oi", body: "", imagePath: null }] };
    expect((await call("save_carousel", input)).data).toEqual({ carouselId, title: "Nova", status: "draft" });
    expect(studio.saveCarousel).toHaveBeenCalledWith(ctx, input);
    expect((await call("save_carousel", { ...input, status: "ready", slides: [] })).ok).toBe(false);
  });

  it("resolve a etapa do CRM por nome ao salvar landing page", async () => {
    crm.resolveStage.mockResolvedValue("stage-1");
    crm.listStages.mockResolvedValue([{ id: "stage-1", name: "Novo Lead", pipeline_id: "pipe-1" }]);
    studio.saveLandingPage.mockResolvedValue({ id: "page", slug: "oferta" });
    await call("save_landing_page", { title: "Oferta", slug: "oferta", sections: [], published: false, stage: "novo lead" });
    expect(crm.resolveStage).toHaveBeenCalledWith(ctx, "novo lead");
    expect(studio.saveLandingPage).toHaveBeenCalledWith(ctx, expect.objectContaining({ pipelineId: "pipe-1", stageId: "stage-1" }));
    await call("save_landing_page", { title: "Oferta", slug: "oferta", sections: [], published: false, stage: null });
    expect(studio.saveLandingPage).toHaveBeenLastCalledWith(ctx, expect.objectContaining({ pipelineId: null, stageId: null }));
  });

  it("usa a mesma chave de geração quando o modelo repete o pedido na mesma mensagem", async () => {
    const input = { carouselId, prompt: "Campanha de verão", slideCount: 4 };
    await call("generate_carousel", input, buildHermesTools(ctx, binding), "call-1");
    await call("generate_carousel", input, buildHermesTools(ctx, binding), "call-2");
    const [first, second] = workflows.generateCarousel.mock.calls.map(([, value]) => value.requestId);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).toBe(first);
    expect(workflows.generateCarousel).toHaveBeenCalledWith(ctx, { ...input, requestId: first });
  });

  it("usa chaves diferentes para outra mensagem, outro pedido ou outra empresa", async () => {
    const input = { carouselId, prompt: "Campanha", slideCount: 5 };
    await call("generate_carousel", input);
    await call("generate_carousel", input, buildHermesTools(ctx, { ...binding, messageId: "message-2" }));
    await call("generate_carousel", { ...input, prompt: "Outra" });
    await call("generate_carousel", input, buildHermesTools({ ...ctx, organizationId: "99999999-9999-4999-8999-999999999999" }, binding));
    expect(new Set(workflows.generateCarousel.mock.calls.map(([, value]) => value.requestId)).size).toBe(4);
  });

  it("respeita o limite de gerações antes de cobrar", async () => {
    rateLimit.mockResolvedValue(false);
    expect(await call("generate_carousel", { carouselId, prompt: "x", slideCount: 3 })).toEqual({ ok: false, error: "Muitas tentativas." });
    expect(workflows.generateCarousel).not.toHaveBeenCalled();
  });

  it("informa geração em andamento e erros de crédito em português", async () => {
    workflows.generateCarousel.mockResolvedValueOnce({ status: "started", slides: [], charged: false });
    expect((await call("generate_carousel", { carouselId, prompt: "x", slideCount: 3 })).data).toMatchObject({ status: "started", notice: expect.stringContaining("andamento") });
    workflows.generateCarousel.mockRejectedValueOnce(new ServiceError("Você atingiu o limite de créditos de IA do plano Starter."));
    expect(await call("generate_carousel", { carouselId, prompt: "x", slideCount: 3 })).toEqual({ ok: false, error: "Você atingiu o limite de créditos de IA do plano Starter." });
  });

  it("exporta como rascunho por padrão, sem proposta de agendamento", async () => {
    workflows.exportCarouselToCalendar.mockResolvedValue({ post: { id: "post-1", status: "draft", format: "carousel" }, mediaPaths: ["a", "b"] });
    const result = await call("export_carousel_to_calendar", { carouselId });
    expect(workflows.exportCarouselToCalendar).toHaveBeenCalledWith(ctx, { carouselId, schedule: null });
    expect(result.data).toMatchObject({ postId: "post-1", status: "draft", scheduled: false });
    expect(result.data).not.toHaveProperty("instruction");
    expect(proposeScheduledPost).not.toHaveBeenCalled();
  });

  it("agendamento cria rascunho e exige confirmação persistente em nova mensagem", async () => {
    workflows.exportCarouselToCalendar.mockResolvedValue({ post: { id: "post-1", status: "draft", format: "carousel" }, mediaPaths: ["a", "b"] });
    proposeScheduledPost.mockResolvedValue({ code: "f".repeat(32), post: { format: "carousel" } });
    const schedule = { scheduledAt: "2031-01-01T12:00:00-03:00", targets: [{ channel: "instagram", integrationId }] };
    const result = await call("export_carousel_to_calendar", { carouselId, schedule });
    expect(workflows.exportCarouselToCalendar).toHaveBeenCalledWith(ctx, { carouselId, schedule: null });
    expect(proposeScheduledPost).toHaveBeenCalledWith(ctx, { conversationId: "conversation" }, { postId: "post-1", ...schedule });
    expect(result.data).toMatchObject({ postId: "post-1", scheduled: false, requiresConfirmation: true, instruction: `Para agendar este post, responda exatamente: CONFIRMAR ${"f".repeat(32)}` });
  });

  it("mantém o rascunho e explica quando o agendamento não pode ser preparado", async () => {
    workflows.exportCarouselToCalendar.mockResolvedValue({ post: { id: "post-1", status: "draft", format: "feed" }, mediaPaths: ["a"] });
    proposeScheduledPost.mockRejectedValue(new ServiceError("Confira as contas conectadas em Integrações antes de continuar."));
    const result = await call("export_carousel_to_calendar", { carouselId, schedule: { scheduledAt: "2031-01-01T12:00:00-03:00", targets: [{ channel: "instagram", integrationId }] } });
    expect(result).toMatchObject({ ok: true, data: { postId: "post-1", scheduled: false, scheduleError: "Confira as contas conectadas em Integrações antes de continuar." } });
  });

  it("recusa agendamento com data passada antes de exportar", async () => {
    const result = await call("export_carousel_to_calendar", { carouselId, schedule: { scheduledAt: "2020-01-01T12:00:00-03:00", targets: [{ channel: "instagram", integrationId }] } });
    expect(result.ok).toBe(false);
    expect(workflows.exportCarouselToCalendar).not.toHaveBeenCalled();
  });
});
