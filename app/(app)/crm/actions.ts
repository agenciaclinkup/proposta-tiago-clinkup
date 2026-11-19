"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext, type ServiceContext } from "@/lib/services/context";
import {
  createLead,
  createStage,
  deleteLead,
  deleteStage,
  addLeadNote,
  leadInputSchema,
  leadPatchSchema,
  moveLead,
  moveLeadSchema,
  noteSchema,
  reorderStages,
  stageInputSchema,
  stagePatchSchema,
  updateLead,
  updateStage,
} from "@/lib/services/crm";
import { ServiceError } from "@/lib/services/errors";
import { requireWorkspace } from "@/lib/workspace";

export type CrmActionState = { error?: string; success?: string } | undefined;

const INVALID = "Não consegui ler os dados enviados. Recarregue a página e tente novamente.";

// Autenticação, rate limit, erro amigável e revalidação comuns a todas as ações do CRM.
// Recebe dados já validados por Zod; as regras de papel e do plano ficam no service.
async function run(task: (ctx: ServiceContext) => Promise<unknown>, success: string): Promise<{ error?: string; success?: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`crm:user:${workspace.user.id}`, RATE_LIMITS.crmUser))) return { error: RATE_LIMIT_MESSAGE };
  try {
    await task(serviceContext(workspace, "manual"));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[crm] falha na ação", error);
    return { error: "Não consegui concluir agora. Tente novamente em alguns instantes." };
  }
  // "layout": revalida o quadro e as fichas de lead (/crm/leads/[id]) de uma vez.
  revalidatePath("/crm", "layout");
  return { success };
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? INVALID;

export async function moveLeadAction(input: { leadId: string; stageId: string; index: number }) {
  const parsed = moveLeadSchema.safeParse(input);
  if (!parsed.success) return { error: INVALID };
  return run((ctx) => moveLead(ctx, parsed.data), "Lead movido.");
}

export async function createLeadAction(_: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const parsed = leadInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return run((ctx) => createLead(ctx, parsed.data), `Lead “${parsed.data.name}” adicionado.`);
}

export async function deleteLeadAction(_: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const parsed = z.uuid().safeParse(formData.get("leadId"));
  if (!parsed.success) return { error: INVALID };
  const result = await run((ctx) => deleteLead(ctx, parsed.data), "Lead excluído.");
  // Excluído pela ficha: a página do lead deixa de existir, então volta para o quadro.
  if (result.success && formData.get("redirectTo") === "board") redirect("/crm");
  return result;
}

export async function updateLeadAction(_: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const leadId = z.uuid().safeParse(formData.get("leadId"));
  if (!leadId.success) return { error: INVALID };
  const fields = Object.fromEntries(formData);
  delete fields.leadId;
  const patch = leadPatchSchema.safeParse(fields);
  if (!patch.success) return { error: firstIssue(patch.error) };
  return run((ctx) => updateLead(ctx, leadId.data, patch.data), "Dados do lead salvos.");
}

export async function addLeadNoteAction(_: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const parsed = noteSchema.safeParse({ leadId: formData.get("leadId"), content: formData.get("content") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return run((ctx) => addLeadNote(ctx, parsed.data.leadId, parsed.data.content), "Anotação adicionada.");
}

export async function createStageAction(_: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const parsed = stageInputSchema.safeParse({ name: formData.get("name"), color: formData.get("color") || undefined });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return run((ctx) => createStage(ctx, parsed.data), `Etapa “${parsed.data.name}” criada.`);
}

export async function updateStageAction(_: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const stageId = z.uuid().safeParse(formData.get("stageId"));
  const patch = stagePatchSchema.safeParse({
    name: formData.get("name") || undefined,
    color: formData.get("color") || undefined,
  });
  if (!stageId.success) return { error: INVALID };
  if (!patch.success) return { error: firstIssue(patch.error) };
  return run((ctx) => updateStage(ctx, stageId.data, patch.data), "Etapa atualizada.");
}

export async function reorderStagesAction(orderedIds: string[]) {
  const parsed = z.array(z.uuid()).min(1).max(20).safeParse(orderedIds);
  if (!parsed.success) return { error: INVALID };
  return run((ctx) => reorderStages(ctx, parsed.data), "Ordem das etapas salva.");
}

export async function deleteStageAction(_: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const parsed = z.uuid().safeParse(formData.get("stageId"));
  if (!parsed.success) return { error: INVALID };
  return run((ctx) => deleteStage(ctx, parsed.data), "Etapa excluída.");
}
