"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { deleteConversation } from "@/lib/services/conversations";
import { ServiceError } from "@/lib/services/errors";
import { requireWorkspace } from "@/lib/workspace";

export type DeleteConversationState = { error?: string } | undefined;

export async function deleteConversationAction(_: DeleteConversationState, formData: FormData): Promise<DeleteConversationState> {
  const parsed = z.uuid().safeParse(formData.get("conversationId"));
  if (!parsed.success) return { error: "Não consegui identificar a conversa. Recarregue a página e tente novamente." };

  const workspace = await requireWorkspace();
  if (!(await rateLimit(`hermes-delete:user:${workspace.user.id}`, RATE_LIMITS.hermesDeleteUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  try {
    await deleteConversation(serviceContext(workspace, "manual"), parsed.data);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[hermes] falha ao excluir conversa", error);
    return { error: "Não consegui excluir a conversa agora. Tente novamente em alguns instantes." };
  }

  redirect("/hermes");
}
