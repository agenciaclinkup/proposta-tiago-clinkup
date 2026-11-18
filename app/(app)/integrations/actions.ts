"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { createTelegramLinkCode, disconnectIntegration } from "@/lib/services/integrations";
import { requireWorkspace } from "@/lib/workspace";

export type IntegrationActionState = { error?: string; success?: string } | undefined;

// Sem payload: o código é sempre do usuário logado na org atual.
export async function generateTelegramCodeAction(): Promise<{ code: string; expiresAt: string } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`telegram-code:user:${workspace.user.id}`, RATE_LIMITS.telegramCodeUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }
  try {
    return await createTelegramLinkCode(serviceContext(workspace, "manual"));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[integrations] falha ao gerar código do Telegram", error);
    return { error: "Não consegui gerar o código agora. Tente novamente em alguns instantes." };
  }
}

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
