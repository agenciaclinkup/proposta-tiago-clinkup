import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";
import { PlanLimitError } from "@/lib/services/usage";
vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog: vi.fn() }));
const calendar = await import("@/lib/services/social-posts");
const integrations = await import("@/lib/services/integrations");
const brand = await import("@/lib/services/brand");
const { HERMES_TOOLS, buildHermesTools } = await import("./tools");
const { runTool } = await import("./run-tool");
const id = "11111111-1111-4111-8111-111111111111";
const integrationId = "22222222-2222-4222-8222-222222222222";
const ctx = { organizationId: "org", userId: "u", via: "hermes", channel: "telegram", planId: "starter", role: "member" } as ServiceContext;
const data = { id, status: "scheduled", format: "feed", caption: "Olá", hashtags: ["#oi"], media: [], scheduled_at: "2030-01-01T12:00:00Z", social_post_targets: [{ channel: "facebook", integration_id: integrationId }] };
const call = (name: string, input: unknown) => runTool(ctx, HERMES_TOOLS.find((item) => item.name === name)!, input);
beforeEach(() => { vi.restoreAllMocks(); });
describe("Tools do calendário", () => {
  it("registra gestão sem excluir ou publicar imediatamente", () => {
    const names = HERMES_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["list_posts", "list_calendar_accounts", "create_post", "update_post", "reschedule_post", "cancel_post"]));
    expect(names).not.toContain("delete_post");
    expect(names).not.toContain("publish_post_now");
  });
  it("apresenta apenas contas sociais conectadas e identificadores da empresa", async () => {
    vi.spyOn(integrations, "listIntegrations").mockResolvedValue([{ id: integrationId, provider: "facebook_page", status: "connected", display_name: "Página", external_account_id: "123" }, { id, provider: "google_calendar", status: "connected" }, { id, provider: "instagram", status: "needs_attention" }] as never);
    const result = await call("list_calendar_accounts", {});
    expect(result).toEqual({ ok: true, data: [{ integrationId, provider: "facebook_page", name: "Página" }] });
    expect(integrations.listIntegrations).toHaveBeenCalledWith(ctx);
  });
  it("pede escolha quando a listagem contém múltiplos posts", async () => {
    vi.spyOn(calendar, "listSocialPosts").mockResolvedValue([data, { ...data, id: integrationId }]);
    expect(await call("list_posts", {})).toMatchObject({ ok: true, data: { selectionRequired: true } });
  });
  it("prepara proposta semanal usando a marca sem agendar", async () => {
    vi.spyOn(brand, "getBrandContext").mockResolvedValue({ company_name: "Empresa", master_context: "Marketing local" } as never);
    const save = vi.spyOn(calendar, "saveSocialPost");
    const result = await call("plan_week_with_ai", { posts: [{ format: "feed", caption: "Dica", hashtags: [], media: [], targets: [{ channel: "facebook", integrationId }], scheduledAt: "2031-01-01T12:00:00Z" }] });
    expect(result).toMatchObject({ ok: true, data: { scheduled: false, requiresConfirmation: true } });
    expect(brand.getBrandContext).toHaveBeenCalledWith(ctx);
    expect(save).not.toHaveBeenCalled();
  });
  it("bloqueia agendamento no mesmo turno após prévia semanal", async () => {
    vi.spyOn(brand, "getBrandContext").mockResolvedValue({ company_name: "Empresa" } as never);
    const save = vi.spyOn(calendar, "saveSocialPost");
    const tools = buildHermesTools(ctx);
    const post = { format: "feed", caption: "Oi", hashtags: [], media: [], targets: [{ channel: "facebook", integrationId }], scheduledAt: "2031-01-01T12:00:00Z" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execute = (name: string, input: unknown) => (tools[name] as any).execute(input, { toolCallId: "t", messages: [] });
    expect((await execute("plan_week_with_ai", { posts: [post] })).ok).toBe(true);
    expect((await execute("create_post", { status: "scheduled", post })).error).toContain("nova mensagem");
    expect(save).not.toHaveBeenCalled();
  });
  it("não prepara proposta sem memória da marca", async () => {
    vi.spyOn(brand, "getBrandContext").mockResolvedValue(null);
    expect(await call("plan_week_with_ai", { posts: [{ format: "feed", caption: "Oi", hashtags: [], media: [], targets: [], scheduledAt: "2031-01-01T12:00:00Z" }] })).toMatchObject({ ok: false, error: expect.stringContaining("onboarding") });
  });
  it("consulta e cria usando o mesmo contexto e serviço", async () => {
    const list = vi.spyOn(calendar, "listSocialPosts").mockResolvedValue([data]);
    const save = vi.spyOn(calendar, "saveSocialPost").mockResolvedValue({ id });
    expect((await call("list_posts", {})).ok).toBe(true);
    await call("create_post", { status: "draft", post: { format: "feed", caption: "Oi", hashtags: [], media: [], targets: [] } });
    expect(list).toHaveBeenCalledWith(ctx, expect.objectContaining({ limit: 20 }));
    expect(save).toHaveBeenCalledWith(ctx, expect.objectContaining({ status: "draft" }));
  });
  it("reagenda e cancela sem perder conteúdo nem destinos", async () => {
    vi.spyOn(calendar, "getSocialPost").mockResolvedValue(data as never);
    const save = vi.spyOn(calendar, "saveSocialPost").mockResolvedValue({ id });
    await call("reschedule_post", { postId: id, scheduledAt: "2031-01-01T12:00:00Z" });
    expect(save).toHaveBeenCalledWith(ctx, expect.objectContaining({ postId: id, status: "scheduled", post: expect.objectContaining({ caption: "Olá", targets: [{ channel: "facebook", integrationId }], scheduledAt: "2031-01-01T12:00:00Z" }) }));
    await call("cancel_post", { postId: id });
    expect(save).toHaveBeenCalledWith(ctx, expect.objectContaining({ postId: id, status: "draft", post: expect.objectContaining({ scheduledAt: null }) }));
  });
  it("altera somente os campos solicitados sem perder o restante", async () => {
    vi.spyOn(calendar, "getSocialPost").mockResolvedValue(data as never);
    const save = vi.spyOn(calendar, "saveSocialPost").mockResolvedValue({ id });
    await call("update_post", { postId: id, patch: { caption: "Nova legenda" } });
    expect(save).toHaveBeenCalledWith(ctx, expect.objectContaining({ status: "scheduled", post: expect.objectContaining({ caption: "Nova legenda", hashtags: ["#oi"], scheduledAt: data.scheduled_at, targets: [{ channel: "facebook", integrationId }] }) }));
    expect((await call("update_post", { postId: id, patch: {} })).ok).toBe(false);
  });
  it("não altera post publicado ou inexistente e valida ID", async () => {
    const get = vi.spyOn(calendar, "getSocialPost").mockResolvedValue({ ...data, status: "published" } as never);
    const save = vi.spyOn(calendar, "saveSocialPost");
    expect((await call("cancel_post", { postId: id })).ok).toBe(false);
    expect((await call("cancel_post", { postId: "invalido" })).ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("mantém mensagens e limite de plano do serviço", async () => {
    vi.spyOn(calendar, "saveSocialPost").mockRejectedValue(new PlanLimitError("scheduled_posts", 30, 30, "Starter"));
    const result = await call("create_post", { status: "scheduled", post: { format: "feed", caption: "Oi", hashtags: [], media: [], targets: [{ channel: "facebook", integrationId }], scheduledAt: "2031-01-01T12:00:00Z" } });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("limite") });
  });
});
