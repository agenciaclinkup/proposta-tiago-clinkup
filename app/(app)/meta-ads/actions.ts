"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import {
  activateCampaignProposalSchema,
  confirmAdAction,
  createCampaignProposalSchema,
  pauseAdCampaign,
  pauseCampaignSchema,
  proposeActivateCampaign,
  proposeCreateCampaign,
  proposeUpdateCampaignBudget,
  syncAccountCampaignsAndMetrics,
  syncAccountSchema,
  syncAdAccountFromIntegration,
  updateAdAccountBudgetCaps,
  updateBudgetCapsSchema,
  updateCampaignBudgetProposalSchema,
} from "@/lib/services/meta-ads";
import { requireWorkspace } from "@/lib/workspace";

const confirmInputSchema = z.strictObject({
  code: z.string().regex(/^[0-9a-f]{32}$/, "Código de confirmação inválido."),
  confirmed: z.literal(true, { message: "Confirme explicitamente o impacto financeiro antes de executar." }),
});

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ServiceError ? error.message : fallback;
}

async function checkWriteLimits(orgId: string, userId: string) {
  const [byUser, byOrg] = await Promise.all([
    rateLimit(`meta-ads:write:user:${userId}`, RATE_LIMITS.metaAdsWrite),
    rateLimit(`meta-ads:write:org:${orgId}`, RATE_LIMITS.metaAdsWrite),
  ]);
  return byUser && byOrg;
}

export async function linkMetaAdAccountAction(input: unknown): Promise<{ accountId: string } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await checkWriteLimits(workspace.organization.id, workspace.user.id))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = z.strictObject({ integrationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Selecione uma conta Meta Ads válida." };
  try {
    const account = await syncAdAccountFromIntegration(serviceContext(workspace, "manual"), parsed.data.integrationId);
    revalidatePath("/meta-ads");
    return { accountId: account.id };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível vincular a conta de anúncios.") };
  }
}

export async function updateBudgetCapsAction(input: unknown): Promise<{ ok: true } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await checkWriteLimits(workspace.organization.id, workspace.user.id))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = updateBudgetCapsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confira os valores dos tetos de orçamento." };
  try {
    await updateAdAccountBudgetCaps(serviceContext(workspace, "manual"), parsed.data);
    revalidatePath("/meta-ads");
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível atualizar os tetos de orçamento.") };
  }
}

export async function syncMetaAdsAction(
  input: unknown,
): Promise<{ campaignsSynced: number; snapshotsSynced: number } | { error: string }> {
  const workspace = await requireWorkspace();
  const [byUser, byOrg] = await Promise.all([
    rateLimit(`meta-ads:sync:user:${workspace.user.id}`, RATE_LIMITS.metaAdsSync),
    rateLimit(`meta-ads:sync:org:${workspace.organization.id}`, RATE_LIMITS.metaAdsSync),
  ]);
  if (!byUser || !byOrg) return { error: RATE_LIMIT_MESSAGE };
  const parsed = syncAccountSchema.safeParse(input);
  if (!parsed.success) return { error: "Selecione uma conta de anúncios válida para sincronizar." };
  try {
    const result = await syncAccountCampaignsAndMetrics(serviceContext(workspace, "manual"), parsed.data);
    revalidatePath("/meta-ads");
    return { campaignsSynced: result.campaignsSynced, snapshotsSynced: result.snapshotsSynced };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível sincronizar campanhas e métricas agora.") };
  }
}

export type PendingProposal = {
  code: string;
  operation: "create_campaign" | "activate_campaign" | "update_budget";
  title: string;
  details: string;
};

export async function proposeCreateCampaignAction(input: unknown): Promise<{ proposal: PendingProposal } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await checkWriteLimits(workspace.organization.id, workspace.user.id))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = createCampaignProposalSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confira os dados da campanha." };
  try {
    const res = await proposeCreateCampaign(serviceContext(workspace, "manual"), { conversationId: null }, parsed.data);
    return {
      proposal: {
        code: res.code,
        operation: "create_campaign",
        title: `Criar campanha "${res.campaign.name}"`,
        details: `Conta ${res.adAccountName} · Orçamento diário de ${(res.campaign.dailyBudgetCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · Status inicial: ${res.campaign.initialStatus === "active" ? "Ativa" : "Pausada"}.`,
      },
    };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível preparar a proposta de campanha.") };
  }
}

export async function proposeActivateCampaignAction(input: unknown): Promise<{ proposal: PendingProposal } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await checkWriteLimits(workspace.organization.id, workspace.user.id))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = activateCampaignProposalSchema.safeParse(input);
  if (!parsed.success) return { error: "Selecione uma campanha válida para ativar." };
  try {
    const res = await proposeActivateCampaign(serviceContext(workspace, "manual"), { conversationId: null }, parsed.data);
    return {
      proposal: {
        code: res.code,
        operation: "activate_campaign",
        title: `Ativar campanha "${res.campaignName}"`,
        details: `A campanha passará a consumir até ${(res.dailyBudgetCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por dia.`,
      },
    };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível preparar a ativação da campanha.") };
  }
}

export async function proposeUpdateBudgetAction(input: unknown): Promise<{ proposal: PendingProposal } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await checkWriteLimits(workspace.organization.id, workspace.user.id))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = updateCampaignBudgetProposalSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Informe um novo orçamento diário válido." };
  try {
    const res = await proposeUpdateCampaignBudget(serviceContext(workspace, "manual"), { conversationId: null }, parsed.data);
    const fmt = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return {
      proposal: {
        code: res.code,
        operation: "update_budget",
        title: `Alterar orçamento de "${res.campaignName}"`,
        details: `Orçamento diário mudará de ${fmt(res.previousDailyBudgetCents)} para ${fmt(res.newDailyBudgetCents)}.`,
      },
    };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível preparar o ajuste de orçamento.") };
  }
}

export async function confirmMetaAdsAction(input: unknown): Promise<{ operation: string } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await checkWriteLimits(workspace.organization.id, workspace.user.id))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = confirmInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confirmação inválida." };
  try {
    const result = await confirmAdAction(serviceContext(workspace, "manual"), { conversationId: null }, parsed.data.code);
    revalidatePath("/meta-ads");
    return { operation: result.operation };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível executar a ação confirmada.") };
  }
}

export async function pauseCampaignAction(input: unknown): Promise<{ ok: true } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await checkWriteLimits(workspace.organization.id, workspace.user.id))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = pauseCampaignSchema.safeParse(input);
  if (!parsed.success) return { error: "Selecione uma campanha válida para pausar." };
  try {
    await pauseAdCampaign(serviceContext(workspace, "manual"), parsed.data);
    revalidatePath("/meta-ads");
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error, "Não foi possível pausar a campanha.") };
  }
}
