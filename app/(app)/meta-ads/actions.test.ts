import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const requireWorkspace = vi.fn();
const rateLimit = vi.fn();
const revalidatePath = vi.fn();
const metaAds = {
  syncAdAccountFromIntegration: vi.fn(),
  updateAdAccountBudgetCaps: vi.fn(),
  syncAccountCampaignsAndMetrics: vi.fn(),
  proposeCreateCampaign: vi.fn(),
  proposeActivateCampaign: vi.fn(),
  proposeUpdateCampaignBudget: vi.fn(),
  confirmAdAction: vi.fn(),
  pauseAdCampaign: vi.fn(),
};

vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  RATE_LIMIT_MESSAGE: "Muitas tentativas.",
  RATE_LIMITS: { metaAdsSync: { limit: 10, windowSeconds: 600 }, metaAdsWrite: { limit: 20, windowSeconds: 600 } },
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/services/meta-ads", async (original) => ({
  ...(await original<typeof import("@/lib/services/meta-ads")>()),
  ...metaAds,
}));

const {
  updateBudgetCapsAction,
  syncMetaAdsAction,
  proposeCreateCampaignAction,
  confirmMetaAdsAction,
  pauseCampaignAction,
} = await import("./actions");

const id = "11111111-1111-4111-8111-111111111111";
const reqId = "22222222-2222-4222-8222-222222222222";
const code = "a".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspace.mockResolvedValue({
    supabase: {},
    user: { id },
    organization: { id, plan_id: "growth" },
    role: "admin",
  });
  rateLimit.mockResolvedValue(true);
});

describe("Server Actions de Meta Ads", () => {
  it("valida Zod e aplica rate limit por usuário e organização em tetos de orçamento", async () => {
    expect(await updateBudgetCapsAction({ adAccountId: "invalido", dailyBudgetCapCents: 1000, monthlyBudgetCapCents: 5000 })).toHaveProperty("error");
    expect(await updateBudgetCapsAction({ adAccountId: id, dailyBudgetCapCents: 5000, monthlyBudgetCapCents: 1000 })).toHaveProperty("error");

    rateLimit.mockResolvedValueOnce(false);
    expect(await updateBudgetCapsAction({ adAccountId: id, dailyBudgetCapCents: 5000, monthlyBudgetCapCents: 150000 })).toEqual({ error: "Muitas tentativas." });
    expect(metaAds.updateAdAccountBudgetCaps).not.toHaveBeenCalled();

    metaAds.updateAdAccountBudgetCaps.mockResolvedValueOnce({ id });
    expect(await updateBudgetCapsAction({ adAccountId: id, dailyBudgetCapCents: 5000, monthlyBudgetCapCents: 150000 })).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/meta-ads");
  });

  it("sincroniza campanhas e métricas respeitando rate limit e contexto da organização", async () => {
    metaAds.syncAccountCampaignsAndMetrics.mockResolvedValueOnce({ campaignsSynced: 3, snapshotsSynced: 3 });
    const res = await syncMetaAdsAction({ adAccountId: id });
    expect(res).toEqual({ campaignsSynced: 3, snapshotsSynced: 3 });
    expect(metaAds.syncAccountCampaignsAndMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: id, userId: id, via: "manual" }),
      { adAccountId: id },
    );
  });

  it("exige confirmação explícita antes de chamar confirmAdAction", async () => {
    expect(await confirmMetaAdsAction({ code, confirmed: false })).toHaveProperty("error");
    expect(await confirmMetaAdsAction({ code: "curto", confirmed: true })).toHaveProperty("error");
    expect(metaAds.confirmAdAction).not.toHaveBeenCalled();

    metaAds.confirmAdAction.mockResolvedValueOnce({ operation: "create_campaign" });
    expect(await confirmMetaAdsAction({ code, confirmed: true })).toEqual({ operation: "create_campaign" });
    expect(metaAds.confirmAdAction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: id, userId: id, via: "manual" }),
      { conversationId: null },
      code,
    );
  });

  it("retorna mensagem clara em pt-BR quando plano Starter tenta propor campanha", async () => {
    metaAds.proposeCreateCampaign.mockRejectedValueOnce(new ServiceError("O gestor de campanhas Meta Ads está disponível nos planos Growth e Scale."));
    const res = await proposeCreateCampaignAction({
      adAccountId: id,
      requestId: reqId,
      name: "Leads",
      objective: "OUTCOME_LEADS",
      dailyBudgetCents: 3000,
    });
    expect(res).toEqual({ error: "O gestor de campanhas Meta Ads está disponível nos planos Growth e Scale." });
  });

  it("executa pausa segura de campanha e revalida a página", async () => {
    metaAds.pauseAdCampaign.mockResolvedValueOnce({ id, status: "paused" });
    expect(await pauseCampaignAction({ campaignId: id })).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/meta-ads");
  });
});
