import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard, type WizardValues } from "./wizard";

export const metadata: Metadata = { title: "Configuração inicial" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=/onboarding");

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", auth.user.id)
    .single();

  let initial: Partial<WizardValues> = {};
  if (profile?.current_organization_id) {
    const [{ data: organization }, { data: brand }] = await Promise.all([
      supabase.from("organizations").select("onboarding_completed_at").eq("id", profile.current_organization_id).single(),
      supabase.from("brand_context").select("*").eq("organization_id", profile.current_organization_id).maybeSingle(),
    ]);
    if (organization?.onboarding_completed_at) redirect("/dashboard");
    if (brand) {
      const visual = (brand.visual_identity ?? {}) as Record<string, string | null>;
      initial = {
        companyName: brand.company_name,
        niche: brand.niche,
        productsServices: brand.products_services,
        averageTicket: brand.average_ticket?.toString() ?? "",
        targetAudience: brand.target_audience,
        differentiators: brand.differentiators,
        toneOfVoice: brand.tone_of_voice,
        primaryColor: visual.primary_color ?? undefined,
        secondaryColor: visual.secondary_color ?? undefined,
        logoUrl: visual.logo_url ?? "",
        styleNotes: visual.style_notes ?? "",
      };
    }
  }

  return (
    <main className="bg-grid min-h-svh px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-semibold">Vamos conhecer a sua marca</h1>
        <p className="mt-2 text-muted-foreground">
          Estas respostas formam o Contexto Mestre da sua empresa. O Agente Hermes usa essas informações para criar
          conteúdos, prospectar clientes e montar anúncios com a cara do seu negócio. Você pode alterar tudo depois.
        </p>
        <OnboardingWizard initial={initial} />
      </div>
    </main>
  );
}
