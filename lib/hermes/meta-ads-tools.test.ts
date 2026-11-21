import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";

const recordHermesLog = vi.fn();
const rateLimit = vi.fn();
const metaAds = {
  checkAdsReadiness: vi.fn(),
  listAdAccounts: vi.fn(),
  listAdCampaigns: vi.fn(),
  listAdActionLogs: vi.fn(),
  syncAccountCampaignsAndMetrics: vi.fn(),
  pauseAdCampaign: vi.fn(),
  proposeCreateCampaign: vi.fn(),
  proposeActivateCampaign: vi.fn(),
  proposeUpdateCampaignBudget: vi.fn(),
  confirmAdAction: vi.fn(),
};

vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  RATE_LIMIT_MESSAGE: "Muitas tentativas em pouco tempo.",
  RATE_LIMITS: {
    metaAdsSync: { limit: 10, windowSeconds: 600 },
    metaAdsWrite: { limit: 20, windowSeconds: 600 },
    prospectingSearch: { limit: 5, windowSeconds: 600 },
    crmUser: { limit: 120, windowSeconds: 60 },
    studioGenerateUser: { limit: 10, windowSeconds: 60 },
  },
}));
vi.mock("@/lib/services/meta-ads", async (original) => ({
  ...(await original<typeof import("@/lib/services/meta-ads")>()),
  ...metaAds,
}));

const { buildHermesTools } = await import("./tools");
const { toolLabel } = await import("./tool-labels");

const org = "11111111-1111-4111-8111-111111111111";
const accountId = "33333333-3333-4333-8333-333333333333";
const campaignId = "55555555-5555-4555-8555-555555555555";
const ctxWeb = { organizationId: org, userId: "user-1", via: "hermes", channel: "web", planId: "growth" } as ServiceContext;
const ctxTelegram = { organizationId: org, userId: "user-1", via: "hermes", channel: "telegram", planId: "growth" } as ServiceContext;
const binding = { conversationId: "conv-1", proof: null as string | null, messageId: "msg-1" };
const proof = "d".repeat(32);

type Result = { ok: boolean; data?: Record<string, unknown>; error?: string };
const call = (name: string, input: unknown, tools = buildHermesTools(ctxWeb, binding)) =>
  (tools[name] as unknown as { execute: (input: unknown, options: object) => Promise<Result> }).execute(input, { toolCallId: "t1", messages: [] });

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue(true);
});

describe("Tools do Meta Ads no Hermes", () => {
  it("registra todas as Tools com rótulos em português", () => {
    const names = Object.keys(buildHermesTools(ctxWeb, binding));
    for (const name of [
      "check_ads_readiness",
      "list_ad_accounts",
      "list_ad_campaigns",
      "list_ad_action_logs",
      "sync_ad_campaigns",
      "pause_ad_campaign",
      "propose_ad_campaign",
      "propose_activate_ad_campaign",
      "propose_update_ad_budget",
      "confirm_ad_action",
    ]) {
      expect(names).toContain(name);
      expect(toolLabel(name).running).toMatch(/…$/);
      expect(toolLabel(name).done).not.toBe("Ação executada");
    }
  });

  it("consulta contas, campanhas com KPIs calculados e histórico de auditoria", async () => {
    metaAds.listAdAccounts.mockResolvedValueOnce([
      {
        id: accountId,
        external_ad_account_id: "act_1",
        name: "Conta Principal",
        currency: "BRL",
        account_status: 1,
        pixel_id: "px_1",
        daily_budget_cap_cents: 10000,
        monthly_budget_cap_cents: 300000,
        last_synced_at: null,
      },
    ]);
    const accountsRes = await call("list_ad_accounts", {});
    expect(accountsRes.ok).toBe(true);
    expect(accountsRes.data).toEqual([
      expect.objectContaining({ adAccountId: accountId, dailyBudgetCapCents: 10000 }),
    ]);

    metaAds.listAdCampaigns.mockResolvedValueOnce([
      {
        id: campaignId,
        ad_account_id: accountId,
        name: "Leads",
        objective: "OUTCOME_LEADS",
        status: "active",
        daily_budget_cents: 5000,
        metrics: { spend: 100, impressions: 2000, clicks: 50, leads: 5 },
        last_synced_at: null,
      },
    ]);
    const campaignsRes = await call("list_ad_campaigns", { adAccountId: accountId });
    expect(campaignsRes.ok).toBe(true);
    expect(campaignsRes.data).toMatchObject({
      totals: { spendCents: 10000, ctrPercent: 2.5, cpcCents: 200, activeCount: 1 },
      campaigns: [expect.objectContaining({ campaignId, metrics: expect.objectContaining({ ctrPercent: 2.5, cpcCents: 200 }) })],
    });

    metaAds.listAdActionLogs.mockResolvedValueOnce([{ id: "log-1", action: "sync", status: "succeeded" }]);
    const logsRes = await call("list_ad_action_logs", {});
    expect(logsRes.ok).toBe(true);
    expect(metaAds.listAdActionLogs).toHaveBeenCalledWith(ctxWeb, 15);
  });

  it("usa chave requestId UUID v5 idempotente na mesma mensagem para propose_ad_campaign e oculta o código no log", async () => {
    metaAds.proposeCreateCampaign.mockResolvedValue({
      code: proof,
      operation: "create_campaign",
      adAccountName: "Conta Principal",
      dailyBudgetCapCents: 10000,
      campaign: {
        adAccountId: accountId,
        requestId: "req",
        name: "Leads Novembro",
        objective: "OUTCOME_LEADS",
        dailyBudgetCents: 5000,
        initialStatus: "paused",
      },
    });
    const input = {
      adAccountId: accountId,
      name: "Leads Novembro",
      objective: "OUTCOME_LEADS",
      dailyBudgetCents: 5000,
    };

    const first = await call("propose_ad_campaign", input, buildHermesTools(ctxTelegram, binding));
    const second = await call("propose_ad_campaign", input, buildHermesTools(ctxTelegram, binding));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.data).toMatchObject({
      requiresConfirmation: true,
      instruction: `Para confirmar a criação desta campanha no Meta Ads, responda exatamente: CONFIRMAR ${proof}`,
    });

    const [req1, req2] = metaAds.proposeCreateCampaign.mock.calls.map(([, , arg]) => arg.requestId);
    expect(req1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(req2).toBe(req1);

    // Código de confirmação nunca é gravado em hermes_logs.
    expect(recordHermesLog).toHaveBeenCalledWith(
      ctxTelegram,
      expect.objectContaining({
        toolName: "propose_ad_campaign",
        output: expect.objectContaining({ instruction: undefined, requiresConfirmation: true }),
      }),
    );
  });

  it("propõe ativação e ajuste de orçamento com confirmação persistente", async () => {
    metaAds.proposeActivateCampaign.mockResolvedValueOnce({
      code: proof,
      operation: "activate_campaign",
      campaignName: "Leads",
      dailyBudgetCents: 5000,
    });
    const act = await call("propose_activate_ad_campaign", { campaignId });
    expect(act.ok).toBe(true);
    expect(act.data?.instruction).toContain(`CONFIRMAR ${proof}`);

    metaAds.proposeUpdateCampaignBudget.mockResolvedValueOnce({
      code: proof,
      operation: "update_budget",
      campaignName: "Leads",
      previousDailyBudgetCents: 5000,
      newDailyBudgetCents: 7500,
    });
    const upd = await call("propose_update_ad_budget", { campaignId, dailyBudgetCents: 7500 });
    expect(upd.ok).toBe(true);
    expect(upd.data?.instruction).toContain(`CONFIRMAR ${proof}`);
  });

  it("recusa confirm_ad_action sem prova confiável da mensagem e executa apenas com approval.proof", async () => {
    const noProofTools = buildHermesTools(ctxTelegram, { conversationId: "conv-1", proof: null, messageId: "msg-2" });
    const rejected = await call("confirm_ad_action", { proof }, noProofTools);
    expect(rejected.ok).toBe(false);
    expect(metaAds.confirmAdAction).not.toHaveBeenCalled();

    metaAds.confirmAdAction.mockResolvedValueOnce({ operation: "activate_campaign", campaign: { id: campaignId, status: "active" } });
    const validTools = buildHermesTools(ctxWeb, { conversationId: "conv-1", proof, messageId: "msg-2" });
    const ok = await call("confirm_ad_action", {}, validTools);
    expect(ok).toEqual({
      ok: true,
      data: { operation: "activate_campaign", campaign: { id: campaignId, status: "active" } },
    });
    expect(metaAds.confirmAdAction).toHaveBeenCalledWith(ctxWeb, { conversationId: "conv-1" }, proof);
  });

  it("executa pausa segura e respeita rate limit e erros de plano/teto em pt-BR", async () => {
    metaAds.pauseAdCampaign.mockResolvedValueOnce({ id: campaignId, name: "Leads", status: "paused" });
    expect(await call("pause_ad_campaign", { campaignId })).toEqual({
      ok: true,
      data: { campaignId, name: "Leads", status: "paused" },
    });

    rateLimit.mockResolvedValueOnce(false);
    expect(await call("sync_ad_campaigns", { adAccountId: accountId })).toEqual({
      ok: false,
      error: "Muitas tentativas em pouco tempo.",
    });
    expect(metaAds.syncAccountCampaignsAndMetrics).not.toHaveBeenCalled();

    metaAds.proposeActivateCampaign.mockRejectedValueOnce(new ServiceError("Configure primeiro o teto diário de orçamento."));
    expect(await call("propose_activate_ad_campaign", { campaignId })).toEqual({
      ok: false,
      error: "Configure primeiro o teto diário de orçamento.",
    });
  });
});
