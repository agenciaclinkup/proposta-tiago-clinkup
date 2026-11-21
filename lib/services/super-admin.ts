import "server-only";
import { z } from "zod";
import { getPlan, type PlanId } from "@/config/plans";
import type { SuperAdminActor } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ServiceError } from "./errors";

export const adminUpdateSubscriptionSchema = z.strictObject({
  organizationId: z.uuid(),
  planId: z.enum(["starter", "growth", "scale"]),
  status: z.enum(["trialing", "active", "past_due", "canceled", "incomplete"]),
  isWhiteLabel: z.boolean(),
  reason: z.string().trim().min(3, "Informe o motivo da alteração (mínimo 3 caracteres).").max(500),
});

export const adminAdjustCreditsSchema = z.strictObject({
  organizationId: z.uuid(),
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0 && v >= -100_000 && v <= 100_000, "Informe um ajuste inteiro entre -100.000 e +100.000 (diferente de zero)."),
  reason: z.string().trim().min(3, "Informe o motivo do ajuste (mínimo 3 caracteres).").max(500),
});

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  niche: string | null;
  plan_id: string;
  is_white_label: boolean;
  created_at: string;
};

type SubRow = {
  organization_id: string;
  plan_id: string;
  status: string;
  provider: string;
  current_period_end: string | null;
};

type UsageRow = {
  organization_id: string;
  metric: string;
  used: number;
  bonus?: number;
};

type IntegrationRow = {
  organization_id: string;
  status: string;
};

export type AdminTenantSummary = {
  id: string;
  name: string;
  slug: string;
  niche: string | null;
  planId: string;
  planName: string;
  subscriptionStatus: string;
  provider: string;
  isWhiteLabel: boolean;
  createdAt: string;
  connectedIntegrations: number;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  aiCreditsBonus: number;
  scrapedLeadsUsed: number;
  scrapedLeadsLimit: number;
  scheduledPostsUsed: number;
  scheduledPostsLimit: number;
};

export type AdminGlobalOverview = {
  totalOrganizations: number;
  whiteLabelOrganizations: number;
  planDistribution: Record<PlanId, number>;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  canceledSubscriptions: number;
  totalAiCreditsUsedMonth: number;
  totalScrapedLeadsMonth: number;
  tenants: AdminTenantSummary[];
};

export type AdminAuditLogRow = {
  id: string;
  actor_id: string;
  actor_email: string;
  target_organization_id: string | null;
  action: string;
  reason: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  created_at: string;
};

export function currentSaoPauloMonthStart(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}-01`;
}

// Agregação pura para KPIs globais e tabela de tenants (testável sem banco).
export function buildAdminOverview(input: {
  organizations: OrgRow[];
  subscriptions: SubRow[];
  usageRows: UsageRow[];
  integrations: IntegrationRow[];
}): AdminGlobalOverview {
  const subByOrg = new Map(input.subscriptions.map((s) => [s.organization_id, s]));
  const usageByOrg = new Map<string, Map<string, { used: number; bonus: number }>>();
  for (const row of input.usageRows) {
    const map = usageByOrg.get(row.organization_id) ?? new Map();
    map.set(row.metric, { used: Number(row.used) || 0, bonus: Number(row.bonus) || 0 });
    usageByOrg.set(row.organization_id, map);
  }
  const connectedByOrg = new Map<string, number>();
  for (const int of input.integrations) {
    if (int.status === "connected") {
      connectedByOrg.set(int.organization_id, (connectedByOrg.get(int.organization_id) ?? 0) + 1);
    }
  }

  const planDistribution: Record<PlanId, number> = { starter: 0, growth: 0, scale: 0 };
  let whiteLabelOrganizations = 0;
  let activeSubscriptions = 0;
  let trialingSubscriptions = 0;
  let pastDueSubscriptions = 0;
  let canceledSubscriptions = 0;
  let totalAiCreditsUsedMonth = 0;
  let totalScrapedLeadsMonth = 0;

  const tenants: AdminTenantSummary[] = input.organizations.map((org) => {
    const sub = subByOrg.get(org.id);
    const effectivePlanId = (sub?.plan_id ?? org.plan_id) as PlanId;
    const plan = getPlan(effectivePlanId);
    if (effectivePlanId in planDistribution) planDistribution[effectivePlanId]++;
    if (org.is_white_label) whiteLabelOrganizations++;

    const status = sub?.status ?? "trialing";
    if (status === "active") activeSubscriptions++;
    else if (status === "trialing") trialingSubscriptions++;
    else if (status === "past_due") pastDueSubscriptions++;
    else if (status === "canceled") canceledSubscriptions++;

    const orgUsage = usageByOrg.get(org.id);
    const ai = orgUsage?.get("ai_credits") ?? { used: 0, bonus: 0 };
    const leads = orgUsage?.get("scraped_leads") ?? { used: 0, bonus: 0 };
    const posts = orgUsage?.get("scheduled_posts") ?? { used: 0, bonus: 0 };

    totalAiCreditsUsedMonth += ai.used;
    totalScrapedLeadsMonth += leads.used;

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      niche: org.niche,
      planId: effectivePlanId,
      planName: plan?.name ?? effectivePlanId,
      subscriptionStatus: status,
      provider: sub?.provider ?? "manual",
      isWhiteLabel: org.is_white_label,
      createdAt: org.created_at,
      connectedIntegrations: connectedByOrg.get(org.id) ?? 0,
      aiCreditsUsed: ai.used,
      aiCreditsLimit: (plan?.limits.aiCreditsPerMonth ?? 0) + ai.bonus,
      aiCreditsBonus: ai.bonus,
      scrapedLeadsUsed: leads.used,
      scrapedLeadsLimit: (plan?.limits.scrapedLeadsPerMonth ?? 0) + leads.bonus,
      scheduledPostsUsed: posts.used,
      scheduledPostsLimit: (plan?.limits.scheduledPostsPerMonth ?? 0) + posts.bonus,
    };
  });

  return {
    totalOrganizations: input.organizations.length,
    whiteLabelOrganizations,
    planDistribution,
    activeSubscriptions,
    trialingSubscriptions,
    pastDueSubscriptions,
    canceledSubscriptions,
    totalAiCreditsUsedMonth,
    totalScrapedLeadsMonth,
    tenants,
  };
}

export async function getAdminOverview(actor: SuperAdminActor): Promise<{
  overview: AdminGlobalOverview;
  auditLogs: AdminAuditLogRow[];
}> {
  if (!actor.id) throw new ServiceError("Acesso restrito à equipe Super-Admin da plataforma.");
  const admin = createAdminClient();
  const periodStart = currentSaoPauloMonthStart();

  const [orgsRes, subsRes, usageRes, intsRes, logsRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, slug, niche, plan_id, is_white_label, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("subscriptions").select("organization_id, plan_id, status, provider, current_period_end").limit(500),
    admin
      .from("usage_counters")
      .select("organization_id, metric, used, bonus")
      .eq("period_start", periodStart)
      .limit(2000),
    admin.from("integrations").select("organization_id, status").limit(2000),
    admin.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(50),
  ]);

  if (orgsRes.error) throw new Error(orgsRes.error.message);
  if (subsRes.error) throw new Error(subsRes.error.message);
  if (usageRes.error) throw new Error(usageRes.error.message);
  if (intsRes.error) throw new Error(intsRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);

  return {
    overview: buildAdminOverview({
      organizations: (orgsRes.data ?? []) as OrgRow[],
      subscriptions: (subsRes.data ?? []) as SubRow[],
      usageRows: (usageRes.data ?? []) as UsageRow[],
      integrations: (intsRes.data ?? []) as IntegrationRow[],
    }),
    auditLogs: (logsRes.data ?? []) as AdminAuditLogRow[],
  };
}

export async function adminUpdateTenantSubscription(
  actor: SuperAdminActor,
  input: z.input<typeof adminUpdateSubscriptionSchema>,
) {
  const parsed = adminUpdateSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira os dados da assinatura.");
  }
  const { organizationId, planId, status, isWhiteLabel, reason } = parsed.data;
  const admin = createAdminClient();

  const [{ data: org, error: orgError }, { data: sub, error: subError }] = await Promise.all([
    admin.from("organizations").select("id, name, plan_id, is_white_label").eq("id", organizationId).maybeSingle(),
    admin.from("subscriptions").select("plan_id, status, provider").eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (orgError) throw new Error(orgError.message);
  if (subError) throw new Error(subError.message);
  if (!org) throw new ServiceError("Organização não encontrada.");

  const beforeState = {
    planId: sub?.plan_id ?? org.plan_id,
    status: sub?.status ?? "trialing",
    isWhiteLabel: org.is_white_label,
  };

  const { error: updOrgError } = await admin
    .from("organizations")
    .update({ plan_id: planId, is_white_label: isWhiteLabel })
    .eq("id", organizationId);
  if (updOrgError) throw new Error(updOrgError.message);

  const { error: updSubError } = await admin
    .from("subscriptions")
    .upsert(
      {
        organization_id: organizationId,
        plan_id: planId,
        status,
        provider: sub?.provider ?? "manual",
      },
      { onConflict: "organization_id" },
    );
  if (updSubError) throw new Error(updSubError.message);

  const afterState = { planId, status, isWhiteLabel };
  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    actor_id: actor.id,
    actor_email: actor.email,
    target_organization_id: organizationId,
    action: "update_subscription",
    reason,
    before_state: beforeState,
    after_state: afterState,
  });
  if (auditError) throw new Error(auditError.message);

  return { organizationId, organizationName: org.name, ...afterState };
}

export async function adminAdjustTenantAiCredits(
  actor: SuperAdminActor,
  input: z.input<typeof adminAdjustCreditsSchema>,
) {
  const parsed = adminAdjustCreditsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira o valor do ajuste de créditos.");
  }
  const { organizationId, delta, reason } = parsed.data;
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .maybeSingle();
  if (orgError) throw new Error(orgError.message);
  if (!org) throw new ServiceError("Organização não encontrada.");

  const { data: result, error: rpcError } = await admin.rpc("grant_usage_bonus", {
    p_organization_id: organizationId,
    p_metric: "ai_credits",
    p_delta: delta,
  });
  if (rpcError) throw new Error(rpcError.message);

  const after = result as { used: number; bonus: number };
  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    actor_id: actor.id,
    actor_email: actor.email,
    target_organization_id: organizationId,
    action: "adjust_ai_credits",
    reason,
    before_state: { delta },
    after_state: after,
  });
  if (auditError) throw new Error(auditError.message);

  return { organizationId, organizationName: org.name, ...after };
}
