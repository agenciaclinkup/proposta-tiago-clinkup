import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Workspace = Awaited<ReturnType<typeof requireWorkspace>>;

// Usuário autenticado + organização ativa. Sem onboarding concluído, manda para /onboarding.
export const requireWorkspace = cache(async () => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, current_organization_id, is_super_admin")
    .eq("id", auth.user.id)
    .single();

  const organizationId = profile?.current_organization_id;
  if (!organizationId) redirect("/onboarding");

  const [{ data: organization }, { data: subscription }] = await Promise.all([
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
  ]);

  if (!organization?.onboarding_completed_at) redirect("/onboarding");

  return { supabase, user: auth.user, profile: profile!, organization, subscription };
});
