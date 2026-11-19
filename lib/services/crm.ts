import { z } from "zod";
import { getPlan } from "@/config/plans";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

// CRM compartilhado entre a interface e as Tools do Hermes. Toda consulta filtra por organization_id
// (no Telegram o contexto usa cliente admin, sem RLS); o banco ainda garante etapa↔empresa por FK composta.

export const POSITION_STEP = 1024;

const blank = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const text = (max: number) => blank(z.string().trim().max(max, `Use no máximo ${max} caracteres.`));

export const leadInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do lead.").max(200, "Use no máximo 200 caracteres."),
  company: text(200),
  email: blank(z.email("Informe um e-mail válido.").max(320)),
  phone: text(40),
  whatsapp: text(40),
  instagram: text(100),
  website: blank(z.url("Informe um link válido, começando com https://").max(500)),
  value: blank(z.coerce.number().min(0, "O valor não pode ser negativo.").max(1_000_000_000_000)),
  notes: text(5000),
  stageId: blank(z.uuid()),
});
export type LeadInput = z.infer<typeof leadInputSchema>;

export const leadPatchSchema = leadInputSchema
  .omit({ stageId: true })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), { message: "Informe ao menos um campo para alterar." });
export type LeadPatch = z.infer<typeof leadPatchSchema>;

const LEAD_NOT_FOUND = "Não encontramos este lead. Ele pode ter sido excluído.";
const STAGE_NOT_FOUND = "Não encontramos essa etapa no funil da empresa.";

// Posição para inserir no índice `index` de uma coluna (posições ordenadas, sem o card movido).
// Sem espaço numérico entre vizinhos, devolve a renumeração da coluna inteira.
export function computePosition(positions: number[], index: number): { position: number; renumber: number[] | null } {
  const at = Math.max(0, Math.min(index, positions.length));
  if (positions.length === 0) return { position: POSITION_STEP, renumber: null };
  if (at === 0) return { position: positions[0] - POSITION_STEP, renumber: null };
  if (at === positions.length) return { position: positions[at - 1] + POSITION_STEP, renumber: null };

  const before = positions[at - 1];
  const after = positions[at];
  const middle = (before + after) / 2;
  if (middle > before && middle < after) return { position: middle, renumber: null };
  return {
    position: POSITION_STEP * (at + 1),
    renumber: positions.map((_, i) => POSITION_STEP * (i < at ? i + 1 : i + 2)),
  };
}

const LEAD_COLUMNS =
  "id, stage_id, pipeline_id, position, name, company, email, phone, whatsapp, instagram, website, source, value, ai_score, owner_id, next_meeting_at, notes, created_at, updated_at";

export async function getDefaultBoard(ctx: ServiceContext) {
  const { data: pipeline, error } = await ctx.supabase
    .from("crm_pipelines")
    .select("id, name")
    .eq("organization_id", ctx.organizationId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pipeline) throw new ServiceError("O funil de vendas da empresa ainda não foi criado. Fale com o suporte.");

  const [stages, leads] = await Promise.all([
    ctx.supabase
      .from("crm_stages")
      .select("id, name, position, color, kind")
      .eq("organization_id", ctx.organizationId)
      .eq("pipeline_id", pipeline.id)
      .order("position"),
    ctx.supabase
      .from("crm_leads")
      .select(LEAD_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .eq("pipeline_id", pipeline.id)
      .order("position"),
  ]);
  if (stages.error) throw new Error(stages.error.message);
  if (leads.error) throw new Error(leads.error.message);

  return {
    pipeline,
    stages: (stages.data ?? []).map((stage) => ({
      ...stage,
      leads: (leads.data ?? []).filter((lead) => lead.stage_id === stage.id),
    })),
  };
}

async function findStage(ctx: ServiceContext, stageId: string, pipelineId?: string) {
  let query = ctx.supabase
    .from("crm_stages")
    .select("id, name, pipeline_id")
    .eq("id", stageId)
    .eq("organization_id", ctx.organizationId);
  if (pipelineId) query = query.eq("pipeline_id", pipelineId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; name: string; pipeline_id: string } | null;
}

export async function createLead(ctx: ServiceContext, input: LeadInput, source: "manual" | "landing_page" | "webhook" | "scraping" = "manual") {
  // Limite total de leads no CRM do plano. shortcut: contagem + insert sem trava; concorrência pode passar 1-2 do limite.
  const plan = getPlan(ctx.planId);
  const limit = plan?.limits.crmLeads ?? 0;
  const { count, error: countError } = await ctx.supabase
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= limit) {
    throw new ServiceError(
      `Sua empresa atingiu o limite de ${limit.toLocaleString("pt-BR")} leads no CRM do plano ${plan?.name ?? ctx.planId}. ` +
        "Para cadastrar novos leads, faça o upgrade na página Planos.",
    );
  }

  const { data: pipeline, error: pipelineError } = await ctx.supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("is_default", true)
    .maybeSingle();
  if (pipelineError) throw new Error(pipelineError.message);
  if (!pipeline) throw new ServiceError("O funil de vendas da empresa ainda não foi criado. Fale com o suporte.");

  const { stageId, ...fields } = input;
  let stage: { id: string } | null;
  if (stageId) {
    stage = await findStage(ctx, stageId, pipeline.id);
    if (!stage) throw new ServiceError(STAGE_NOT_FOUND);
  } else {
    const { data, error } = await ctx.supabase
      .from("crm_stages")
      .select("id, pipeline_id")
      .eq("organization_id", ctx.organizationId)
      .eq("pipeline_id", pipeline.id)
      .order("position")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    stage = data;
    if (!stage) throw new ServiceError("O funil de vendas não tem etapas. Peça a um administrador para criar uma.");
  }

  const { data: last, error: lastError } = await ctx.supabase
    .from("crm_leads")
    .select("position")
    .eq("organization_id", ctx.organizationId)
    .eq("stage_id", stage.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(lastError.message);

  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .insert({
      ...fields,
      organization_id: ctx.organizationId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      position: ((last as { position: number } | null)?.position ?? 0) + POSITION_STEP,
      source: ctx.via === "hermes" ? "hermes" : source,
      owner_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select(LEAD_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateLead(ctx: ServiceContext, leadId: string, patch: LeadPatch) {
  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .update(patch)
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId)
    .select(LEAD_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError(LEAD_NOT_FOUND);
  return data;
}

export const moveLeadSchema = z.object({
  leadId: z.uuid(),
  stageId: z.uuid(),
  index: z.number().int().min(0).max(100_000),
});

// Move (ou reordena) o card. Mudança de etapa entra no histórico com a origem (manual ou Hermes).
export async function moveLead(ctx: ServiceContext, input: { leadId: string; stageId: string; index: number }) {
  const { data: lead, error } = await ctx.supabase
    .from("crm_leads")
    .select("id, stage_id, pipeline_id")
    .eq("id", input.leadId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead) throw new ServiceError(LEAD_NOT_FOUND);

  const target = await findStage(ctx, input.stageId, lead.pipeline_id);
  if (!target) throw new ServiceError(STAGE_NOT_FOUND);

  const { data: neighbors, error: neighborsError } = await ctx.supabase
    .from("crm_leads")
    .select("id, position")
    .eq("organization_id", ctx.organizationId)
    .eq("stage_id", target.id)
    .neq("id", lead.id)
    .order("position");
  if (neighborsError) throw new Error(neighborsError.message);
  const column = (neighbors ?? []) as { id: string; position: number }[];

  const { position, renumber } = computePosition(column.map((item) => item.position), input.index);
  if (renumber) {
    for (const [i, item] of column.entries()) {
      const { error: renumberError } = await ctx.supabase
        .from("crm_leads")
        .update({ position: renumber[i] })
        .eq("id", item.id)
        .eq("organization_id", ctx.organizationId);
      if (renumberError) throw new Error(renumberError.message);
    }
  }

  const { error: moveError } = await ctx.supabase
    .from("crm_leads")
    .update({ stage_id: target.id, position })
    .eq("id", lead.id)
    .eq("organization_id", ctx.organizationId);
  if (moveError) throw new Error(moveError.message);

  if (lead.stage_id !== target.id) {
    const from = await findStage(ctx, lead.stage_id);
    await insertActivity(ctx, lead.id, "stage_change", `Movido de “${from?.name ?? "etapa anterior"}” para “${target.name}”`, {
      from_stage_id: lead.stage_id,
      to_stage_id: target.id,
    });
  }
  return { stageId: target.id, position };
}

export const noteSchema = z.object({ leadId: z.uuid(), content: z.string().trim().min(1, "Escreva a anotação.").max(5000) });

export async function addLeadNote(ctx: ServiceContext, leadId: string, content: string) {
  const { data: lead, error } = await ctx.supabase
    .from("crm_leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead) throw new ServiceError(LEAD_NOT_FOUND);
  await insertActivity(ctx, leadId, "note", content);
}

export async function listLeadActivities(ctx: ServiceContext, leadId: string, limit = 50) {
  const { data, error } = await ctx.supabase
    .from("crm_activities")
    .select("id, type, content, metadata, created_by, created_via, created_at")
    .eq("organization_id", ctx.organizationId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

async function insertActivity(
  ctx: ServiceContext,
  leadId: string,
  type: "note" | "stage_change" | "meeting" | "message" | "ai_action",
  content: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await ctx.supabase.from("crm_activities").insert({
    organization_id: ctx.organizationId,
    lead_id: leadId,
    type,
    content,
    metadata,
    created_by: ctx.userId,
    created_via: ctx.via,
  });
  if (error) throw new Error(error.message);
}
