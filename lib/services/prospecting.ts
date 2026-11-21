import "server-only";
import { z } from "zod";
import { getPlan } from "@/config/plans";
import { prospectSchema, type ProspectProvider } from "@/lib/prospecting/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { limitFor, PlanLimitError } from "./usage";

export const prospectSearchSchema = z.strictObject({ requestId: z.uuid(), niche: z.string().trim().min(1).max(200), location: z.string().trim().min(1).max(200), radiusKm: z.number().int().min(1).max(50), maxResults: z.number().int().min(1).max(100) });
export const sendProspectSchema = z.strictObject({ prospectId: z.uuid(), stageId: z.uuid().optional() });
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ServiceError("Confira os dados da prospecção e tente novamente.");
  return result.data;
}
function userId(ctx: ServiceContext) {
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para usar a prospecção.");
  return ctx.userId;
}
function fail(error: { message: string }, ctx: ServiceContext): never {
  if (error.message.includes("prospect_limit_reached:")) throw new PlanLimitError("scraped_leads", Number(error.message.match(/prospect_limit_reached:(\d+)/)?.[1] ?? 0), limitFor(ctx.planId, "scraped_leads"), getPlan(ctx.planId)?.name ?? ctx.planId);
  if (error.message.includes("prospect_crm_limit")) throw new ServiceError("Sua empresa atingiu o limite de leads no CRM. Consulte a página Planos.");
  if (error.message.includes("prospect_forbidden")) throw new ServiceError("Você não tem acesso a esta empresa.");
  if (error.message.includes("prospect_not_found")) throw new ServiceError("Não encontramos esta prospecção na sua empresa.");
  if (error.message.includes("prospect_request_conflict")) throw new ServiceError("Esta solicitação já foi usada com outros dados.");
  if (error.message.includes("prospect_stage_invalid")) throw new ServiceError("Confira a etapa do funil da sua empresa.");
  if (error.message.includes("prospect_state_invalid")) throw new ServiceError("Este resultado não pode ser enviado ao CRM no estado atual.");
  throw new Error(error.message);
}
export async function searchProspects(ctx: ServiceContext, input: z.input<typeof prospectSearchSchema>, provider?: ProspectProvider) {
  const parsed = parse(prospectSearchSchema, input); const user = userId(ctx);
  if (!provider) throw new ServiceError("A busca de empresas ainda está indisponível. Configure o provedor quando a integração estiver disponível.");
  const admin = createAdminClient();
  const started = await admin.rpc("begin_lead_search", { p_org: ctx.organizationId, p_user: user, p_id: parsed.requestId, p_niche: parsed.niche, p_location: parsed.location, p_radius: parsed.radiusKm, p_count: parsed.maxResults, p_via: ctx.via, p_limit: limitFor(ctx.planId, "scraped_leads") });
  if (started.error) fail(started.error, ctx);
  const data = started.data as { created: boolean; search: unknown };
  if (!data.created) return data;
  let results: z.output<typeof prospectSchema>[];
  const abort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { abort.abort(); reject(new Error("provider timeout")); }, 60_000); });
    const response = await Promise.race([provider.search({ niche: parsed.niche, location: parsed.location, radiusKm: parsed.radiusKm, maxResults: parsed.maxResults }, { signal: abort.signal }), deadline]);
    results = z.array(prospectSchema).max(parsed.maxResults).parse(response);
  } catch {
    const failed = await admin.rpc("finish_lead_search", { p_org: ctx.organizationId, p_user: user, p_id: parsed.requestId, p_status: "failed", p_results: [] });
    if (failed.error) throw new Error("Não foi possível registrar a falha da busca. Consulte o suporte antes de tentar novamente.");
    throw new ServiceError("Não foi possível concluir a busca. Tente novamente em alguns instantes.");
  } finally { if (timeout) clearTimeout(timeout); }
  const finished = await admin.rpc("finish_lead_search", { p_org: ctx.organizationId, p_user: user, p_id: parsed.requestId, p_status: "succeeded", p_results: results });
  if (finished.error) fail(finished.error, ctx);
  return { created: true, search: finished.data };
}
export async function sendProspectToCrm(ctx: ServiceContext, input: z.input<typeof sendProspectSchema>) {
  const parsed = parse(sendProspectSchema, input); const user = userId(ctx);
  const result = await createAdminClient().rpc("send_scraped_lead_to_crm", { p_org: ctx.organizationId, p_user: user, p_prospect: parsed.prospectId, p_stage: parsed.stageId ?? null, p_via: ctx.via, p_limit: getPlan(ctx.planId)?.limits.crmLeads ?? 0 });
  if (result.error) fail(result.error, ctx);
  return result.data;
}
export async function recoverProspectSearch(ctx: ServiceContext, requestId: string) {
  const id = parse(z.uuid(), requestId); const user = userId(ctx);
  const result = await createAdminClient().rpc("recover_lead_search", { p_org: ctx.organizationId, p_user: user, p_id: id });
  if (result.error) fail(result.error, ctx);
  return result.data;
}
async function requireMember(ctx: ServiceContext) {
  const result = await createAdminClient().from("organization_members").select("user_id").eq("organization_id", ctx.organizationId).eq("user_id", userId(ctx)).maybeSingle();
  if (result.error || !result.data) throw new ServiceError("Você não tem acesso a esta empresa.");
}
export async function listProspectSearches(ctx: ServiceContext) {
  await requireMember(ctx);
  const result = await ctx.supabase.from("lead_searches").select("*").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(100);
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}
export async function listProspects(ctx: ServiceContext, searchId?: string) {
  const id = searchId === undefined ? undefined : parse(z.uuid(), searchId);
  await requireMember(ctx);
  if (id) {
    const matches = await ctx.supabase.from("lead_search_results").select("scraped_leads(*)").eq("organization_id", ctx.organizationId).eq("search_id", id).limit(100);
    if (matches.error) throw new Error(matches.error.message);
    return (matches.data ?? []).map((row) => row.scraped_leads).filter(Boolean);
  }
  const result = await ctx.supabase.from("scraped_leads").select("*").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(100);
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}
