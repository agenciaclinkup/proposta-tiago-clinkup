"use server";

import { revalidatePath } from "next/cache";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/services/errors";
import {
  adminAdjustCreditsSchema,
  adminAdjustTenantAiCredits,
  adminUpdateSubscriptionSchema,
  adminUpdateTenantSubscription,
} from "@/lib/services/super-admin";
import { assertSuperAdminActor } from "@/lib/super-admin";

export async function adminUpdateSubscriptionAction(input: unknown): Promise<{ ok: true } | { error: string }> {
  try {
    const actor = await assertSuperAdminActor();
    if (!(await rateLimit(`super-admin:write:${actor.id}`, RATE_LIMITS.superAdminWrite))) {
      return { error: RATE_LIMIT_MESSAGE };
    }
    const parsed = adminUpdateSubscriptionSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confira os dados informados." };
    await adminUpdateTenantSubscription(actor, parsed.data);
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Não foi possível atualizar a assinatura da organização." };
  }
}

export async function adminAdjustCreditsAction(
  input: unknown,
): Promise<{ used: number; bonus: number } | { error: string }> {
  try {
    const actor = await assertSuperAdminActor();
    if (!(await rateLimit(`super-admin:write:${actor.id}`, RATE_LIMITS.superAdminWrite))) {
      return { error: RATE_LIMIT_MESSAGE };
    }
    const parsed = adminAdjustCreditsSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confira o ajuste de créditos informado." };
    const result = await adminAdjustTenantAiCredits(actor, parsed.data);
    revalidatePath("/admin");
    return { used: result.used, bonus: result.bonus };
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Não foi possível ajustar os créditos de IA." };
  }
}
