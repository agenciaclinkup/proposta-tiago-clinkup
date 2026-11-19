import { beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingSchema } from "@/lib/onboarding";
import type { ServiceContext } from "@/lib/services/context";

vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog: vi.fn() }));
const getBrandContext = vi.fn();
const saveBrandContext = vi.fn();
vi.mock("@/lib/services/brand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/brand")>()),
  getBrandContext,
  saveBrandContext,
}));
const listRecentActivity = vi.fn();
vi.mock("@/lib/services/activity", () => ({ listRecentActivity }));
vi.mock("@/lib/services/account", () => ({ getPlanAndUsage: vi.fn() }));
const listIntegrations = vi.fn();
vi.mock("@/lib/services/integrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/integrations")>()),
  listIntegrations,
}));

const { HERMES_TOOLS, buildHermesTools } = await import("./tools");
const { brandRowFromInput } = await import("@/lib/services/brand");

const ctx = { organizationId: "org-1", userId: "u-1", via: "hermes", channel: "web" } as ServiceContext;
const brandRow = brandRowFromInput(
  "org-1",
  onboardingSchema.parse({
    companyName: "Clinkup",
    niche: "Marketing digital",
    productsServices: "Gestão de tráfego e automação",
    targetAudience: "Clínicas e pequenas empresas",
    differentiators: "Operação orientada por IA",
    toneOfVoice: "Profissional e próximo",
    primaryColor: "#00D4FF",
    secondaryColor: "#2563EB",
    logoUrl: "",
  }),
);

const call = (name: string, input: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (buildHermesTools(ctx)[name] as any).execute(input, { toolCallId: "t1", messages: [] });

beforeEach(() => vi.clearAllMocks());

describe("registro de Tools", () => {
  it("tem nomes únicos em snake_case e descrições em português", () => {
    const names = HERMES_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of HERMES_TOOLS) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("expõe as Tools da Fase 2.2 no formato do AI SDK", () => {
    expect(Object.keys(buildHermesTools(ctx)).sort()).toEqual(
      ["get_brand_context", "get_integration_setup_guide", "get_plan_and_usage", "list_integrations", "list_recent_activity", "update_brand_context", "list_leads", "create_lead", "update_lead", "move_lead_to_stage", "add_lead_note", "get_funnel_metrics", "schedule_lead_meeting", "list_posts", "list_calendar_accounts", "create_post", "update_post", "reschedule_post", "cancel_post", "plan_week_with_ai"].sort(),
    );
  });
});

describe("update_brand_context", () => {
  it("aplica a alteração parcial sobre a memória atual", async () => {
    getBrandContext.mockResolvedValueOnce(brandRow);
    const result = await call("update_brand_context", { toneOfVoice: "Descontraído e bem-humorado" });
    expect(result.ok).toBe(true);
    expect(saveBrandContext).toHaveBeenCalledWith(ctx, expect.objectContaining({ toneOfVoice: "Descontraído e bem-humorado", companyName: "Clinkup" }));
  });

  it("exige pelo menos um campo", async () => {
    const result = await call("update_brand_context", {});
    expect(result.ok).toBe(false);
    expect(saveBrandContext).not.toHaveBeenCalled();
  });

  it("orienta concluir o onboarding quando não há memória da marca", async () => {
    getBrandContext.mockResolvedValueOnce(null);
    const result = await call("update_brand_context", { niche: "Odontologia" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("onboarding") });
  });
});

describe("list_recent_activity", () => {
  it("usa 10 por padrão e limita a 20", async () => {
    listRecentActivity.mockResolvedValue([]);
    await call("list_recent_activity", {});
    expect(listRecentActivity).toHaveBeenLastCalledWith(ctx, 10);
    expect((await call("list_recent_activity", { limit: 50 })).ok).toBe(false);
  });
});

describe("list_integrations", () => {
  it("lista todos os provedores com o status da organização", async () => {
    listIntegrations.mockResolvedValueOnce([{ provider: "telegram", status: "connected", display_name: "Ana", external_account_id: "123" }]);
    const result = await call("list_integrations", {});
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(6);
    expect(result.data.find((item: { provider: string }) => item.provider === "telegram").status).toBe("connected");
  });
});

describe("get_integration_setup_guide", () => {
  it("devolve o passo a passo do provedor", async () => {
    const result = await call("get_integration_setup_guide", { provider: "meta_ads" });
    expect(result.ok).toBe(true);
    expect(result.data.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("rejeita provedor desconhecido", async () => {
    expect((await call("get_integration_setup_guide", { provider: "tiktok" })).ok).toBe(false);
  });
});
