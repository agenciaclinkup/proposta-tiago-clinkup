"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { disconnectIntegration } from "@/lib/services/integrations";
import { requireWorkspace } from "@/lib/workspace";

export type IntegrationActionState = { error?: string; success?: string } | undefined;

export async function disconnectIntegrationAction(_: IntegrationActionState, formData: FormData): Promise<IntegrationActionState> {
  const parsed = z.uuid().safeParse(formData.get("integrationId"));
  if (!parsed.success) return { error: "Não consegui identificar a integração. Recarregue a página e tente novamente." };

  const workspace = await requireWorkspace();
  if (!(await rateLimit(`integrations:user:${workspace.user.id}`, RATE_LIMITS.integrationsUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  try {
    await disconnectIntegration(serviceContext(workspace, "manual"), parsed.data);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[integrations] falha ao desconectar", error);
    return { error: "Não consegui desconectar agora. Tente novamente em alguns instantes." };
  }

  revalidatePath("/integrations");
  return { success: "Integração desconectada. Você pode conectá-la de novo quando quiser." };
}
