"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { recoverProspectSearch, sendProspectToCrm } from "@/lib/services/prospecting";
import { requireWorkspace } from "@/lib/workspace";
import { b2bRequestSchema, runB2bProspecting } from "@/lib/services/b2b-prospecting";

const selection = z.strictObject({ prospectIds: z.array(z.uuid()).min(1).max(100), stageId: z.uuid() });
export async function searchB2bAction(input: unknown): Promise<{ status: string } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`prospecting:search:${workspace.user.id}`, RATE_LIMITS.prospectingSearch))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = b2bRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Confira os CNPJs, os dados e a declaração de origem e base legal." };
  try {
    const result = await runB2bProspecting(serviceContext(workspace, "manual"), parsed.data);
    revalidatePath("/leads-ads");
    return { status: (result.search as { status: string }).status };
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Não foi possível concluir a busca. Tente novamente." };
  }
}
export async function sendProspectsAction(input: unknown): Promise<{ sent: number; errors: string[] } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`prospecting:send:${workspace.user.id}`, RATE_LIMITS.crmUser))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = selection.safeParse(input);
  if (!parsed.success) return { error: "Escolha os leads e uma etapa válida do funil." };
  const ctx = serviceContext(workspace, "manual");
  let sent = 0; const errors: string[] = [];
  for (const prospectId of new Set(parsed.data.prospectIds)) {
    try { await sendProspectToCrm(ctx, { prospectId, stageId: parsed.data.stageId }); sent++; }
    catch (error) { errors.push(error instanceof ServiceError ? error.message : "Não foi possível enviar um dos leads. Tente novamente."); }
  }
  revalidatePath("/leads-ads"); revalidatePath("/crm");
  return { sent, errors };
}

export async function recoverSearchAction(input: unknown): Promise<{ status: string } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`prospecting:recover:${workspace.user.id}`, RATE_LIMITS.crmUser))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = z.uuid().safeParse(input);
  if (!parsed.success) return { error: "Selecione uma busca válida." };
  try {
    const result = await recoverProspectSearch(serviceContext(workspace, "manual"), parsed.data) as { status: string };
    revalidatePath("/leads-ads");
    return { status: result.status };
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Não foi possível verificar a busca. Tente novamente." };
  }
}
