import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { aggregateCampaignMetrics, computeCampaignMetrics, formatCentsBRL } from "@/lib/meta-ads/metrics";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/services/errors";
import {
  activateCampaignProposalSchema,
  checkAdsReadiness,
  confirmAdAction,
  createCampaignProposalSchema,
  listAdAccounts,
  listAdActionLogs,
  listAdCampaigns,
  pauseAdCampaign,
  pauseCampaignSchema,
  proposeActivateCampaign,
  proposeCreateCampaign,
  proposeUpdateCampaignBudget,
  syncAccountCampaignsAndMetrics,
  syncAccountSchema,
  updateCampaignBudgetProposalSchema,
} from "@/lib/services/meta-ads";
import { defineTool } from "./run-tool";

export type MetaAdsApproval = { conversationId: string; proof: string | null; messageId?: string };

// UUID v5 (SHA-1) estável por mensagem e parâmetros: evita propostas duplicadas em chamadas repetidas/paralelas.
export function deterministicMetaAdsUuid(...parts: string[]) {
  const hex = createHash("sha1").update(JSON.stringify(["clinkup-meta-ads", ...parts])).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function enforceAdsRateLimit(scope: "sync" | "write", orgId: string, userId: string | null) {
  const rule = scope === "sync" ? RATE_LIMITS.metaAdsSync : RATE_LIMITS.metaAdsWrite;
  const [byUser, byOrg] = await Promise.all([
    rateLimit(`meta-ads:${scope}:user:${userId ?? "anon"}`, rule),
    rateLimit(`meta-ads:${scope}:org:${orgId}`, rule),
  ]);
  if (!byUser || !byOrg) throw new ServiceError(RATE_LIMIT_MESSAGE);
}

const checkAdsReadinessTool = defineTool({
  name: "check_ads_readiness",
  description:
    "Verifica se a empresa está pronta para operar Meta Ads: plano (Growth ou Scale), contas conectadas, permissões faltantes, status da conta e tetos de orçamento configurados.",
  input: z.object({}),
  execute: (ctx) => checkAdsReadiness(ctx),
});

const listAdAccountsTool = defineTool({
  name: "list_ad_accounts",
  description:
    "Lista as contas de anúncios Meta Ads vinculadas à empresa, incluindo IDs, moeda, pixel e tetos diário e mensal de orçamento configurados.",
  input: z.object({}),
  execute: async (ctx) => {
    const accounts = await listAdAccounts(ctx);
    return accounts.map((acc) => ({
      adAccountId: acc.id,
      externalAdAccountId: acc.external_ad_account_id,
      name: acc.name,
      currency: acc.currency,
      accountStatus: acc.account_status,
      pixelId: acc.pixel_id,
      dailyBudgetCapCents: acc.daily_budget_cap_cents,
      monthlyBudgetCapCents: acc.monthly_budget_cap_cents,
      lastSyncedAt: acc.last_synced_at,
    }));
  },
});

const listAdCampaignsTool = defineTool({
  name: "list_ad_campaigns",
  description:
    "Lista campanhas Meta Ads da empresa (opcionalmente filtradas por conta) com KPIs calculados: investimento, impressões, cliques, leads, CTR e CPC.",
  input: z.object({ adAccountId: z.uuid().optional() }),
  execute: async (ctx, { adAccountId }) => {
    const campaigns = await listAdCampaigns(ctx, adAccountId);
    const totals = aggregateCampaignMetrics(campaigns);
    return {
      totals,
      campaigns: campaigns.map((campaign) => ({
        campaignId: campaign.id,
        adAccountId: campaign.ad_account_id,
        name: campaign.name,
        objective: campaign.objective,
        status: campaign.status,
        dailyBudgetCents: campaign.daily_budget_cents,
        metrics: computeCampaignMetrics(campaign.metrics),
        lastSyncedAt: campaign.last_synced_at,
      })),
    };
  },
});

const listAdActionLogsTool = defineTool({
  name: "list_ad_action_logs",
  description:
    "Consulta o histórico de auditoria das ações no Meta Ads da empresa (tetos, sincronizações, criações, ativações, pausas e ajustes de orçamento).",
  input: z.object({ limit: z.number().int().min(1).max(50).default(15) }),
  execute: (ctx, { limit }) => listAdActionLogs(ctx, limit),
});

const syncAdCampaignsTool = defineTool({
  name: "sync_ad_campaigns",
  description:
    "Sincroniza campanhas, conjuntos, anúncios e métricas (insights) de uma conta Meta Ads vinculada à empresa.",
  input: syncAccountSchema,
  execute: async (ctx, input) => {
    await enforceAdsRateLimit("sync", ctx.organizationId, ctx.userId);
    return syncAccountCampaignsAndMetrics(ctx, input);
  },
});

const pauseAdCampaignTool = defineTool({
  name: "pause_ad_campaign",
  description:
    "Pausa imediatamente uma campanha ativa no Meta Ads para interromper o gasto (ação segura; exige plano Growth/Scale e papel proprietário ou administrador).",
  input: pauseCampaignSchema,
  execute: async (ctx, input) => {
    await enforceAdsRateLimit("write", ctx.organizationId, ctx.userId);
    const updated = await pauseAdCampaign(ctx, input);
    return { campaignId: updated.id, name: updated.name, status: updated.status };
  },
});

export const META_ADS_READ_TOOLS = [
  checkAdsReadinessTool,
  listAdAccountsTool,
  listAdCampaignsTool,
  listAdActionLogsTool,
  syncAdCampaignsTool,
  pauseAdCampaignTool,
] as const;

const proposeCreateInputSchema = createCampaignProposalSchema.omit({ requestId: true });

export function buildMetaAdsTurnTools(approval: MetaAdsApproval | undefined) {
  const requireConversation = () => {
    if (!approval) throw new ServiceError("Não foi possível identificar esta conversa.");
    return approval;
  };
  const requireMessageBinding = () => {
    if (!approval?.messageId) throw new ServiceError("Não foi possível identificar esta conversa.");
    return { conversationId: approval.conversationId, messageId: approval.messageId };
  };

  const proposeCampaignTool = defineTool({
    name: "propose_ad_campaign",
    description:
      "Prepara uma proposta persistente para criar uma campanha paga no Meta Ads, validando plano, papel admin/owner e tetos diário/mensal da conta. Não cria nada ainda: mostre o resumo e o comando de confirmação gerado para o usuário responder em uma nova mensagem.",
    input: proposeCreateInputSchema,
    execute: async (ctx, input) => {
      const { conversationId, messageId } = requireMessageBinding();
      await enforceAdsRateLimit("write", ctx.organizationId, ctx.userId);
      const requestId = deterministicMetaAdsUuid(
        "create",
        ctx.organizationId,
        ctx.userId ?? "",
        conversationId,
        messageId,
        input.adAccountId,
        input.name,
        input.objective,
        String(input.dailyBudgetCents),
        input.initialStatus,
      );
      const proposal = await proposeCreateCampaign(ctx, { conversationId }, { ...input, requestId });
      return {
        operation: proposal.operation,
        adAccountName: proposal.adAccountName,
        dailyBudgetCapCents: proposal.dailyBudgetCapCents,
        campaign: proposal.campaign,
        summary: `Criar campanha "${proposal.campaign.name}" na conta ${proposal.adAccountName} com orçamento diário de ${formatCentsBRL(proposal.campaign.dailyBudgetCents)} (${proposal.campaign.initialStatus === "active" ? "ativa" : "pausada"}).`,
        requiresConfirmation: true,
        instruction: `Para confirmar a criação desta campanha no Meta Ads, responda exatamente: CONFIRMAR ${proposal.code}`,
      };
    },
  });

  const proposeActivateTool = defineTool({
    name: "propose_activate_ad_campaign",
    description:
      "Prepara uma proposta persistente para ativar uma campanha pausada no Meta Ads, validando tetos diário/mensal e limite de campanhas ativas do plano. Não ativa nada antes da confirmação explícita em nova mensagem.",
    input: activateCampaignProposalSchema,
    execute: async (ctx, input) => {
      const { conversationId } = requireConversation();
      await enforceAdsRateLimit("write", ctx.organizationId, ctx.userId);
      const proposal = await proposeActivateCampaign(ctx, { conversationId }, input);
      return {
        operation: proposal.operation,
        campaignName: proposal.campaignName,
        dailyBudgetCents: proposal.dailyBudgetCents,
        summary: `Ativar campanha "${proposal.campaignName}" (orçamento diário de ${formatCentsBRL(proposal.dailyBudgetCents)}).`,
        requiresConfirmation: true,
        instruction: `Para confirmar a ativação desta campanha no Meta Ads, responda exatamente: CONFIRMAR ${proposal.code}`,
      };
    },
  });

  const proposeUpdateBudgetTool = defineTool({
    name: "propose_update_ad_budget",
    description:
      "Prepara uma proposta persistente para alterar o orçamento diário de uma campanha no Meta Ads, validando tetos diário/mensal da conta. Não altera nada antes da confirmação explícita em nova mensagem.",
    input: updateCampaignBudgetProposalSchema,
    execute: async (ctx, input) => {
      const { conversationId } = requireConversation();
      await enforceAdsRateLimit("write", ctx.organizationId, ctx.userId);
      const proposal = await proposeUpdateCampaignBudget(ctx, { conversationId }, input);
      return {
        operation: proposal.operation,
        campaignName: proposal.campaignName,
        previousDailyBudgetCents: proposal.previousDailyBudgetCents,
        newDailyBudgetCents: proposal.newDailyBudgetCents,
        summary: `Alterar orçamento diário de "${proposal.campaignName}" de ${formatCentsBRL(proposal.previousDailyBudgetCents)} para ${formatCentsBRL(proposal.newDailyBudgetCents)}.`,
        requiresConfirmation: true,
        instruction: `Para confirmar o ajuste de orçamento desta campanha no Meta Ads, responda exatamente: CONFIRMAR ${proposal.code}`,
      };
    },
  });

  const confirmAdActionTool = defineTool({
    name: "confirm_ad_action",
    description:
      "Executa a ação financeira de Meta Ads aprovada (criar campanha, ativar ou ajustar orçamento) somente quando a mensagem atual do usuário contém o comando de confirmação completo.",
    input: z.object({}),
    execute: async (ctx) => {
      const { conversationId, proof } = requireConversation();
      if (!proof) {
        throw new ServiceError("Peça ao usuário que envie o comando de confirmação recebido na proposta.");
      }
      await enforceAdsRateLimit("write", ctx.organizationId, ctx.userId);
      return confirmAdAction(ctx, { conversationId }, proof);
    },
  });

  return [proposeCampaignTool, proposeActivateTool, proposeUpdateBudgetTool, confirmAdActionTool];
}
