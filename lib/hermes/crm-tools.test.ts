import { describe, it, expect, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";
vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog: vi.fn() }));
const crm = await import("@/lib/services/crm");
const { HERMES_TOOLS } = await import("./tools");
const { runTool } = await import("./run-tool");
const meetings = await import("@/lib/services/meetings");
const ctx = { organizationId: "org", userId: "user", via: "hermes", channel: "telegram", role: "member" } as ServiceContext;
const id = "11111111-1111-4111-8111-111111111111";
const stageId = "22222222-2222-4222-8222-222222222222";
const call = (name: string, input: unknown) => runTool(ctx, HERMES_TOOLS.find((t) => t.name === name)!, input);
describe("Tools CRM", () => {
  it("agenda reunião com o contexto do Telegram pelo serviço compartilhado", async () => {
    const schedule = vi.spyOn(meetings, "scheduleLeadMeeting").mockResolvedValue({ eventId: "evento", startAt: "2030-01-01T12:00:00Z", durationMinutes: 30, attendee: "ana@example.com" });
    const input = { leadId: id, title: "Reunião", startAt: "2030-01-01T12:00:00Z", durationMinutes: 30 };
    expect((await call("schedule_lead_meeting", input)).ok).toBe(true);
    expect(schedule).toHaveBeenCalledWith(ctx, input);
  });
  it("registra as seis operações sem exclusão", () => {
    expect(HERMES_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["list_leads", "create_lead", "update_lead", "move_lead_to_stage", "add_lead_note", "get_funnel_metrics"]));
    expect(HERMES_TOOLS.some((t) => t.name === "delete_lead")).toBe(false);
  });
  it("sinaliza resultados ambíguos para pedir escolha", async () => {
    vi.spyOn(crm, "searchLeads").mockResolvedValueOnce([{ id: "1" }, { id: "2" }] as never);
    expect(await call("list_leads", { query: "Ana" })).toMatchObject({ ok: true, data: { requiresSelection: true } });
  });
  it("usa os serviços com o contexto do Telegram e valida os dados", async () => {
    const search = vi.spyOn(crm, "searchLeads").mockResolvedValue([]);
    const create = vi.spyOn(crm, "createLead").mockResolvedValue({} as never);
    const update = vi.spyOn(crm, "updateLead").mockResolvedValue({} as never);
    const move = vi.spyOn(crm, "moveLead").mockResolvedValue({ stageId, position: 1 });
    const note = vi.spyOn(crm, "addLeadNote").mockResolvedValue();
    const metrics = vi.spyOn(crm, "getFunnelMetrics").mockResolvedValue({} as never);
    vi.spyOn(crm, "resolveStage").mockResolvedValue(stageId);
    await call("list_leads", { query: "Ana" });
    await call("create_lead", { lead: { name: "Ana" }, stage: "Reunião" });
    await call("update_lead", { leadId: id, patch: { company: "Empresa" } });
    await call("move_lead_to_stage", { leadId: id, stage: "Reunião" });
    await call("add_lead_note", { leadId: id, content: "Contato" });
    await call("get_funnel_metrics", {});
    expect(search).toHaveBeenCalledWith(ctx, expect.objectContaining({ query: "Ana" }));
    expect(create).toHaveBeenCalledWith(ctx, expect.objectContaining({ name: "Ana", stageId }));
    expect(update).toHaveBeenCalledWith(ctx, id, { company: "Empresa" });
    expect(move).toHaveBeenCalledWith(ctx, { leadId: id, stageId, index: 100000 });
    expect(note).toHaveBeenCalledWith(ctx, id, "Contato");
    expect(metrics).toHaveBeenCalledWith(ctx);
    expect((await call("update_lead", { leadId: id, patch: {} })).ok).toBe(false);
  });
});
