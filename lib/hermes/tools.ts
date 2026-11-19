import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getIntegrationGuide, INTEGRATION_PROVIDERS } from "@/lib/integrations/catalog";
import { onboardingSchema } from "@/lib/onboarding";
import { getPlanAndUsage } from "@/lib/services/account";
import { listRecentActivity } from "@/lib/services/activity";
import { getBrandContext, mergeBrandPatch, saveBrandContext } from "@/lib/services/brand";
import { searchLeads, searchLeadsSchema, resolveStage, createLead, leadInputSchema, updateLead, leadPatchSchema, moveLead, moveLeadSchema, addLeadNote, noteSchema, getFunnelMetrics } from "@/lib/services/crm";
import type { ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { listIntegrations, summarizeIntegrations } from "@/lib/services/integrations";
import { meetingSchema, scheduleLeadMeeting } from "@/lib/services/meetings";
import { defineTool, runTool, type HermesTool } from "./run-tool";

const ONBOARDING_REQUIRED = "A memória da marca ainda não foi criada. Conclua o onboarding no painel para que eu possa usá-la.";

const getBrandContextTool = defineTool({
  name: "get_brand_context",
  description:
    "Lê a memória da marca (Contexto Mestre): empresa, nicho, produtos e serviços, ticket médio, público-alvo, diferenciais, tom de voz e identidade visual.",
  input: z.object({}),
  execute: async (ctx) => {
    const brand = await getBrandContext(ctx);
    if (!brand) throw new ServiceError(ONBOARDING_REQUIRED);
    return brand;
  },
});

const updateBrandContextTool = defineTool({
  name: "update_brand_context",
  description:
    "Atualiza um ou mais campos da memória da marca (ex.: tom de voz, público-alvo, cores). Envie somente os campos que mudaram; o Contexto Mestre é regenerado automaticamente.",
  input: onboardingSchema
    .partial()
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: "Informe ao menos um campo da marca para alterar.",
    }),
  execute: async (ctx, patch) => {
    const current = await getBrandContext(ctx);
    if (!current) throw new ServiceError(ONBOARDING_REQUIRED);
    const next = mergeBrandPatch(current, patch);
    await saveBrandContext(ctx, next);
    return { updated: Object.keys(patch) };
  },
});

const getPlanAndUsageTool = defineTool({
  name: "get_plan_and_usage",
  description:
    "Mostra o plano atual, o status da assinatura (teste, ativa, pendente) e o consumo do mês: créditos de IA, leads extraídos e posts agendados em relação aos limites.",
  input: z.object({}),
  execute: (ctx) => getPlanAndUsage(ctx),
});

const listRecentActivityTool = defineTool({
  name: "list_recent_activity",
  description: "Lista as ações mais recentes executadas na conta pelo Hermes ou manualmente, com canal, status e horário.",
  input: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
  execute: (ctx, { limit }) => listRecentActivity(ctx, limit),
});

const listIntegrationsTool = defineTool({
  name: "list_integrations",
  description:
    "Mostra todas as integrações disponíveis (Instagram, Página do Facebook, Meta Ads, Google Meu Negócio, Google Calendar e Telegram) e quais estão conectadas, com atenção necessária ou ainda não conectadas.",
  input: z.object({}),
  execute: async (ctx) => summarizeIntegrations(await listIntegrations(ctx)),
});

const getIntegrationSetupGuideTool = defineTool({
  name: "get_integration_setup_guide",
  description:
    "Devolve o passo a passo para iniciantes conectar uma integração (requisitos, onde clicar em cada plataforma e dicas). Use quando o usuário perguntar como conectar algo ou quando faltar uma conexão para executar um pedido.",
  input: z.object({ provider: z.enum(INTEGRATION_PROVIDERS) }),
  execute: async (_ctx, { provider }) => getIntegrationGuide(provider)!,
});


const listLeadsTool = defineTool({
  name: "list_leads", description: "Busca leads por nome, empresa ou e-mail; use antes de alterar um lead e peça ao usuário identificar o correto se houver mais de um resultado.",
  input: searchLeadsSchema, execute: async (ctx, input) => {
    const leads = await searchLeads(ctx, input);
    return { leads, requiresSelection: Boolean(input.query && leads.length > 1) };
  },
});
const createLeadTool = defineTool({
  name: "create_lead", description: "Cadastra um lead no CRM, opcionalmente em uma etapa indicada pelo nome.",
  input: z.object({ lead: leadInputSchema.omit({ stageId: true }), stage: z.string().trim().min(1).max(200).optional() }),
  execute: async (ctx, { lead, stage }) => createLead(ctx, { ...lead, stageId: stage ? await resolveStage(ctx, stage) : undefined }),
});
const updateLeadTool = defineTool({
  name: "update_lead", description: "Atualiza campos de um lead identificado pelo ID, após desambiguar a busca.",
  input: z.object({ leadId: z.uuid(), patch: leadPatchSchema }),
  execute: (ctx, { leadId, patch }) => updateLead(ctx, leadId, patch),
});
const moveLeadTool = defineTool({
  name: "move_lead_to_stage", description: "Move um lead identificado pelo ID para uma etapa do funil indicada pelo nome ou ID.",
  input: z.object({ leadId: moveLeadSchema.shape.leadId, stage: z.string().trim().min(1).max(200) }),
  execute: async (ctx, { leadId, stage }) => moveLead(ctx, { leadId, stageId: await resolveStage(ctx, stage), index: 100000 }),
});
const addLeadNoteTool = defineTool({
  name: "add_lead_note", description: "Adiciona uma anotação ao histórico de um lead identificado pelo ID.",
  input: noteSchema, execute: async (ctx, { leadId, content }) => { await addLeadNote(ctx, leadId, content); return { added: true }; },
});
const getFunnelMetricsTool = defineTool({
  name: "get_funnel_metrics", description: "Consulta as métricas atuais do funil de vendas, incluindo totais e taxas de passagem.",
  input: z.object({}), execute: (ctx) => getFunnelMetrics(ctx),
});
const scheduleLeadMeetingTool = defineTool({
  name: "schedule_lead_meeting",
  description: "Agenda reunião no Google Calendar e envia convite ao e-mail do lead. Antes de usar, confirme lead, título, data, horário e duração com o usuário.",
  input: meetingSchema,
  execute: (ctx, input) => scheduleLeadMeeting(ctx, input),
});

export const HERMES_TOOLS: HermesTool[] = [
  getBrandContextTool,
  updateBrandContextTool,
  getPlanAndUsageTool,
  listRecentActivityTool,
  listIntegrationsTool,
  getIntegrationSetupGuideTool,
  listLeadsTool, createLeadTool, updateLeadTool, moveLeadTool, addLeadNoteTool, getFunnelMetricsTool,
  scheduleLeadMeetingTool,
] as HermesTool[];

// Tools prontas para o AI SDK, já presas ao contexto (organização, usuário, canal) da requisição.
export function buildHermesTools(ctx: ServiceContext): ToolSet {
  return Object.fromEntries(
    HERMES_TOOLS.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.input,
        needsApproval: definition.needsApproval,
        execute: (input: unknown) => runTool(ctx, definition, input),
      }),
    ]),
  );
}
