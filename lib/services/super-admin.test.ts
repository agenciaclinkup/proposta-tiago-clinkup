import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SuperAdminActor } from "@/lib/super-admin";

const rpc = vi.fn();
const orgMaybeSingle = vi.fn();
const subMaybeSingle = vi.fn();
const orgUpdateEq = vi.fn();
const subUpsert = vi.fn();
const auditInsert = vi.fn();

const from = vi.fn((table: string) => {
  if (table === "organizations") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: orgMaybeSingle }) }),
      update: () => ({ eq: orgUpdateEq }),
    };
  }
  if (table === "subscriptions") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: subMaybeSingle }) }),
      upsert: subUpsert,
    };
  }
  if (table === "admin_audit_logs") {
    return { insert: auditInsert };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));

const { buildAdminOverview, adminUpdateTenantSubscription, adminAdjustTenantAiCredits } = await import("./super-admin");

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const actor: SuperAdminActor = { id: "admin-1", email: "admin@clinkup.com", fullName: "Equipe Clinkup" };

beforeEach(() => {
  vi.clearAllMocks();
  orgMaybeSingle.mockResolvedValue({ data: { id: orgA, name: "Clínica A", plan_id: "starter", is_white_label: false }, error: null });
  subMaybeSingle.mockResolvedValue({ data: { plan_id: "starter", status: "trialing", provider: "manual" }, error: null });
  orgUpdateEq.mockResolvedValue({ error: null });
  subUpsert.mockResolvedValue({ error: null });
  auditInsert.mockResolvedValue({ error: null });
});

describe("buildAdminOverview", () => {
  it("calcula KPIs globais, distribuição por plano, status e soma bônus de créditos", () => {
    const overview = buildAdminOverview({
      organizations: [
        { id: orgA, name: "Clínica A", slug: "clinica-a", niche: "Saúde", plan_id: "starter", is_white_label: false, created_at: "2026-11-01T10:00:00Z" },
        { id: orgB, name: "Agência B", slug: "agencia-b", niche: "Marketing", plan_id: "scale", is_white_label: true, created_at: "2026-11-02T10:00:00Z" },
      ],
      subscriptions: [
        { organization_id: orgA, plan_id: "growth", status: "active", provider: "stripe", current_period_end: null },
        { organization_id: orgB, plan_id: "scale", status: "past_due", provider: "stripe", current_period_end: null },
      ],
      usageRows: [
        { organization_id: orgA, metric: "ai_credits", used: 120, bonus: 200 },
        { organization_id: orgA, metric: "scraped_leads", used: 45, bonus: 0 },
        { organization_id: orgB, metric: "ai_credits", used: 80, bonus: 0 },
      ],
      integrations: [
        { organization_id: orgA, status: "connected" },
        { organization_id: orgA, status: "disconnected" },
        { organization_id: orgB, status: "connected" },
      ],
    });

    expect(overview.totalOrganizations).toBe(2);
    expect(overview.whiteLabelOrganizations).toBe(1);
    expect(overview.planDistribution).toEqual({ starter: 0, growth: 1, scale: 1 });
    expect(overview.activeSubscriptions).toBe(1);
    expect(overview.pastDueSubscriptions).toBe(1);
    expect(overview.totalAiCreditsUsedMonth).toBe(200);
    expect(overview.totalScrapedLeadsMonth).toBe(45);
    expect(overview.tenants[0]).toMatchObject({
      planId: "growth",
      aiCreditsUsed: 120,
      aiCreditsBonus: 200,
      aiCreditsLimit: 3200,
      connectedIntegrations: 1,
    });
  });
});

describe("ações administrativas auditadas", () => {
  it("atualiza plano/status/white-label e grava auditoria imutável", async () => {
    const res = await adminUpdateTenantSubscription(actor, {
      organizationId: orgA,
      planId: "scale",
      status: "active",
      isWhiteLabel: true,
      reason: "Licença cortesia parceria estratégica",
    });

    expect(res).toMatchObject({ organizationId: orgA, planId: "scale", status: "active", isWhiteLabel: true });
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: actor.id,
        actor_email: actor.email,
        target_organization_id: orgA,
        action: "update_subscription",
        reason: "Licença cortesia parceria estratégica",
        before_state: { planId: "starter", status: "trialing", isWhiteLabel: false },
        after_state: { planId: "scale", status: "active", isWhiteLabel: true },
      }),
    );
  });

  it("concede bônus de créditos de IA via RPC e registra auditoria", async () => {
    rpc.mockResolvedValueOnce({ data: { used: 10, bonus: 500 }, error: null });
    const res = await adminAdjustTenantAiCredits(actor, {
      organizationId: orgA,
      delta: 500,
      reason: "Bônus de boas-vindas suporte",
    });
    expect(res).toEqual({ organizationId: orgA, organizationName: "Clínica A", used: 10, bonus: 500 });
    expect(rpc).toHaveBeenCalledWith("grant_usage_bonus", { p_organization_id: orgA, p_metric: "ai_credits", p_delta: 500 });
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "adjust_ai_credits", after_state: { used: 10, bonus: 500 } }),
    );
  });

  it("recusa motivo curto ou delta zero antes de tocar no banco", async () => {
    await expect(
      adminAdjustTenantAiCredits(actor, { organizationId: orgA, delta: 0, reason: "Teste" }),
    ).rejects.toThrow("diferente de zero");
    await expect(
      adminUpdateTenantSubscription(actor, { organizationId: orgA, planId: "growth", status: "active", isWhiteLabel: false, reason: "ok" }),
    ).rejects.toThrow("mínimo 3");
    expect(rpc).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});
