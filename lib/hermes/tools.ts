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
import { getSocialPost, listSocialPosts, saveSocialPost, saveSocialPostSchema, socialPostSchema } from "@/lib/services/social-posts";
import { confirmSocialAction, proposePublishNow, proposeSocialWeek } from "@/lib/services/social-confirmations";
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

const listPostsTool = defineTool({
  name: "list_posts", description: "Lista posts e rascunhos do calendário da empresa. Use os IDs retornados e peça ao usuário para escolher quando houver mais de um post compatível.",
  input: z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), limit: z.number().int().min(1).max(20).default(20), offset: z.number().int().min(0).default(0) }),
  execute: async (ctx, input) => {
    const posts = await listSocialPosts(ctx, input);
    return { posts, selectionRequired: posts.length > 1, mayHaveMore: posts.length === input.limit, nextOffset: input.offset + posts.length };
  },
});
const listCalendarAccountsTool = defineTool({
  name: "list_calendar_accounts", description: "Lista os IDs e nomes das contas conectadas para Instagram, Facebook e Google Meu Negócio, para selecionar destinos de posts.",
  input: z.object({}),
  execute: async (ctx) => (await listIntegrations(ctx)).filter((row) => row.status === "connected" && ["instagram", "facebook_page", "google_business"].includes(row.provider))
    .map((row) => ({ integrationId: row.id, provider: row.provider, name: row.display_name ?? row.external_account_id })),
});
const createPostTool = defineTool({
  name: "create_post", description: "Cria um rascunho ou agenda um novo post no calendário; use IDs de contas conectadas e mídias da empresa, respeitando o horário informado.",
  input: z.object({ status: z.enum(["draft", "scheduled"]), post: socialPostSchema }),
  execute: (ctx, input) => saveSocialPost(ctx, input),
});
const postPatchSchema = z.object({
  format: socialPostSchema.shape.format.optional(),
  caption: socialPostSchema.shape.caption.unwrap().optional(),
  hashtags: socialPostSchema.shape.hashtags.unwrap().optional(),
  media: socialPostSchema.shape.media.unwrap().optional(),
  targets: socialPostSchema.shape.targets.unwrap().optional(),
  scheduledAt: socialPostSchema.shape.scheduledAt,
}).refine((patch) => Object.values(patch).some((value) => value !== undefined), { message: "Informe o que deseja alterar no post." });
const updatePostTool = defineTool({
  name: "update_post", description: "Atualiza somente os campos informados em rascunho ou post agendado, preservando os demais dados e as regras do calendário.",
  input: z.object({ postId: z.uuid(), patch: postPatchSchema }),
  execute: async (ctx, { postId, patch }) => {
    const post = await getSocialPost(ctx, postId);
    if (post.status !== "draft" && post.status !== "scheduled") throw new ServiceError("Este post não pode ser editado no status atual.");
    return saveSocialPost(ctx, { postId, status: post.status, post: {
      format: post.format, caption: post.caption, hashtags: post.hashtags, media: post.media, scheduledAt: post.scheduled_at,
      targets: post.social_post_targets.map((target: { channel: "instagram" | "facebook" | "google_business"; integration_id: string }) => ({ channel: target.channel, integrationId: target.integration_id })), ...patch,
    } });
  },
});
const planWeekTool = defineTool({
  name: "plan_week_with_ai", description: "Apresenta uma proposta de até sete posts criada a partir do Contexto Mestre. É somente prévia: peça confirmação explícita antes de qualquer agendamento.",
  input: z.object({ posts: z.array(socialPostSchema).min(1).max(7) }),
  execute: async (ctx, { posts }) => {
    const brand = await getBrandContext(ctx);
    if (!brand) throw new ServiceError(ONBOARDING_REQUIRED);
    for (const post of posts) {
      const checked = saveSocialPostSchema.safeParse({ status: "scheduled", post });
      if (!checked.success) throw new ServiceError(checked.error.issues[0]?.message ?? "Confira a proposta de agendamento.");
    }
    return { company: brand.company_name, posts, scheduled: false, requiresConfirmation: true, notice: "Esta é uma proposta; nenhum post foi agendado. Peça confirmação explícita antes de continuar." };
  },
});
const reschedulePostTool = defineTool({
  name: "reschedule_post", description: "Agenda um rascunho ou altera a data de um post agendado, identificado por ID. Use data e hora ISO com fuso explícito.",
  input: z.object({ postId: z.uuid(), scheduledAt: z.iso.datetime({ offset: true }) }),
  execute: async (ctx, { postId, scheduledAt }) => {
    const post = await getSocialPost(ctx, postId);
    if (!["draft", "scheduled"].includes(post.status)) throw new ServiceError("Este post não pode ser reagendado no status atual.");
    if (post.status === "draft") throw new ServiceError("Para agendar um rascunho, apresente uma proposta e peça confirmação em uma nova mensagem.");
    return saveSocialPost(ctx, { postId, status: "scheduled", post: {
      format: post.format, caption: post.caption, hashtags: post.hashtags, media: post.media, scheduledAt,
      targets: post.social_post_targets.map((target: { channel: "instagram" | "facebook" | "google_business"; integration_id: string }) => ({ channel: target.channel, integrationId: target.integration_id })),
    } });
  },
});
const cancelPostTool = defineTool({
  name: "cancel_post", description: "Cancela o agendamento de um post identificado por ID, mantendo seu conteúdo como rascunho. Não exclui o post nem estorna a cota.",
  input: z.object({ postId: z.uuid() }),
  execute: async (ctx, { postId }) => {
    const post = await getSocialPost(ctx, postId);
    if (post.status !== "scheduled") throw new ServiceError("Somente posts agendados podem ter o agendamento cancelado.");
    return saveSocialPost(ctx, { postId, status: "draft", post: {
      format: post.format, caption: post.caption, hashtags: post.hashtags, media: post.media, scheduledAt: null,
      targets: post.social_post_targets.map((target: { channel: "instagram" | "facebook" | "google_business"; integration_id: string }) => ({ channel: target.channel, integrationId: target.integration_id })),
    } });
  },
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
  listPostsTool, listCalendarAccountsTool, createPostTool, updatePostTool, reschedulePostTool, cancelPostTool, planWeekTool,
] as HermesTool[];

// Tools prontas para o AI SDK, já presas ao contexto (organização, usuário, canal) da requisição.
export function buildHermesTools(ctx: ServiceContext, approval?: { conversationId: string; proof: string | null }): ToolSet {
  // A proposta não pode ser agendada no mesmo turno em que foi exibida.
  let planPresented = false;
  const publishTool = defineTool({ name: "publish_post_now", description: "Prepara a publicação imediata de um post existente. Não publica antes de confirmação explícita em nova mensagem.", input: z.object({ postId: z.uuid() }), execute: async (context, { postId }) => {
    if (!approval) throw new ServiceError("Não foi possível identificar esta conversa.");
    const proposal = await proposePublishNow(context, { conversationId: approval.conversationId }, postId);
    return { post: proposal.post, requiresConfirmation: true, instruction: `Para confirmar esta publicação, responda exatamente: CONFIRMAR ${proposal.code}` };
  } });
  const confirmTool = defineTool({ name: "confirm_calendar_action", description: "Executa a proposta aprovada somente quando a mensagem atual do usuário contém o comando de confirmação completo.", input: z.object({}), execute: async (context) => {
    if (!approval?.proof) throw new ServiceError("Peça ao usuário que envie o comando de confirmação recebido na proposta.");
    return confirmSocialAction(context, { conversationId: approval.conversationId }, approval.proof);
  } });
  return Object.fromEntries(
    [...HERMES_TOOLS, publishTool, confirmTool].map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.input,
        needsApproval: definition.needsApproval,
        execute: async (input: unknown) => {
          if (definition.name === "plan_week_with_ai") planPresented = true;
          const schedulingNewPost = definition.name === "create_post" && z.object({ status: z.literal("scheduled") }).safeParse(input).success;
          if (planPresented && (schedulingNewPost || definition.name === "reschedule_post" || definition.name === "update_post")) {
            return runTool(ctx, { ...definition, execute: async () => { throw new ServiceError("A proposta foi apresentada agora. Peça ao usuário confirmação em uma nova mensagem antes de agendar."); } }, input);
          }
          if (definition.name === "plan_week_with_ai" && approval) {
            return runTool(ctx, { ...planWeekTool, execute: async (context, value) => {
              const preview = await planWeekTool.execute(context, value);
              const code = await proposeSocialWeek(context, { conversationId: approval.conversationId }, value.posts);
              return { ...preview, instruction: `Para agendar esta proposta, responda exatamente: CONFIRMAR ${code}` };
            } }, input);
          }
          if (schedulingNewPost && approval) return runTool(ctx, { ...definition, execute: async () => { throw new ServiceError("Para agendar, apresente uma proposta e peça a confirmação em uma nova mensagem."); } }, input);
          return runTool(ctx, definition, input);
        },
      }),
    ]),
  );
}
