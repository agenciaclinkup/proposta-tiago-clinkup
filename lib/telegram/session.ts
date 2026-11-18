import "server-only";
import type { PlanId } from "@/config/plans";
import type { MemberRole, ServiceContext } from "@/lib/services/context";
import { createAdminClient } from "@/lib/supabase/admin";

// Equivalente ao loadWorkspace para o Telegram (sem sessão Supabase): confere que o usuário vinculado
// ainda é membro da org e que o onboarding foi concluído. Contexto usa o cliente admin (ver ServiceContext).
export async function loadTelegramSession(link: { organizationId: string; userId: string }) {
  const admin = createAdminClient();
  const [{ data: organization }, { data: membership }, { data: profile }] = await Promise.all([
    admin.from("organizations").select("name, plan_id, onboarding_completed_at").eq("id", link.organizationId).maybeSingle(),
    admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", link.organizationId)
      .eq("user_id", link.userId)
      .maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", link.userId).maybeSingle(),
  ]);
  if (!organization?.onboarding_completed_at || !membership) return null;

  const ctx: ServiceContext = {
    supabase: admin,
    organizationId: link.organizationId,
    userId: link.userId,
    planId: organization.plan_id as PlanId,
    role: membership.role as MemberRole,
    via: "hermes",
    channel: "telegram",
  };
  return { ctx, organizationName: organization.name as string, userName: (profile?.full_name as string | null) ?? null };
}
