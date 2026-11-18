import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { MemberRole } from "@/lib/services/context";
import { createClient } from "@/lib/supabase/server";

async function fetchWorkspace() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: "unauthenticated" as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, current_organization_id, is_super_admin")
    .eq("id", auth.user.id)
    .single();

  const organizationId = profile?.current_organization_id;
  if (!organizationId) return { status: "onboarding" as const };

  const [{ data: organization }, { data: subscription }, { data: membership }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, slug, niche, plan_id, is_white_label, onboarding_completed_at")
      .eq("id", organizationId)
      .single(),
    supabase
      .from("subscriptions")
      .select("plan_id, status, provider, provider_customer_id, trial_ends_at, current_period_end, cancel_at_period_end")
      .eq("organization_id", organizationId)
      .single(),
    supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
  ]);

  if (!organization?.onboarding_completed_at) return { status: "onboarding" as const };

  // Sem linha de membership, assume o menor privilégio.
  const role = (membership?.role ?? "member") as MemberRole;

  return {
    status: "ok" as const,
    workspace: { supabase, user: auth.user, profile: profile!, organization, subscription, role },
  };
}

export type Workspace = Extract<Awaited<ReturnType<typeof fetchWorkspace>>, { status: "ok" }>["workspace"];

// Para Route Handlers: o chamador decide a resposta (401/403) em vez de redirecionar.
export const loadWorkspace = cache(fetchWorkspace);

// Para páginas e Server Actions: sem sessão vai para /login; sem onboarding concluído vai para /onboarding.
export const requireWorkspace = cache(async (): Promise<Workspace> => {
  const result = await loadWorkspace();
  if (result.status === "unauthenticated") redirect("/login");
  if (result.status === "onboarding") redirect("/onboarding");
  return result.workspace;
});
