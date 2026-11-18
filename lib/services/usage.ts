import "server-only";
import { getPlan, type PlanId, type PlanLimits } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";

export type UsageMetric = "ai_credits" | "scraped_leads" | "scheduled_posts";

const METRICS: Record<UsageMetric, { limitKey: keyof PlanLimits; label: string }> = {
  ai_credits: { limitKey: "aiCreditsPerMonth", label: "créditos de IA" },
  scraped_leads: { limitKey: "scrapedLeadsPerMonth", label: "leads extraídos" },
  scheduled_posts: { limitKey: "scheduledPostsPerMonth", label: "posts agendados" },
};

export class PlanLimitError extends Error {
  constructor(
    readonly metric: UsageMetric,
    readonly used: number,
    readonly limit: number,
    planName: string,
  ) {
    super(
      `Você atingiu o limite de ${METRICS[metric].label} do plano ${planName} neste mês (${used} de ${limit}). ` +
        "Para continuar, faça o upgrade do seu plano na página Planos.",
    );
    this.name = "PlanLimitError";
  }
}

export function limitFor(planId: PlanId, metric: UsageMetric): number {
  return getPlan(planId)?.limits[METRICS[metric].limitKey] ?? 0;
}

// Mesmo período do SQL (`consume_usage`): primeiro dia do mês em America/Sao_Paulo, formato YYYY-MM-DD.
export function currentPeriodStart(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .formatToParts(now);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}-01`;
}

// Consome do limite mensal do plano ou lança PlanLimitError. Erro de banco propaga: nunca libera sem registrar.
export async function consumeUsage(
  ctx: ServiceContext,
  metric: UsageMetric,
  amount = 1,
): Promise<{ used: number; limit: number }> {
  const limit = limitFor(ctx.planId, metric);
  const { data, error } = await createAdminClient().rpc("consume_usage", {
    p_organization_id: ctx.organizationId,
    p_metric: metric,
    p_amount: amount,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  const result = data as { allowed: boolean; used: number };
  if (!result.allowed) throw new PlanLimitError(metric, result.used, limit, getPlan(ctx.planId)?.name ?? ctx.planId);
  return { used: result.used, limit };
}

export async function getUsageSummary(ctx: ServiceContext) {
  const { data } = await ctx.supabase
    .from("usage_counters")
    .select("metric, used")
    .eq("organization_id", ctx.organizationId)
    .eq("period_start", currentPeriodStart());

  return (Object.keys(METRICS) as UsageMetric[]).map((metric) => ({
    metric,
    label: METRICS[metric].label,
    used: data?.find((row) => row.metric === metric)?.used ?? 0,
    limit: limitFor(ctx.planId, metric),
  }));
}
