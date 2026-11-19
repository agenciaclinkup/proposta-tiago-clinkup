import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";

vi.mock("@/lib/integrations/google", () => ({ getGoogleAccessToken: vi.fn() }));
vi.mock("@/lib/services/crm", () => ({ getLead: vi.fn() }));
vi.mock("@/lib/services/integrations", () => ({ listIntegrations: vi.fn() }));
import { getGoogleAccessToken } from "@/lib/integrations/google";
import { getLead } from "@/lib/services/crm";
import { listIntegrations } from "@/lib/services/integrations";
import { meetingSchema, scheduleLeadMeeting } from "./meetings";

const leadId = "11111111-1111-4111-8111-111111111111";
const input = { leadId, title: "Conversa", startAt: "2030-01-01T12:00:00Z", durationMinutes: 30, description: "Pauta" };
const insert = vi.fn();
const eq = vi.fn();
const update = vi.fn();
const ctx = { organizationId: "org", userId: "user", via: "hermes", supabase: { from: (table: string) => table === "crm_activities" ? { insert } : { update } } } as unknown as ServiceContext;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getLead).mockResolvedValue({ id: leadId, name: "Ana", email: "ana@example.com" } as never);
  vi.mocked(listIntegrations).mockResolvedValue([{ id: "int", provider: "google_calendar", status: "connected", external_account_id: "cal@example.com" }] as never);
  vi.mocked(getGoogleAccessToken).mockResolvedValue("token");
  insert.mockResolvedValue({ error: null });
  eq.mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: leadId }, error: null }) }) }) });
  update.mockReturnValue({ eq });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "event" }) }));
});

describe("scheduleLeadMeeting", () => {
  it("cria evento com convite e registra atividade e lead na organização", async () => {
    await scheduleLeadMeeting(ctx, meetingSchema.parse(input));
    expect(getGoogleAccessToken).toHaveBeenCalledWith("org", "int");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("sendUpdates=all"), expect.objectContaining({ method: "POST", body: expect.stringContaining("ana@example.com") }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: "org", lead_id: leadId, type: "meeting", created_via: "hermes" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ google_event_id: "event" }));
  });
  it("orienta conectar o calendário e não chama Google", async () => {
    vi.mocked(listIntegrations).mockResolvedValue([]);
    await expect(scheduleLeadMeeting(ctx, input)).rejects.toThrow("/integrations");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("recusa ausência de e-mail e dados inválidos", async () => {
    vi.mocked(getLead).mockResolvedValue({ id: leadId, email: null } as never);
    await expect(scheduleLeadMeeting(ctx, input)).rejects.toThrow("e-mail");
    expect(meetingSchema.safeParse({ ...input, startAt: "2030-01-01T12:00", durationMinutes: -1 }).success).toBe(false);
  });
  it("não grava atividade se o Google recusar o evento", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
    await expect(scheduleLeadMeeting(ctx, input)).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
  it("avisa quando o evento existe mas o registro no CRM falha", async () => {
    insert.mockResolvedValue({ error: { message: "falha" } });
    await expect(scheduleLeadMeeting(ctx, input)).rejects.toThrow("foi criada no Google Calendar");
    expect(update).toHaveBeenCalled();
  });
  it("alerta para possível duplicação quando o Google não responde", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("timeout"));
    await expect(scheduleLeadMeeting(ctx, input)).rejects.toThrow("Confira sua agenda");
    expect(insert).not.toHaveBeenCalled();
  });
  it("não acessa integração nem Google quando o lead é de outra organização", async () => {
    vi.mocked(getLead).mockRejectedValue(new Error("lead não encontrado"));
    await expect(scheduleLeadMeeting(ctx, input)).rejects.toThrow();
    expect(listIntegrations).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
