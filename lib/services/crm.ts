import { z } from "zod";
import { funnelMetrics } from "@/lib/crm/funnel";
import { getPlan } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
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
      .select("id, name, position, color, kind, pipeline_id")
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

// Etapas do funil padrão, sem carregar leads (ficha do lead, seletores, Tools).
export async function listStages(ctx: ServiceContext) {
  const pipeline = await getDefaultPipeline(ctx);
  const { data, error } = await ctx.supabase
    .from("crm_stages")
    .select("id, name, position, color, kind, pipeline_id")
    .eq("organization_id", ctx.organizationId)
    .eq("pipeline_id", pipeline.id)
    .order("position");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function getDefaultPipeline(ctx: ServiceContext): Promise<{ id: string }> {
  const { data, error } = await ctx.supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError("O funil de vendas da empresa ainda não foi criado. Fale com o suporte.");
  return data;
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

  const pipeline = await getDefaultPipeline(ctx);

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

export async function getLead(ctx: ServiceContext, leadId: string) {
  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .select(`${LEAD_COLUMNS}, scraped_lead_id, google_event_id, created_by, crm_stages(name, kind)`)
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError(LEAD_NOT_FOUND);
  const { crm_stages: stage, ...lead } = data as typeof data & { crm_stages: { name: string; kind: string } | null };
  return { ...lead, stage };
}

// Nomes para a linha do tempo. Perfis só são legíveis pelo próprio usuário (RLS), então a leitura usa o cliente
// admin, mas limitada a ids que a consulta com o contexto (RLS/filtro de org) confirmou serem membros da empresa.
export async function memberNames(ctx: ServiceContext, userIds: string[], admin = createAdminClient()): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data: members, error } = await ctx.supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", ctx.organizationId)
    .in("user_id", unique);
  if (error) throw new Error(error.message);
  const memberIds = (members ?? []).map((member) => member.user_id as string);
  if (memberIds.length === 0) return new Map();

  const { data: profiles, error: profilesError } = await admin.from("profiles").select("id, full_name").in("id", memberIds);
  if (profilesError) throw new Error(profilesError.message);
  return new Map(
    (profiles ?? []).filter((profile) => profile.full_name).map((profile) => [profile.id as string, profile.full_name as string]),
  );
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

// ---------------------------------------------------------------------------
// Gestão do funil (só owner/admin). Checagem explícita além do RLS: canais sem sessão usam cliente admin.
// ---------------------------------------------------------------------------

const ADMIN_ONLY = "Apenas proprietários e administradores podem alterar as etapas do funil ou excluir leads.";

function assertAdmin(ctx: ServiceContext) {
  if (ctx.role === "member") throw new ServiceError(ADMIN_ONLY);
}

export const stageInputSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a etapa.").max(60, "Use no máximo 60 caracteres."),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Escolha uma cor válida.").optional(),
  kind: z.enum(["open", "won", "lost"]).optional(),
});
export const stagePatchSchema = stageInputSchema.partial().refine((patch) => Object.values(patch).some((v) => v !== undefined), {
  message: "Informe o que deseja alterar na etapa.",
});

export async function createStage(ctx: ServiceContext, input: z.infer<typeof stageInputSchema>) {
  assertAdmin(ctx);
  const pipeline = await getDefaultPipeline(ctx);
  const { data: stages, error } = await ctx.supabase
    .from("crm_stages")
    .select("id, position")
    .eq("organization_id", ctx.organizationId)
    .eq("pipeline_id", pipeline.id)
    .order("position");
  if (error) throw new Error(error.message);
  if ((stages ?? []).length >= 20) throw new ServiceError("O funil pode ter no máximo 20 etapas.");

  const { data, error: insertError } = await ctx.supabase
    .from("crm_stages")
    .insert({
      organization_id: ctx.organizationId,
      pipeline_id: pipeline.id,
      name: input.name,
      color: input.color ?? "#00D4FF",
      kind: input.kind ?? "open",
      position: (stages ?? []).length,
    })
    .select("id, name, position, color, kind, pipeline_id")
    .single();
  if (insertError) throw new Error(insertError.message);
  return data;
}

export async function updateStage(ctx: ServiceContext, stageId: string, patch: z.infer<typeof stagePatchSchema>) {
  assertAdmin(ctx);
  const { data, error } = await ctx.supabase
    .from("crm_stages")
    .update(patch)
    .eq("id", stageId)
    .eq("organization_id", ctx.organizationId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError(STAGE_NOT_FOUND);
}

// Recebe a nova ordem completa; recusa listas que não sejam exatamente as etapas do funil da empresa.
export async function reorderStages(ctx: ServiceContext, orderedIds: string[]) {
  assertAdmin(ctx);
  const pipeline = await getDefaultPipeline(ctx);
  const { data: stages, error } = await ctx.supabase
    .from("crm_stages")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("pipeline_id", pipeline.id);
  if (error) throw new Error(error.message);
  const current = new Set((stages ?? []).map((stage) => stage.id as string));
  const sameSet = orderedIds.length === current.size && new Set(orderedIds).size === current.size && orderedIds.every((id) => current.has(id));
  if (!sameSet) throw new ServiceError("A ordem das etapas mudou enquanto você editava. Recarregue a página e tente de novo.");

  for (const [position, id] of orderedIds.entries()) {
    const { error: updateError } = await ctx.supabase
      .from("crm_stages")
      .update({ position })
      .eq("id", id)
      .eq("organization_id", ctx.organizationId);
    if (updateError) throw new Error(updateError.message);
  }
}

// Só etapa vazia, e nunca a última do funil (o banco também impede apagar etapa com leads, pela FK).
export async function deleteStage(ctx: ServiceContext, stageId: string) {
  assertAdmin(ctx);
  const stage = await findStage(ctx, stageId);
  if (!stage) throw new ServiceError(STAGE_NOT_FOUND);

  const { count, error } = await ctx.supabase
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .eq("stage_id", stageId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) {
    throw new ServiceError(
      `A etapa “${stage.name}” ainda tem ${count} leads. Mova esses leads para outra etapa antes de excluí-la.`,
    );
  }

  const { data: siblings, error: siblingsError } = await ctx.supabase
    .from("crm_stages")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("pipeline_id", stage.pipeline_id);
  if (siblingsError) throw new Error(siblingsError.message);
  if ((siblings ?? []).length <= 1) throw new ServiceError("O funil precisa ter pelo menos uma etapa.");

  const { error: deleteError } = await ctx.supabase.from("crm_stages").delete().eq("id", stageId).eq("organization_id", ctx.organizationId);
  if (deleteError) throw new Error(deleteError.message);
}

export async function deleteLead(ctx: ServiceContext, leadId: string) {
  assertAdmin(ctx);
  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .delete()
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError(LEAD_NOT_FOUND);
}

// KPI do dashboard: leads em etapas abertas (nem ganhos nem perdidos).
export async function countOpenOpportunities(ctx: ServiceContext): Promise<number> {
  const { data: stages, error } = await ctx.supabase
    .from("crm_stages")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("kind", "open");
  if (error) throw new Error(error.message);
  const ids = (stages ?? []).map((stage) => stage.id as string);
  if (ids.length === 0) return 0;

  const { count, error: countError } = await ctx.supabase
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .in("stage_id", ids);
  if (countError) throw new Error(countError.message);
  return count ?? 0;
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

// Consultas do Hermes sempre usam o mesmo contexto e filtro de organização do CRM.
export const searchLeadsSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  stageId: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

export async function searchLeads(ctx: ServiceContext, input: z.infer<typeof searchLeadsSchema>) {
  let query = ctx.supabase.from("crm_leads").select(LEAD_COLUMNS).eq("organization_id", ctx.organizationId);
  if (input.stageId) query = query.eq("stage_id", input.stageId);
  if (input.query) {
    // PostgREST usa vírgulas e parênteses como sintaxe: aspas e barras também precisam ser escapadas.
    const term = input.query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/"/g, '\\"');
    query = query.or(["name", "company", "email"].map((field) => field + '.ilike."%' + term + '%"').join(","));
  }
  const { data, error } = await query.order("name").limit(input.limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function resolveStage(ctx: ServiceContext, nameOrId: string): Promise<string> {
  const stages = await listStages(ctx);
  const normalize = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const matches = stages.filter((stage) => stage.id === nameOrId || normalize(stage.name) === normalize(nameOrId));
  if (matches.length !== 1) throw new ServiceError(`Etapa não encontrada ou ambígua. Etapas disponíveis: ${stages.map((stage) => stage.name).join(", ") || "nenhuma"}.`);
  return matches[0].id;
}

export async function getFunnelMetrics(ctx: ServiceContext) {
  const stages = await listStages(ctx);
  const entries = await Promise.all(stages.map(async (stage) => {
    const base = () => ctx.supabase.from("crm_leads").select("value").eq("organization_id", ctx.organizationId).eq("stage_id", stage.id).order("id");
    const { count, error } = await ctx.supabase.from("crm_leads").select("id", { count: "exact", head: true }).eq("organization_id", ctx.organizationId).eq("stage_id", stage.id);
    if (error) throw new Error(error.message);
    let value = 0;
    const pageSize = 500;
    for (let offset = 0; offset < (count ?? 0); offset += pageSize) {
      const page = await base().range(offset, offset + pageSize - 1);
      if (page.error) throw new Error(page.error.message);
      value += (page.data ?? []).reduce ( (sum, lead) => sum + Number(lead.value ?? 0), 0);
    }
    return { id: stage.id, name: stage.name, kind: stage.kind, count: count ?? 0, value };
  }));
  return funnelMetrics(entries);
}
