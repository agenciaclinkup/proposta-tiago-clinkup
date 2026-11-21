import { describe, expect, it } from "vitest";
import { buildExecutiveDashboardMetrics, parseDashboardPeriod } from "./dashboard";

describe("parseDashboardPeriod", () => {
  it("normaliza 7d, 30d e 90d e usa 30d como padrão seguro", () => {
    expect(parseDashboardPeriod("7d")).toBe("7d");
    expect(parseDashboardPeriod("90d")).toBe("90d");
    expect(parseDashboardPeriod(["7d", "30d"])).toBe("7d");
    expect(parseDashboardPeriod("invalido")).toBe("30d");
    expect(parseDashboardPeriod(undefined)).toBe("30d");
  });
});

describe("buildExecutiveDashboardMetrics", () => {
  const now = new Date("2026-11-21T12:00:00Z").getTime();
  const since30d = now - 30 * 86_400_000;

  it("evita divisão por zero quando não há dados em nenhum módulo", () => {
    const result = buildExecutiveDashboardMetrics({
      period: "30d",
      sinceMs: since30d,
      openOpportunities: 0,
      funnel: { total: 0, conversion: null, totalValue: 0, stages: [] },
      newLeadsInPeriod: 0,
      posts: [],
      integrations: [],
      prospects: [],
      carouselsCount: 0,
      publishedLandingsCount: 0,
      aiCredits: { used: 0, limit: 500 },
      snapshots: [],
      fallbackCampaigns: [],
    });

    expect(result.crm.conversionRate).toBeNull();
    expect(result.prospectingStudio.prospectToCrmRate).toBe(0);
    expect(result.metaAds).toEqual({
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      ctrPercent: 0,
      cpcCents: 0,
      cplCents: 0,
      trend: [],
    });
  });

  it("consolida CRM, Conteúdo, Prospecção, Estúdio e snapshots de Meta Ads no período", () => {
    const result = buildExecutiveDashboardMetrics({
      period: "30d",
      sinceMs: since30d,
      openOpportunities: 8,
      funnel: {
        total: 10,
        conversion: 0.2,
        totalValue: 25000,
        stages: [
          { name: "Novo Lead", count: 5, reached: 10, passRate: 0.5 },
          { name: "Fechado", count: 2, reached: 2, passRate: null },
        ],
      },
      newLeadsInPeriod: 6,
      posts: [
        { status: "published", published_at: "2026-11-15T10:00:00Z", scheduled_at: null, created_at: "2026-11-10T10:00:00Z" },
        { status: "published", published_at: "2026-09-01T10:00:00Z", scheduled_at: null, created_at: "2026-09-01T10:00:00Z" },
        { status: "scheduled", published_at: null, scheduled_at: "2026-11-25T10:00:00Z", created_at: "2026-11-18T10:00:00Z" },
        { status: "draft", published_at: null, scheduled_at: null, created_at: "2026-11-19T10:00:00Z" },
      ],
      integrations: [{ status: "connected" }, { status: "connected" }, { status: "needs_attention" }],
      prospects: [
        { status: "sent_to_crm", created_at: "2026-11-18T10:00:00Z" },
        { status: "new", created_at: "2026-11-19T10:00:00Z" },
        { status: "sent_to_crm", created_at: "2026-08-01T10:00:00Z" },
        { status: "new", created_at: "2026-08-02T10:00:00Z" },
      ],
      carouselsCount: 4,
      publishedLandingsCount: 2,
      aiCredits: { used: 120, limit: 3000 },
      snapshots: [
        { date_start: "2026-11-18", date_stop: "2026-11-18", spend_cents: 5000, impressions: 1000, clicks: 25, leads: 5, roas: 2.5 },
        { date_start: "2026-11-19", date_stop: "2026-11-19", spend_cents: 10000, impressions: 3000, clicks: 75, leads: 10, roas: 3.1 },
      ],
      fallbackCampaigns: [],
    });

    expect(result.crm).toMatchObject({ totalLeads: 10, openOpportunities: 8, newLeadsInPeriod: 6, conversionRate: 0.2, totalValue: 25000 });
    expect(result.content).toEqual({
      publishedInPeriod: 1,
      publishedTotal: 2,
      scheduledCount: 1,
      draftCount: 1,
      failedCount: 0,
      connectedAccounts: 2,
      needsAttentionAccounts: 1,
    });
    expect(result.prospectingStudio).toEqual({
      prospectsTotal: 4,
      prospectsCapturedInPeriod: 2,
      prospectsSentToCrm: 2,
      prospectToCrmRate: 0.5,
      carouselsCount: 4,
      publishedLandingsCount: 2,
      aiCreditsUsed: 120,
      aiCreditsLimit: 3000,
    });
    expect(result.metaAds).toEqual({
      spendCents: 15000,
      impressions: 4000,
      clicks: 100,
      leads: 15,
      ctrPercent: 2.5,
      cpcCents: 150,
      cplCents: 1000,
      trend: [
        { date: "18/11", spendBRL: 50, leads: 5, clicks: 25 },
        { date: "19/11", spendBRL: 100, leads: 10, clicks: 75 },
      ],
    });
  });

  it("usa métricas agregadas das campanhas quando não há snapshots no período", () => {
    const result = buildExecutiveDashboardMetrics({
      period: "7d",
      sinceMs: since30d,
      openOpportunities: 0,
      funnel: { total: 0, conversion: null, totalValue: 0, stages: [] },
      newLeadsInPeriod: 0,
      posts: [],
      integrations: [],
      prospects: [],
      carouselsCount: 0,
      publishedLandingsCount: 0,
      aiCredits: { used: 0, limit: 500 },
      snapshots: [],
      fallbackCampaigns: [{ metrics: { spend: 80, impressions: 2000, clicks: 40, leads: 4 } }],
    });
    expect(result.metaAds).toMatchObject({ spendCents: 8000, impressions: 2000, clicks: 40, leads: 4, ctrPercent: 2, cpcCents: 200, cplCents: 2000 });
  });
});
