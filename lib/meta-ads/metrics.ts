export type RawCampaignMetrics = {
  spend?: number;
  impressions?: number;
  clicks?: number;
  leads?: number;
  roas?: number;
};

export type ComputedCampaignMetrics = {
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  roas: number;
  ctrPercent: number;
  cpcCents: number;
  cplCents: number;
};

export function computeCampaignMetrics(raw: RawCampaignMetrics | Record<string, unknown> | null | undefined): ComputedCampaignMetrics {
  const m = (raw ?? {}) as RawCampaignMetrics;
  const spend = typeof m.spend === "number" && Number.isFinite(m.spend) && m.spend >= 0 ? m.spend : 0;
  const spendCents = Math.round(spend * 100);
  const impressions = typeof m.impressions === "number" && Number.isFinite(m.impressions) && m.impressions >= 0 ? Math.round(m.impressions) : 0;
  const clicks = typeof m.clicks === "number" && Number.isFinite(m.clicks) && m.clicks >= 0 ? Math.round(m.clicks) : 0;
  const leads = typeof m.leads === "number" && Number.isFinite(m.leads) && m.leads >= 0 ? Math.round(m.leads) : 0;
  const roas = typeof m.roas === "number" && Number.isFinite(m.roas) && m.roas >= 0 ? m.roas : 0;

  const ctrPercent = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpcCents = clicks > 0 ? Math.round(spendCents / clicks) : 0;
  const cplCents = leads > 0 ? Math.round(spendCents / leads) : 0;

  return { spendCents, impressions, clicks, leads, roas, ctrPercent, cpcCents, cplCents };
}

export function aggregateCampaignMetrics(
  campaigns: { status: string; daily_budget_cents: number; metrics: Record<string, unknown> }[],
) {
  let spendCents = 0;
  let impressions = 0;
  let clicks = 0;
  let leads = 0;
  let activeCount = 0;
  let activeDailyBudgetCents = 0;

  for (const campaign of campaigns) {
    const computed = computeCampaignMetrics(campaign.metrics);
    spendCents += computed.spendCents;
    impressions += computed.impressions;
    clicks += computed.clicks;
    leads += computed.leads;
    if (campaign.status === "active") {
      activeCount++;
      activeDailyBudgetCents += campaign.daily_budget_cents;
    }
  }

  return {
    spendCents,
    impressions,
    clicks,
    leads,
    ctrPercent: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : 0,
    activeCount,
    activeDailyBudgetCents,
  };
}

export function formatCentsBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatPercentBR(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function parseBRLToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "Geração de leads",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_SALES: "Vendas",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  paused: "Pausada",
  active: "Ativa",
  archived: "Arquivada",
  error: "Com erro",
};

export const ACTION_LOG_LABELS: Record<string, string> = {
  update_caps: "Tetos de orçamento atualizados",
  sync: "Sincronização com Meta Ads",
  create_campaign: "Criação de campanha",
  activate_campaign: "Ativação de campanha",
  pause_campaign: "Pausa de campanha",
  update_budget: "Alteração de orçamento diário",
};
