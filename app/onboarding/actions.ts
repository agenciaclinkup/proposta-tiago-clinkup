"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { onboardingSchema, slugify } from "@/lib/onboarding";
import { saveBrandContext } from "@/lib/services/brand";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

export async function completeOnboarding(_: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { error: "Revise os campos destacados.", fieldErrors };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  if (!(await rateLimit(`onboarding:user:${auth.user.id}`, RATE_LIMITS.onboardingUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", auth.user.id)
    .single();

  let organizationId = profile?.current_organization_id;

  if (!organizationId) {
    // Id gerado aqui: o insert não precisa de RETURNING (a policy de leitura depende da membership criada pelo trigger).
    const id = randomUUID();
    const { error: orgError } = await supabase
      .from("organizations")
      .insert({ id, name: input.companyName, slug: slugify(input.companyName, id.slice(0, 6)), niche: input.niche });
    if (orgError) return { error: "Não foi possível criar sua empresa. Tente novamente em instantes." };

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ current_organization_id: id })
      .eq("id", auth.user.id);
    if (profileError) return { error: "Não foi possível vincular sua empresa ao seu perfil. Tente novamente." };

    organizationId = id;
  }

  try {
    await saveBrandContext({ supabase, organizationId }, input);
  } catch {
    return { error: "Não foi possível salvar a memória da marca. Tente novamente." };
  }

  const { error: completeError } = await supabase
    .from("organizations")
    .update({ name: input.companyName, niche: input.niche, onboarding_completed_at: new Date().toISOString() })
    .eq("id", organizationId);
  if (completeError) return { error: "Não foi possível concluir o onboarding. Tente novamente." };

  redirect("/dashboard");
}
