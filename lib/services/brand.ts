import { buildMasterContext, onboardingSchema, type OnboardingInput } from "@/lib/onboarding";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

type BrandRow = ReturnType<typeof brandRowFromInput>;

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

export function inputFromBrandRow(row: BrandRow): OnboardingInput {
  const visual = row.visual_identity as Record<string, string | null>;
  return {
    companyName: row.company_name,
    niche: row.niche,
    productsServices: row.products_services,
    averageTicket: row.average_ticket === null ? undefined : Number(row.average_ticket),
    targetAudience: row.target_audience,
    differentiators: row.differentiators,
    toneOfVoice: row.tone_of_voice,
    primaryColor: visual.primary_color ?? "",
    secondaryColor: visual.secondary_color ?? "",
    logoUrl: visual.logo_url ?? "",
    styleNotes: visual.style_notes ?? undefined,
  };
}

// Alteração parcial (ex.: "mude o tom de voz para descontraído"): revalida o conjunto completo.
export function mergeBrandPatch(row: BrandRow, patch: Partial<OnboardingInput>): OnboardingInput {
  const parsed = onboardingSchema.safeParse({ ...inputFromBrandRow(row), ...patch });
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0].message);
  return parsed.data;
}

export async function getBrandContext(ctx: Pick<ServiceContext, "supabase" | "organizationId">): Promise<BrandRow | null> {
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
  if (error?.code === "42501") {
    throw new ServiceError("Apenas proprietários e administradores podem alterar a memória da marca.");
  }
  if (error) throw new Error(error.message);
}
