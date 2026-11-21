"use server";

import { revalidatePath } from "next/cache";
import { organizationBrandSchema } from "@/config/organization-brand";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { saveOrganizationBrand } from "@/lib/services/organization-brand";
import { isSuperAdminUser } from "@/lib/super-admin";
import { requireWorkspace } from "@/lib/workspace";

export async function saveOrganizationBrandAction(input: unknown): Promise<{ ok: true } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`org-brand:user:${workspace.user.id}`, RATE_LIMITS.onboardingUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }
  const parsed = organizationBrandSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Confira os dados da identidade da marca." };
  }
  try {
    await saveOrganizationBrand(serviceContext(workspace, "manual"), parsed.data, {
      isWhiteLabel: workspace.organization.is_white_label,
      isSuperAdmin: isSuperAdminUser(workspace.user, workspace.profile),
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Não foi possível salvar a identidade da marca." };
  }
}
