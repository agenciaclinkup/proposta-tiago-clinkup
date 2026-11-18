import "server-only";
import { getPlan } from "@/config/plans";
import type { ServiceContext } from "./context";
import { getUsageSummary } from "./usage";

export async function getPlanAndUsage(ctx: ServiceContext) {
  const [{ data: subscription, error }, usage] = await Promise.all([
    ctx.supabase
      .from("subscriptions")
      .select("plan_id, status, trial_ends_at, current_period_end, cancel_at_period_end")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle(),
    getUsageSummary(ctx),
  ]);
  if (error) throw new Error(error.message);

  return {
    plan: getPlan(subscription?.plan_id ?? ctx.planId)?.name ?? ctx.planId,
    status: subscription?.status ?? null,
    trialEndsAt: subscription?.trial_ends_at ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    usage,
  };
}
