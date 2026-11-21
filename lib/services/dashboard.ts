import "server-only";
import { z } from "zod";
import { computeCampaignMetrics } from "@/lib/meta-ads/metrics";
import type { ServiceContext } from "./context";
import { countOpenOpportunities, getFunnelMetrics } from "./crm";
import { getUsageSummary } from "./usage";

export const DASHBOARD_PERIODS = ["7d", "30d", "90d"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const dashboardPeriodSchema = z.enum(DASHBOARD_PERIODS);

export const PERIOD_DAYS: Record<DashboardPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
};

export function parseDashboardPeriod(raw?: string | string[]): DashboardPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = dashboardPeriodSchema.safeParse(value);
  return parsed.success ? parsed.data : "30d";
}

type SnapshotRow = {
  date_start: string;
  date_stop: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  roas: number | string;
};

type CampaignMetricRow = {
  metrics: Record<string, unknown> | null;
};

type PostRow = {
  status: string;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string;
};

type ProspectRow = {
  status: string;
  created_at: string;
};

type IntegrationRow = {
  status: string;
};

export type ExecutiveDashboardData = {
  period: DashboardPeriod;
  periodLabel: string;
  crm: {
    totalLeads: number;
    openOpportunities: number;
    newLeadsInPeriod: number;
    conversionRate: number | null;
    totalValue: number;
    stages: { name: string; count: number; reached: number; passRate: number | null }[];
  };
  content: {
    publishedInPeriod: number;
    publishedTotal: number;
    scheduledCount: number;
    draftCount: number;
    failedCount: number;
    connectedAccounts: number;
    needsAttentionAccounts: number;
  };
  prospectingStudio: {
    prospectsTotal: number;
    prospectsCapturedInPeriod: number;
    prospectsSentToCrm: number;
    prospectToCrmRate: number;
    carouselsCount: number;
    publishedLandingsCount: number;
    aiCreditsUsed: number;
    aiCreditsLimit: number;
  };
  metaAds: {
    spendCents: number;
    impressions: number;
    clicks: number;
    leads: number;
    ctrPercent: number;
    cpcCents: number;
    cplCents: number;
    trend: { date: string; spendBRL: number; leads: number; clicks: number }[];
  };
};

// Agregação pura e determinística sem divisão por zero (facilita validação e testes unitários).
export function buildExecutiveDashboardMetrics(input: {
  period: DashboardPeriod;
  sinceMs: number;
  openOpportunities: number;
  funnel: {
    total: number;
    conversion: number | null;
    totalValue: number;
    stages: { name: string; count: number; reached: number; passRate: number | null }[];
  };
  newLeadsInPeriod: number;
  posts: PostRow[];
  integrations: IntegrationRow[];
  prospects: ProspectRow[];
  carouselsCount: number;
  publishedLandingsCount: number;
  aiCredits: { used: number; limit: number };
  snapshots: SnapshotRow[];
  fallbackCampaigns: CampaignMetricRow[];
}): ExecutiveDashboardData {
  const inPeriod = (iso: string | null) => (iso ? new Date(iso).getTime() >= input.sinceMs : false);

  let publishedInPeriod = 0;
  let publishedTotal = 0;
  let scheduledCount = 0;
  let draftCount = 0;
  let failedCount = 0;
  for (const post of input.posts) {
    if (post.status === "published") {
      publishedTotal++;
      if (inPeriod(post.published_at ?? post.created_at)) publishedInPeriod++;
    } else if (post.status === "scheduled" || post.status === "publishing") {
      scheduledCount++;
    } else if (post.status === "draft") {
      draftCount++;
    } else if (post.status === "failed") {
      failedCount++;
    }
  }

  let connectedAccounts = 0;
  let needsAttentionAccounts = 0;
  for (const item of input.integrations) {
    if (item.status === "connected") connectedAccounts++;
    else if (item.status === "needs_attention") needsAttentionAccounts++;
  }

  let prospectsCapturedInPeriod = 0;
  let prospectsSentToCrm = 0;
  for (const prospect of input.prospects) {
    if (inPeriod(prospect.created_at)) prospectsCapturedInPeriod++;
    if (prospect.status === "sent_to_crm") prospectsSentToCrm++;
  }
  const prospectsTotal = input.prospects.length;
  const prospectToCrmRate = prospectsTotal > 0 ? prospectsSentToCrm / prospectsTotal : 0;

  let spendCents = 0;
  let impressions = 0;
  let clicks = 0;
  let leads = 0;
  const trendMap = new Map<string, { spendCents: number; leads: number; clicks: number }>();

  if (input.snapshots.length > 0) {
    for (const snap of input.snapshots) {
      const s = Math.max(0, Math.round(Number(snap.spend_cents) || 0));
      const imp = Math.max(0, Math.round(Number(snap.impressions) || 0));
      const clk = Math.max(0, Math.round(Number(snap.clicks) || 0));
      const lds = Math.max(0, Math.round(Number(snap.leads) || 0));
      spendCents += s;
      impressions += imp;
      clicks += clk;
      leads += lds;
      const bucket = trendMap.get(snap.date_start) ?? { spendCents: 0, leads: 0, clicks: 0 };
      bucket.spendCents += s;
      bucket.leads += lds;
      bucket.clicks += clk;
      trendMap.set(snap.date_start, bucket);
    }
  } else {
    for (const camp of input.fallbackCampaigns) {
      const m = computeCampaignMetrics(camp.metrics);
      spendCents += m.spendCents;
      impressions += m.impressions;
      clicks += m.clicks;
      leads += m.leads;
    }
  }

  const trend = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      spendBRL: Number((bucket.spendCents / 100).toFixed(2)),
      leads: bucket.leads,
      clicks: bucket.clicks,
    }));

  return {
    period: input.period,
    periodLabel: PERIOD_LABELS[input.period],
    crm: {
      totalLeads: input.funnel.total,
      openOpportunities: input.openOpportunities,
      newLeadsInPeriod: input.newLeadsInPeriod,
      conversionRate: input.funnel.conversion,
      totalValue: input.funnel.totalValue,
      stages: input.funnel.stages.map((s) => ({
        name: s.name,
        count: s.count,
        reached: s.reached,
        passRate: s.passRate,
      })),
    },
    content: {
      publishedInPeriod,
      publishedTotal,
      scheduledCount,
      draftCount,
      failedCount,
      connectedAccounts,
      needsAttentionAccounts,
    },
    prospectingStudio: {
      prospectsTotal,
      prospectsCapturedInPeriod,
      prospectsSentToCrm,
      prospectToCrmRate,
      carouselsCount: input.carouselsCount,
      publishedLandingsCount: input.publishedLandingsCount,
      aiCreditsUsed: input.aiCredits.used,
      aiCreditsLimit: input.aiCredits.limit,
    },
    metaAds: {
      spendCents,
      impressions,
      clicks,
      leads,
      ctrPercent: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : 0,
      cplCents: leads > 0 ? Math.round(spendCents / leads) : 0,
      trend,
    },
  };
}

export async function getExecutiveDashboard(ctx: ServiceContext, period: DashboardPeriod = "30d") {
  const days = PERIOD_DAYS[period];
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const [
    usage,
    openOpportunities,
    funnel,
    newLeadsRes,
    postsRes,
    integrationsRes,
    prospectsRes,
    carouselsRes,
    landingsRes,
    snapshotsRes,
    campaignsRes,
  ] = await Promise.all([
    getUsageSummary(ctx),
    countOpenOpportunities(ctx),
    getFunnelMetrics(ctx),
    ctx.supabase
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .gte("created_at", sinceIso),
    ctx.supabase
      .from("social_posts")
      .select("status, published_at, scheduled_at, created_at")
      .eq("organization_id", ctx.organizationId)
      .limit(1000),
    ctx.supabase
      .from("integrations")
      .select("status")
      .eq("organization_id", ctx.organizationId),
    ctx.supabase
      .from("scraped_leads")
      .select("status, created_at")
      .eq("organization_id", ctx.organizationId)
      .limit(2000),
    ctx.supabase
      .from("carousels")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId),
    ctx.supabase
      .from("landing_pages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .eq("published", true),
    ctx.supabase
      .from("ad_metric_snapshots")
      .select("date_start, date_stop, spend_cents, impressions, clicks, leads, roas")
      .eq("organization_id", ctx.organizationId)
      .gte("date_stop", sinceDate)
      .order("date_start", { ascending: true })
      .limit(500),
    ctx.supabase
      .from("ad_campaigns")
      .select("metrics")
      .eq("organization_id", ctx.organizationId)
      .limit(200),
  ]);

  const aiCreditsRow = usage.find((item) => item.metric === "ai_credits") ?? { used: 0, limit: 0 };

  const metrics = buildExecutiveDashboardMetrics({
    period,
    sinceMs: since.getTime(),
    openOpportunities,
    funnel,
    newLeadsInPeriod: newLeadsRes.count ?? 0,
    posts: (postsRes.data ?? []) as PostRow[],
    integrations: (integrationsRes.data ?? []) as IntegrationRow[],
    prospects: (prospectsRes.data ?? []) as ProspectRow[],
    carouselsCount: carouselsRes.count ?? 0,
    publishedLandingsCount: landingsRes.count ?? 0,
    aiCredits: { used: aiCreditsRow.used, limit: aiCreditsRow.limit },
    snapshots: (snapshotsRes.data ?? []) as SnapshotRow[],
    fallbackCampaigns: (campaignsRes.data ?? []) as CampaignMetricRow[],
  });

  return { metrics, usage };
}
