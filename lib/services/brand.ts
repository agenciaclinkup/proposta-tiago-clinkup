import { buildMasterContext, type OnboardingInput } from "@/lib/onboarding";
import type { ServiceContext } from "./context";

export function brandRowFromInput(organizationId: string, input: OnboardingInput) {
  return {
    organization_id: organizationId,
    company_name: input.companyName,
    niche: input.niche,
    products_services: input.productsServices,
    average_ticket: input.averageTicket ?? null,
    target_audience: input.targetAudience,
    differentiators: input.differentiators,
    tone_of_voice: input.toneOfVoice,
    visual_identity: {
      primary_color: input.primaryColor,
      secondary_color: input.secondaryColor,
      logo_url: input.logoUrl || null,
      style_notes: input.styleNotes || null,
    },
    master_context: buildMasterContext(input),
  };
}

export async function getBrandContext(ctx: Pick<ServiceContext, "supabase" | "organizationId">) {
  const { data, error } = await ctx.supabase
    .from("brand_context")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Input já validado por onboardingSchema (Server Action ou Tool do Hermes). RLS exige owner/admin.
export async function saveBrandContext(ctx: Pick<ServiceContext, "supabase" | "organizationId">, input: OnboardingInput) {
  const { error } = await ctx.supabase.from("brand_context").upsert(brandRowFromInput(ctx.organizationId, input));
  if (error) throw new Error(error.message);
}
