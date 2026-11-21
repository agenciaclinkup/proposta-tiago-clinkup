import { describe, expect, it } from "vitest";
import { aggregateCampaignMetrics, computeCampaignMetrics, formatCentsBRL, parseBRLToCents } from "./metrics";

describe("métricas e formatação de Meta Ads", () => {
  it("calcula CTR, CPC e CPL com segurança quando denominadores são zero", () => {
    expect(computeCampaignMetrics({})).toEqual({
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      roas: 0,
      ctrPercent: 0,
      cpcCents: 0,
      cplCents: 0,
    });
    expect(computeCampaignMetrics({ spend: 100, impressions: 2000, clicks: 50, leads: 5, roas: 3.2 })).toEqual({
      spendCents: 10000,
      impressions: 2000,
      clicks: 50,
      leads: 5,
      roas: 3.2,
      ctrPercent: 2.5,
      cpcCents: 200,
      cplCents: 2000,
    });
  });

  it("agrega campanhas e soma orçamento diário apenas das ativas", () => {
    const totals = aggregateCampaignMetrics([
      { status: "active", daily_budget_cents: 5000, metrics: { spend: 40, impressions: 1000, clicks: 20, leads: 4 } },
      { status: "paused", daily_budget_cents: 8000, metrics: { spend: 60, impressions: 3000, clicks: 60, leads: 6 } },
    ]);
    expect(totals).toEqual({
      spendCents: 10000,
      impressions: 4000,
      clicks: 80,
      leads: 10,
      ctrPercent: 2,
      cpcCents: 125,
      activeCount: 1,
      activeDailyBudgetCents: 5000,
    });
  });

  it("converte valores monetários em reais para centavos e formata em BRL", () => {
    expect(parseBRLToCents("150,50")).toBe(15050);
    expect(parseBRLToCents("R$ 1.250,00")).toBe(125000);
    expect(parseBRLToCents("0")).toBe(0);
    expect(parseBRLToCents("-10")).toBeNull();
    expect(parseBRLToCents("abc")).toBeNull();
    expect(formatCentsBRL(15050)).toContain("150,50");
  });
});
