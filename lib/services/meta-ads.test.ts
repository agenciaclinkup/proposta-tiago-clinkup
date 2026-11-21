import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSimulatedMetaAdsClient } from "@/lib/integrations/meta-ads-client";
import type { ServiceContext } from "./context";

const rpc = vi.fn();
const getIntegrationToken = vi.fn();
const memberMaybeSingle = vi.fn();
const accountMaybeSingle = vi.fn();
const campaignMaybeSingle = vi.fn();
const activeCampaignsResult = vi.fn();
const confirmInsert = vi.fn();
const campaignInsertSingle = vi.fn();
const campaignUpdateSingle = vi.fn();
const accountUpdateSingle = vi.fn();
const logInsert = vi.fn();

const from = vi.fn((table: string) => {
  if (table === "organization_members") {
    return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: memberMaybeSingle }) }) }) };
  }
  if (table === "meta_ad_accounts") {
    return {
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: accountMaybeSingle }) }) }),
      update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: accountUpdateSingle }) }) }) }),
    };
  }
  if (table === "ad_campaigns") {
    return {
      select: (cols: string) => {
        if (cols === "id, daily_budget_cents") {
          return { eq: () => ({ eq: () => ({ eq: activeCampaignsResult }) }) };
        }
        return { eq: () => ({ eq: () => ({ maybeSingle: campaignMaybeSingle }) }) };
      },
      insert: () => ({ select: () => ({ single: campaignInsertSingle }) }),
      update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: campaignUpdateSingle }) }) }) }),
    };
  }
  if (table === "ad_action_confirmations") {
    return { insert: confirmInsert };
  }
  if (table === "ad_action_logs") {
    return { insert: logInsert };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
vi.mock("./integrations", () => ({ getIntegrationToken }));

const {
  updateAdAccountBudgetCaps,
  proposeCreateCampaign,
  proposeActivateCampaign,
  proposeUpdateCampaignBudget,
  confirmAdAction,
  pauseAdCampaign,
} = await import("./meta-ads");

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const integrationId = "44444444-4444-4444-8444-444444444444";
const campaignId = "55555555-5555-4555-8555-555555555555";
const requestId = "66666666-6666-4666-8666-666666666666";
const binding = { conversationId: "77777777-7777-4777-8777-777777777777" };
const proof = "c".repeat(32);

const ctxGrowth = { organizationId: org, userId: user, planId: "growth", via: "hermes", channel: "web" } as ServiceContext;
const ctxStarter = { ...ctxGrowth, planId: "starter" } as ServiceContext;

const baseAccount = {
  id: accountId,
  organization_id: org,
  integration_id: integrationId,
  external_ad_account_id: "act_999",
  name: "Conta Principal",
  currency: "BRL",
  account_status: 1,
  business_id: null,
  pixel_id: "px_1",
  daily_budget_cap_cents: 10000,
  monthly_budget_cap_cents: 300000,
  last_synced_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  memberMaybeSingle.mockResolvedValue({ data: { role: "admin" }, error: null });
  accountMaybeSingle.mockResolvedValue({ data: baseAccount, error: null });
  campaignMaybeSingle.mockResolvedValue({ data: null, error: null });
  activeCampaignsResult.mockResolvedValue({ data: [], error: null });
  confirmInsert.mockResolvedValue({ error: null });
  logInsert.mockResolvedValue({ error: null });
  getIntegrationToken.mockResolvedValue({ accessToken: "secret-tok", refreshToken: null, expiresAt: null });
});

describe("proteções financeiras e plano em Meta Ads", () => {
  it("bloqueia o módulo Meta Ads no plano Starter", async () => {
    await expect(
      proposeCreateCampaign(ctxStarter, binding, {
        adAccountId: accountId,
        requestId,
        name: "Campanha",
        objective: "OUTCOME_LEADS",
        dailyBudgetCents: 2000,
      }),
    ).rejects.toThrow("planos Growth e Scale");
    expect(confirmInsert).not.toHaveBeenCalled();
  });

  it("bloqueia membro comum em ações financeiras e alteração de tetos", async () => {
    memberMaybeSingle.mockResolvedValueOnce({ data: { role: "member" }, error: null });
    await expect(
      updateAdAccountBudgetCaps(ctxGrowth, { adAccountId: accountId, dailyBudgetCapCents: 10000, monthlyBudgetCapCents: 300000 }),
    ).rejects.toThrow("proprietários e administradores");
  });

  it("impede criar campanha paga quando o teto diário da conta ainda é zero", async () => {
    accountMaybeSingle.mockResolvedValueOnce({ data: { ...baseAccount, daily_budget_cap_cents: 0 }, error: null });
    await expect(
      proposeCreateCampaign(ctxGrowth, binding, {
        adAccountId: accountId,
        requestId,
        name: "Campanha",
        objective: "OUTCOME_LEADS",
        dailyBudgetCents: 2000,
      }),
    ).rejects.toThrow("Configure primeiro o teto diário");
    expect(confirmInsert).not.toHaveBeenCalled();
  });

  it("impede criar ou ajustar orçamento acima do teto diário ou projeção mensal", async () => {
    await expect(
      proposeCreateCampaign(ctxGrowth, binding, {
        adAccountId: accountId,
        requestId,
        name: "Acima do teto",
        objective: "OUTCOME_LEADS",
        dailyBudgetCents: 15000,
      }),
    ).rejects.toThrow("ultrapassa o teto diário");

    campaignMaybeSingle.mockResolvedValueOnce({
      data: { id: campaignId, ad_account_id: accountId, status: "active", daily_budget_cents: 5000, name: "C1" },
      error: null,
    });
    accountMaybeSingle.mockResolvedValueOnce({ data: { ...baseAccount, daily_budget_cap_cents: 10000, monthly_budget_cap_cents: 200000 }, error: null });
    await expect(
      proposeUpdateCampaignBudget(ctxGrowth, binding, { campaignId, dailyBudgetCents: 8000 }),
    ).rejects.toThrow("teto mensal");
  });

  it("impede ativar campanha quando soma das ativas ultrapassa o teto diário", async () => {
    campaignMaybeSingle.mockResolvedValueOnce({
      data: { id: campaignId, ad_account_id: accountId, external_campaign_id: "ext_1", status: "paused", daily_budget_cents: 6000, name: "C2" },
      error: null,
    });
    activeCampaignsResult.mockResolvedValueOnce({ data: [{ id: "other-camp", daily_budget_cents: 5000 }], error: null });
    await expect(proposeActivateCampaign(ctxGrowth, binding, { campaignId })).rejects.toThrow("soma do orçamento diário");
  });

  it("gera confirmação persistente e executa criação via cliente simulado com auditoria", async () => {
    const proposal = await proposeCreateCampaign(ctxGrowth, binding, {
      adAccountId: accountId,
      requestId,
      name: "Leads Novembro",
      objective: "OUTCOME_LEADS",
      dailyBudgetCents: 3000,
      initialStatus: "paused",
    });
    expect(proposal.code).toMatch(/^[0-9a-f]{32}$/);
    expect(confirmInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: org,
        user_id: user,
        operation: "create_campaign",
        proof_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );

    rpc.mockResolvedValueOnce({
      data: {
        operation: "create_campaign",
        adAccountId: accountId,
        integrationId,
        externalAdAccountId: "act_999",
        campaignId: null,
        payload: proposal.campaign,
      },
      error: null,
    });
    campaignInsertSingle.mockResolvedValueOnce({
      data: { id: campaignId, name: "Leads Novembro", external_campaign_id: "sim_camp_1", status: "paused", daily_budget_cents: 3000 },
      error: null,
    });

    const sim = createSimulatedMetaAdsClient();
    const confirmed = await confirmAdAction(ctxGrowth, binding, proof, sim);
    expect(confirmed).toMatchObject({
      operation: "create_campaign",
      idempotent: false,
      campaign: { id: campaignId, external_campaign_id: "sim_camp_1", status: "paused" },
    });
    expect(getIntegrationToken).toHaveBeenCalledWith(org, integrationId);
    expect(logInsert).toHaveBeenCalledWith(expect.objectContaining({ action: "create_campaign", status: "succeeded" }));
  });

  it("rejeita prova malformada e traduz erro de confirmação expirada/reutilizada", async () => {
    await expect(confirmAdAction(ctxGrowth, binding, "curto")).rejects.toThrow("Confirmação inválida");
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValueOnce({ data: null, error: { message: "confirmation_invalid" } });
    await expect(confirmAdAction(ctxGrowth, binding, proof)).rejects.toThrow("expirou, já foi usada");
  });

  it("pausa campanha ativa sem exigir confirmação financeira e registra auditoria", async () => {
    campaignMaybeSingle.mockResolvedValueOnce({
      data: { id: campaignId, ad_account_id: accountId, integration_id: integrationId, external_campaign_id: "sim_camp_1", status: "active", daily_budget_cents: 3000 },
      error: null,
    });
    campaignUpdateSingle.mockResolvedValueOnce({ data: { id: campaignId, status: "paused" }, error: null });
    const sim = createSimulatedMetaAdsClient({
      campaigns: [{ id: "sim_camp_1", name: "Ativa", objective: "OUTCOME_LEADS", status: "ACTIVE", daily_budget: 3000 }],
    });

    const paused = await pauseAdCampaign(ctxGrowth, { campaignId }, sim);
    expect(paused.status).toBe("paused");
    expect((await sim.listCampaigns("act_999", "tok"))[0]?.status).toBe("PAUSED");
    expect(logInsert).toHaveBeenCalledWith(expect.objectContaining({ action: "pause_campaign", status: "succeeded" }));
  });
});
