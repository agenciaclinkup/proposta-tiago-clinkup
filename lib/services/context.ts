import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanId } from "@/config/plans";
import type { Workspace } from "@/lib/workspace";

export type HermesChannel = "web" | "telegram" | "webhook" | "system";

// Dual-control: a mesma função de service atende a UI (via "manual") e as Tools do Hermes (via "hermes").
// `supabase` é o cliente do usuário (RLS aplicado); escritas privilegiadas usam o cliente admin dentro do service.
export type ServiceContext = {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string | null;
  planId: PlanId;
  via: "manual" | "hermes";
  channel: HermesChannel;
};

export function serviceContext(
  workspace: Workspace,
  via: ServiceContext["via"],
  channel: HermesChannel = "web",
): ServiceContext {
  return {
    supabase: workspace.supabase,
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    planId: workspace.organization.plan_id as PlanId,
    via,
    channel,
  };
}
