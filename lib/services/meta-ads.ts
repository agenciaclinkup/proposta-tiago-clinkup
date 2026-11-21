import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getPlan } from "@/config/plans";
import {
  AD_OBJECTIVES,
  createMetaAdsHttpClient,
  type MetaAdsClient,
} from "@/lib/integrations/meta-ads-client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { getIntegrationToken } from "./integrations";

const hashProof = (code: string) => createHash("sha256").update(code).digest("hex");
export type AdConfirmationBinding = { conversationId: string | null };

export const updateBudgetCapsSchema = z.strictObject({
  adAccountId: z.uuid(),
  dailyBudgetCapCents: z.number().int().min(0).max(100_000_000),
  monthlyBudgetCapCents: z.number().int().min(0).max(1_000_000_000),
}).refine(
  (data) => data.monthlyBudgetCapCents === 0 || data.monthlyBudgetCapCents >= data.dailyBudgetCapCents,
  { message: "O teto mensal deve ser maior ou igual ao teto diário (ou zero para desativar o limite mensal)." },
);

export const syncAccountSchema = z.strictObject({
  adAccountId: z.uuid(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const createCampaignProposalSchema = z.strictObject({
  adAccountId: z.uuid(),
  requestId: z.uuid(),
  name: z.string().trim().min(2, "Informe o nome da campanha.").max(200),
  objective: z.enum(AD_OBJECTIVES),
  dailyBudgetCents: z.number().int().min(100, "O orçamento diário mínimo é R$ 1,00.").max(100_000_000),
  initialStatus: z.enum(["paused", "active"]).default("paused"),
  audience: z.record(z.string(), z.unknown()).default({}),
  creative: z.record(z.string(), z.unknown()).default({}),
});

export const activateCampaignProposalSchema = z.strictObject({
  campaignId: z.uuid(),
});

export const updateCampaignBudgetProposalSchema = z.strictObject({
  campaignId: z.uuid(),
  dailyBudgetCents: z.number().int().min(100, "O orçamento diário mínimo é R$ 1,00.").max(100_000_000),
});

export const pauseCampaignSchema = z.strictObject({
  campaignId: z.uuid(),
});

type AdAccountRow = {
  id: string;
  organization_id: string;
  integration_id: string;
  external_ad_account_id: string;
  name: string;
  currency: string;
  account_status: number;
  business_id: string | null;
  pixel_id: string | null;
  daily_budget_cap_cents: number;
  monthly_budget_cap_cents: number;
  last_synced_at: string | null;
};

type AdCampaignRow = {
  id: string;
  organization_id: string;
  ad_account_id: string;
  integration_id: string;
  external_campaign_id: string | null;
  request_id: string | null;
  name: string;
  objective: string;
  daily_budget_cents: number;
  status: string;
  audience: Record<string, unknown>;
  creative: Record<string, unknown>;
  metrics: Record<string, unknown>;
  last_synced_at: string | null;
};

function assertMetaAdsPlan(ctx: ServiceContext) {
  const plan = getPlan(ctx.planId);
  if (!plan || plan.limits.maxActiveAdCampaigns <= 0) {
    throw new ServiceError("O gestor de campanhas Meta Ads está disponível nos planos Growth e Scale. Consulte a página Planos.");
  }
  return plan;
}

async function assertMember(ctx: ServiceContext, requireAdmin: boolean) {
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para gerenciar o Meta Ads.");
  const { data, error } = await createAdminClient()
    .from("organization_members")
    .select("role")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error || !data) throw new ServiceError("Você não tem acesso a esta empresa.");
  if (requireAdmin && !["owner", "admin"].includes(data.role)) {
    throw new ServiceError("Apenas proprietários e administradores podem executar ações financeiras ou alterar campanhas no Meta Ads.");
  }
  return ctx.userId;
}

async function getAccountOrThrow(organizationId: string, adAccountId: string): Promise<AdAccountRow> {
  const { data, error } = await createAdminClient()
    .from("meta_ad_accounts")
    .select("*")
    .eq("id", adAccountId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError("Não encontramos esta conta de anúncios na sua empresa.");
  return data as AdAccountRow;
}

async function getCampaignOrThrow(organizationId: string, campaignId: string): Promise<AdCampaignRow> {
  const { data, error } = await createAdminClient()
    .from("ad_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ServiceError("Não encontramos esta campanha na sua empresa.");
  return data as AdCampaignRow;
}

async function writeActionLog(entry: {
  organizationId: string;
  adAccountId: string;
  campaignId?: string | null;
  action: "update_caps" | "sync" | "create_campaign" | "activate_campaign" | "pause_campaign" | "update_budget";
  actorId: string | null;
  via: "manual" | "hermes" | "system";
  requestId?: string | null;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  status: "succeeded" | "failed";
  error?: string | null;
}) {
  const { error } = await createAdminClient().from("ad_action_logs").insert({
    organization_id: entry.organizationId,
    ad_account_id: entry.adAccountId,
    campaign_id: entry.campaignId ?? null,
    action: entry.action,
    actor_id: entry.actorId,
    via: entry.via,
    request_id: entry.requestId ?? null,
    before_state: entry.beforeState ?? {},
    after_state: entry.afterState ?? {},
    status: entry.status,
    error: entry.error ?? null,
  });
  if (error) console.error("[meta-ads] falha ao registrar log de auditoria", error.message);
}

async function checkBudgetCaps(
  organizationId: string,
  account: AdAccountRow,
  params: {
    excludeCampaignId?: string;
    targetDailyCents: number;
    willBeActive: boolean;
    maxActiveCampaigns: number;
  },
) {
  if (account.daily_budget_cap_cents <= 0) {
    throw new ServiceError("Configure primeiro o teto diário de orçamento da conta de anúncios antes de criar ou ativar campanhas pagas.");
  }
  if (params.targetDailyCents > account.daily_budget_cap_cents) {
    throw new ServiceError("O orçamento diário solicitado ultrapassa o teto diário configurado para esta conta de anúncios.");
  }

  const { data: activeRows, error } = await createAdminClient()
    .from("ad_campaigns")
    .select("id, daily_budget_cents")
    .eq("organization_id", organizationId)
    .eq("ad_account_id", account.id)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  const others = (activeRows ?? []).filter((row) => row.id !== params.excludeCampaignId);
  if (params.willBeActive && others.length >= params.maxActiveCampaigns) {
    throw new ServiceError(`Sua empresa atingiu o limite de ${params.maxActiveCampaigns} campanhas ativas do plano atual.`);
  }
  const otherDaily = others.reduce((sum, row) => sum + Number(row.daily_budget_cents ?? 0), 0);
  const projectedDaily = params.willBeActive ? otherDaily + params.targetDailyCents : params.targetDailyCents;
  if (projectedDaily > account.daily_budget_cap_cents) {
    throw new ServiceError("A soma do orçamento diário das campanhas ativas ultrapassaria o teto diário da conta de anúncios.");
  }
  if (account.monthly_budget_cap_cents > 0 && projectedDaily * 30 > account.monthly_budget_cap_cents) {
    throw new ServiceError("A projeção mensal das campanhas ativas ultrapassaria o teto mensal configurado para esta conta de anúncios.");
  }
}

export async function checkAdsReadiness(ctx: ServiceContext) {
  await assertMember(ctx, false);
  const plan = getPlan(ctx.planId);
  const planEnabled = (plan?.limits.maxActiveAdCampaigns ?? 0) > 0;
  const admin = createAdminClient();

  const [{ data: integrations, error: intError }, { data: accounts, error: accError }] = await Promise.all([
    admin
      .from("integrations")
      .select("id, status, external_account_id, display_name, scopes, metadata")
      .eq("organization_id", ctx.organizationId)
      .eq("provider", "meta_ads"),
    admin
      .from("meta_ad_accounts")
      .select("id, integration_id, external_ad_account_id, name, account_status, pixel_id, daily_budget_cap_cents, monthly_budget_cap_cents")
      .eq("organization_id", ctx.organizationId),
  ]);
  if (intError) throw new Error(intError.message);
  if (accError) throw new Error(accError.message);

  const issues: string[] = [];
  if (!planEnabled) issues.push("Seu plano atual não inclui o gestor de campanhas Meta Ads (disponível nos planos Growth e Scale).");
  const connected = (integrations ?? []).filter((row) => row.status !== "disconnected");
  if (connected.length === 0) issues.push("Nenhuma conta Meta Ads conectada. Conecte sua conta em Integrações.");
  for (const item of connected) {
    if (item.status === "needs_attention") {
      issues.push(`A conta ${item.display_name ?? item.external_account_id} precisa de atenção no Meta Business Manager (pagamento ou revisão).`);
    }
    const scopes = (item.scopes ?? []) as string[];
    const missing = ["ads_management", "ads_read"].filter((scope) => !scopes.includes(scope));
    if (missing.length > 0) {
      issues.push(`Permissões pendentes em ${item.display_name ?? item.external_account_id}: ${missing.join(", ")}.`);
    }
  }
  const hasCap = (accounts ?? []).some((acc) => acc.daily_budget_cap_cents > 0);
  if (connected.length > 0 && !hasCap) {
    issues.push("Configure um teto diário de orçamento antes de criar ou ativar campanhas pagas.");
  }

  return {
    ready: planEnabled && connected.length > 0 && issues.length === 0,
    planEnabled,
    maxActiveAdCampaigns: plan?.limits.maxActiveAdCampaigns ?? 0,
    connectedIntegrations: connected.length,
    accounts: accounts ?? [],
    issues,
  };
}

export async function listAdAccounts(ctx: ServiceContext) {
  await assertMember(ctx, false);
  const { data, error } = await ctx.supabase
    .from("meta_ad_accounts")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdAccountRow[];
}

export async function listAdCampaigns(ctx: ServiceContext, adAccountId?: string) {
  await assertMember(ctx, false);
  let query = ctx.supabase
    .from("ad_campaigns")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (adAccountId) {
    const id = z.uuid().safeParse(adAccountId);
    if (!id.success) throw new ServiceError("Conta de anúncios inválida.");
    query = query.eq("ad_account_id", id.data);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as AdCampaignRow[];
}

export async function listAdActionLogs(ctx: ServiceContext, limit = 30) {
  await assertMember(ctx, false);
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 100);
  const { data, error } = await ctx.supabase
    .from("ad_action_logs")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function syncAdAccountFromIntegration(ctx: ServiceContext, integrationId: string) {
  assertMetaAdsPlan(ctx);
  await assertMember(ctx, true);
  const id = z.uuid().safeParse(integrationId);
  if (!id.success) throw new ServiceError("Integração Meta Ads inválida.");

  const admin = createAdminClient();
  const { data: integration, error: intError } = await admin
    .from("integrations")
    .select("id, organization_id, provider, status, external_account_id, display_name, metadata")
    .eq("id", id.data)
    .eq("organization_id", ctx.organizationId)
    .eq("provider", "meta_ads")
    .maybeSingle();
  if (intError) throw new Error(intError.message);
  if (!integration || integration.status === "disconnected") {
    throw new ServiceError("Integração Meta Ads não encontrada ou desconectada.");
  }
  const meta = (integration.metadata ?? {}) as Record<string, unknown>;
  const { data, error } = await admin
    .from("meta_ad_accounts")
    .upsert(
      {
        organization_id: ctx.organizationId,
        integration_id: integration.id,
        provider: "meta_ads",
        external_ad_account_id: integration.external_account_id,
        name: integration.display_name ?? integration.external_account_id,
        account_status: typeof meta.account_status === "number" ? meta.account_status : 1,
        business_id: typeof meta.business_id === "string" ? meta.business_id : null,
        pixel_id: typeof meta.pixel_id === "string" ? meta.pixel_id : null,
      },
      { onConflict: "organization_id,integration_id" },
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "meta_ad_accounts upsert failed");
  return data as AdAccountRow;
}

export async function updateAdAccountBudgetCaps(ctx: ServiceContext, input: z.input<typeof updateBudgetCapsSchema>) {
  assertMetaAdsPlan(ctx);
  const userId = await assertMember(ctx, true);
  const parsed = updateBudgetCapsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira os valores dos tetos de orçamento.");
  }
  const account = await getAccountOrThrow(ctx.organizationId, parsed.data.adAccountId);
  const { data, error } = await createAdminClient()
    .from("meta_ad_accounts")
    .update({
      daily_budget_cap_cents: parsed.data.dailyBudgetCapCents,
      monthly_budget_cap_cents: parsed.data.monthlyBudgetCapCents,
    })
    .eq("id", account.id)
    .eq("organization_id", ctx.organizationId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "update caps failed");

  await writeActionLog({
    organizationId: ctx.organizationId,
    adAccountId: account.id,
    action: "update_caps",
    actorId: userId,
    via: ctx.via,
    beforeState: {
      dailyBudgetCapCents: account.daily_budget_cap_cents,
      monthlyBudgetCapCents: account.monthly_budget_cap_cents,
    },
    afterState: {
      dailyBudgetCapCents: parsed.data.dailyBudgetCapCents,
      monthlyBudgetCapCents: parsed.data.monthlyBudgetCapCents,
    },
    status: "succeeded",
  });
  return data as AdAccountRow;
}

function defaultDateRange() {
  const until = new Date();
  const since = new Date(until.getTime() - 29 * 86_400_000);
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
}

export async function syncAccountCampaignsAndMetrics(
  ctx: ServiceContext,
  input: z.input<typeof syncAccountSchema>,
  client: MetaAdsClient = createMetaAdsHttpClient(),
) {
  assertMetaAdsPlan(ctx);
  const userId = await assertMember(ctx, false);
  const parsed = syncAccountSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("Confira a conta de anúncios e o período de sincronização.");

  const account = await getAccountOrThrow(ctx.organizationId, parsed.data.adAccountId);
  const { accessToken } = await getIntegrationToken(ctx.organizationId, account.integration_id);
  const fallbackRange = defaultDateRange();
  const range = { since: parsed.data.since ?? fallbackRange.since, until: parsed.data.until ?? fallbackRange.until };

  const admin = createAdminClient();
  const syncedAt = new Date().toISOString();

  try {
    const [remoteCampaigns, remoteAdSets, remoteAds, remoteInsights] = await Promise.all([
      client.listCampaigns(account.external_ad_account_id, accessToken),
      client.listAdSets(account.external_ad_account_id, accessToken),
      client.listAds(account.external_ad_account_id, accessToken),
      client.getCampaignInsights(account.external_ad_account_id, accessToken, range),
    ]);

    const campaignIdMap = new Map<string, string>();
    for (const remote of remoteCampaigns) {
      const insight = remoteInsights.find((item) => item.campaign_id === remote.id);
      const { data: saved, error } = await admin
        .from("ad_campaigns")
        .upsert(
          {
            organization_id: ctx.organizationId,
            ad_account_id: account.id,
            integration_id: account.integration_id,
            external_campaign_id: remote.id,
            name: remote.name,
            objective: remote.objective,
            daily_budget_cents: remote.daily_budget,
            status: remote.status.toLowerCase(),
            metrics: insight
              ? {
                  spend: insight.spend_cents / 100,
                  impressions: insight.impressions,
                  clicks: insight.clicks,
                  leads: insight.leads,
                  roas: insight.roas,
                }
              : {},
            last_synced_at: syncedAt,
            created_via: "sync",
          },
          { onConflict: "organization_id,external_campaign_id" },
        )
        .select("id")
        .single();
      if (error || !saved) throw new Error(error?.message ?? "campaign upsert failed");
      campaignIdMap.set(remote.id, saved.id);
    }

    const adSetIdMap = new Map<string, string>();
    for (const remoteSet of remoteAdSets) {
      const localCampaignId = campaignIdMap.get(remoteSet.campaign_id);
      if (!localCampaignId) continue;
      const { data: savedSet, error } = await admin
        .from("ad_sets")
        .upsert(
          {
            organization_id: ctx.organizationId,
            campaign_id: localCampaignId,
            external_ad_set_id: remoteSet.id,
            name: remoteSet.name,
            status: remoteSet.status.toLowerCase(),
            daily_budget_cents: remoteSet.daily_budget ?? null,
            optimization_goal: remoteSet.optimization_goal ?? null,
            targeting: remoteSet.targeting,
            last_synced_at: syncedAt,
          },
          { onConflict: "organization_id,external_ad_set_id" },
        )
        .select("id")
        .single();
      if (error || !savedSet) throw new Error(error?.message ?? "ad_set upsert failed");
      adSetIdMap.set(remoteSet.id, savedSet.id);
    }

    let syncedAds = 0;
    for (const remoteAd of remoteAds) {
      const localSetId = adSetIdMap.get(remoteAd.adset_id);
      if (!localSetId) continue;
      const { error } = await admin
        .from("ad_ads")
        .upsert(
          {
            organization_id: ctx.organizationId,
            ad_set_id: localSetId,
            external_ad_id: remoteAd.id,
            name: remoteAd.name,
            status: remoteAd.status.toLowerCase(),
            creative: remoteAd.creative,
            last_synced_at: syncedAt,
          },
          { onConflict: "organization_id,external_ad_id" },
        );
      if (error) throw new Error(error.message);
      syncedAds++;
    }

    let syncedSnapshots = 0;
    for (const insight of remoteInsights) {
      const localCampaignId = campaignIdMap.get(insight.campaign_id);
      if (!localCampaignId) continue;
      const { error } = await admin
        .from("ad_metric_snapshots")
        .upsert(
          {
            organization_id: ctx.organizationId,
            campaign_id: localCampaignId,
            date_start: insight.date_start,
            date_stop: insight.date_stop,
            spend_cents: insight.spend_cents,
            impressions: insight.impressions,
            clicks: insight.clicks,
            leads: insight.leads,
            roas: insight.roas,
            raw: insight.raw,
            captured_at: syncedAt,
          },
          { onConflict: "campaign_id,date_start,date_stop" },
        );
      if (error) throw new Error(error.message);
      syncedSnapshots++;
    }

    await admin
      .from("meta_ad_accounts")
      .update({ last_synced_at: syncedAt })
      .eq("id", account.id)
      .eq("organization_id", ctx.organizationId);

    const summary = {
      campaignsSynced: campaignIdMap.size,
      adSetsSynced: adSetIdMap.size,
      adsSynced: syncedAds,
      snapshotsSynced: syncedSnapshots,
      syncedAt,
    };

    await writeActionLog({
      organizationId: ctx.organizationId,
      adAccountId: account.id,
      action: "sync",
      actorId: userId,
      via: ctx.via,
      afterState: summary,
      status: "succeeded",
    });

    return summary;
  } catch (error) {
    await writeActionLog({
      organizationId: ctx.organizationId,
      adAccountId: account.id,
      action: "sync",
      actorId: userId,
      via: ctx.via,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function persistAdConfirmation(
  ctx: ServiceContext,
  binding: AdConfirmationBinding,
  params: {
    userId: string;
    adAccountId: string;
    campaignId?: string | null;
    operation: "create_campaign" | "activate_campaign" | "update_budget";
    payload: Record<string, unknown>;
  },
) {
  if (!["web", "telegram"].includes(ctx.channel)) {
    throw new ServiceError("Confirmações financeiras do Meta Ads exigem sessão no painel ou no Telegram.");
  }
  const code = randomBytes(16).toString("hex");
  const { error } = await createAdminClient().from("ad_action_confirmations").insert({
    organization_id: ctx.organizationId,
    user_id: params.userId,
    channel: ctx.channel,
    conversation_id: binding.conversationId,
    ad_account_id: params.adAccountId,
    campaign_id: params.campaignId ?? null,
    operation: params.operation,
    proof_hash: hashProof(code),
    payload: params.payload,
  });
  if (error) throw new Error(error.message);
  return code;
}

export async function proposeCreateCampaign(
  ctx: ServiceContext,
  binding: AdConfirmationBinding,
  input: z.input<typeof createCampaignProposalSchema>,
) {
  const plan = assertMetaAdsPlan(ctx);
  const userId = await assertMember(ctx, true);
  const parsed = createCampaignProposalSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira os dados da campanha.");
  }
  const data = parsed.data;
  const account = await getAccountOrThrow(ctx.organizationId, data.adAccountId);

  // Idempotência: se requestId já existe, retorna informação sem criar confirmação duplicada.
  const { data: existing } = await createAdminClient()
    .from("ad_campaigns")
    .select("id, name, status")
    .eq("organization_id", ctx.organizationId)
    .eq("request_id", data.requestId)
    .maybeSingle();
  if (existing) {
    throw new ServiceError("Esta solicitação de campanha já foi executada anteriormente.");
  }

  await checkBudgetCaps(ctx.organizationId, account, {
    targetDailyCents: data.dailyBudgetCents,
    willBeActive: data.initialStatus === "active",
    maxActiveCampaigns: plan.limits.maxActiveAdCampaigns,
  });

  const code = await persistAdConfirmation(ctx, binding, {
    userId,
    adAccountId: account.id,
    operation: "create_campaign",
    payload: data,
  });

  return {
    code,
    operation: "create_campaign" as const,
    adAccountName: account.name,
    dailyBudgetCapCents: account.daily_budget_cap_cents,
    campaign: data,
  };
}

export async function proposeActivateCampaign(
  ctx: ServiceContext,
  binding: AdConfirmationBinding,
  input: z.input<typeof activateCampaignProposalSchema>,
) {
  const plan = assertMetaAdsPlan(ctx);
  const userId = await assertMember(ctx, true);
  const parsed = activateCampaignProposalSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("Selecione uma campanha válida para ativar.");

  const campaign = await getCampaignOrThrow(ctx.organizationId, parsed.data.campaignId);
  if (campaign.status === "active") throw new ServiceError("Esta campanha já está ativa.");
  if (!campaign.external_campaign_id) {
    throw new ServiceError("Esta campanha ainda não possui identificador na Meta. Crie ou sincronize antes de ativar.");
  }

  const account = await getAccountOrThrow(ctx.organizationId, campaign.ad_account_id);
  await checkBudgetCaps(ctx.organizationId, account, {
    excludeCampaignId: campaign.id,
    targetDailyCents: campaign.daily_budget_cents,
    willBeActive: true,
    maxActiveCampaigns: plan.limits.maxActiveAdCampaigns,
  });

  const code = await persistAdConfirmation(ctx, binding, {
    userId,
    adAccountId: account.id,
    campaignId: campaign.id,
    operation: "activate_campaign",
    payload: { campaignId: campaign.id, dailyBudgetCents: campaign.daily_budget_cents },
  });

  return {
    code,
    operation: "activate_campaign" as const,
    campaignName: campaign.name,
    dailyBudgetCents: campaign.daily_budget_cents,
  };
}

export async function proposeUpdateCampaignBudget(
  ctx: ServiceContext,
  binding: AdConfirmationBinding,
  input: z.input<typeof updateCampaignBudgetProposalSchema>,
) {
  const plan = assertMetaAdsPlan(ctx);
  const userId = await assertMember(ctx, true);
  const parsed = updateCampaignBudgetProposalSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira o novo orçamento diário.");
  }

  const campaign = await getCampaignOrThrow(ctx.organizationId, parsed.data.campaignId);
  const account = await getAccountOrThrow(ctx.organizationId, campaign.ad_account_id);
  await checkBudgetCaps(ctx.organizationId, account, {
    excludeCampaignId: campaign.id,
    targetDailyCents: parsed.data.dailyBudgetCents,
    willBeActive: campaign.status === "active",
    maxActiveCampaigns: plan.limits.maxActiveAdCampaigns,
  });

  const code = await persistAdConfirmation(ctx, binding, {
    userId,
    adAccountId: account.id,
    campaignId: campaign.id,
    operation: "update_budget",
    payload: { campaignId: campaign.id, dailyBudgetCents: parsed.data.dailyBudgetCents },
  });

  return {
    code,
    operation: "update_budget" as const,
    campaignName: campaign.name,
    previousDailyBudgetCents: campaign.daily_budget_cents,
    newDailyBudgetCents: parsed.data.dailyBudgetCents,
  };
}

function mapConfirmationError(message: string): ServiceError | null {
  if (message.includes("confirmation_invalid")) {
    return new ServiceError("Esta confirmação expirou, já foi usada ou pertence a outra conversa. Solicite uma nova proposta.");
  }
  if (message.includes("ads_forbidden")) {
    return new ServiceError("Apenas proprietários e administradores podem confirmar ações financeiras no Meta Ads.");
  }
  if (message.includes("ads_cap_not_configured")) {
    return new ServiceError("Configure primeiro o teto diário de orçamento da conta de anúncios antes de continuar.");
  }
  if (message.includes("ads_daily_cap_exceeded")) {
    return new ServiceError("O orçamento solicitado ultrapassa o teto diário configurado para esta conta de anúncios.");
  }
  if (message.includes("ads_monthly_cap_exceeded")) {
    return new ServiceError("A projeção mensal ultrapassa o teto mensal configurado para esta conta de anúncios.");
  }
  if (message.includes("ads_plan_limit")) {
    return new ServiceError("Sua empresa atingiu o limite de campanhas ativas do plano atual. Consulte a página Planos.");
  }
  if (message.includes("ads_account_not_found") || message.includes("ads_campaign_not_found")) {
    return new ServiceError("A conta ou campanha desta confirmação não foi encontrada na sua empresa.");
  }
  return null;
}

export async function confirmAdAction(
  ctx: ServiceContext,
  binding: AdConfirmationBinding,
  proof: string,
  client: MetaAdsClient = createMetaAdsHttpClient(),
) {
  const plan = assertMetaAdsPlan(ctx);
  if (!ctx.userId || !/^[0-9a-f]{32}$/.test(proof)) {
    throw new ServiceError("Confirmação inválida. Solicite uma nova proposta.");
  }

  const admin = createAdminClient();
  const { data: consumed, error } = await admin.rpc("consume_ad_action_confirmation", {
    p_org: ctx.organizationId,
    p_user: ctx.userId,
    p_channel: ctx.channel,
    p_conversation: binding.conversationId,
    p_hash: hashProof(proof),
    p_max_active: plan.limits.maxActiveAdCampaigns,
  });
  if (error) {
    const mapped = mapConfirmationError(error.message);
    if (mapped) throw mapped;
    throw new Error(error.message);
  }

  const confirmed = consumed as {
    operation: "create_campaign" | "activate_campaign" | "update_budget";
    adAccountId: string;
    integrationId: string;
    externalAdAccountId: string;
    campaignId: string | null;
    payload: Record<string, unknown>;
  };

  const { accessToken } = await getIntegrationToken(ctx.organizationId, confirmed.integrationId);

  if (confirmed.operation === "create_campaign") {
    const payload = createCampaignProposalSchema.parse(confirmed.payload);
    // Proteção idempotente: não duplica se o requestId já tiver sido persistido.
    const { data: existing } = await admin
      .from("ad_campaigns")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("request_id", payload.requestId)
      .maybeSingle();
    if (existing) return { operation: "create_campaign" as const, campaign: existing as AdCampaignRow, idempotent: true };

    try {
      const created = await client.createCampaign(confirmed.externalAdAccountId, accessToken, {
        name: payload.name,
        objective: payload.objective,
        dailyBudgetCents: payload.dailyBudgetCents,
        status: payload.initialStatus === "active" ? "ACTIVE" : "PAUSED",
      });
      const { data: saved, error: saveError } = await admin
        .from("ad_campaigns")
        .insert({
          organization_id: ctx.organizationId,
          ad_account_id: confirmed.adAccountId,
          integration_id: confirmed.integrationId,
          external_campaign_id: created.id,
          request_id: payload.requestId,
          name: payload.name,
          objective: payload.objective,
          daily_budget_cents: payload.dailyBudgetCents,
          status: payload.initialStatus,
          audience: payload.audience,
          creative: payload.creative,
          created_by: ctx.userId,
          created_via: ctx.via,
        })
        .select("*")
        .single();
      if (saveError || !saved) throw new Error(saveError?.message ?? "campaign insert failed");

      await writeActionLog({
        organizationId: ctx.organizationId,
        adAccountId: confirmed.adAccountId,
        campaignId: saved.id,
        action: "create_campaign",
        actorId: ctx.userId,
        via: ctx.via,
        requestId: payload.requestId,
        afterState: { externalCampaignId: created.id, dailyBudgetCents: payload.dailyBudgetCents, status: payload.initialStatus },
        status: "succeeded",
      });
      return { operation: "create_campaign" as const, campaign: saved as AdCampaignRow, idempotent: false };
    } catch (err) {
      await writeActionLog({
        organizationId: ctx.organizationId,
        adAccountId: confirmed.adAccountId,
        action: "create_campaign",
        actorId: ctx.userId,
        via: ctx.via,
        requestId: payload.requestId,
        afterState: { name: payload.name, dailyBudgetCents: payload.dailyBudgetCents },
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const campaign = await getCampaignOrThrow(ctx.organizationId, confirmed.campaignId!);

  if (confirmed.operation === "activate_campaign") {
    try {
      if (campaign.external_campaign_id) {
        await client.updateCampaign(campaign.external_campaign_id, accessToken, { status: "ACTIVE" });
      }
      const { data: updated, error: updError } = await admin
        .from("ad_campaigns")
        .update({ status: "active" })
        .eq("id", campaign.id)
        .eq("organization_id", ctx.organizationId)
        .select("*")
        .single();
      if (updError || !updated) throw new Error(updError?.message ?? "activate failed");

      await writeActionLog({
        organizationId: ctx.organizationId,
        adAccountId: confirmed.adAccountId,
        campaignId: campaign.id,
        action: "activate_campaign",
        actorId: ctx.userId,
        via: ctx.via,
        beforeState: { status: campaign.status },
        afterState: { status: "active" },
        status: "succeeded",
      });
      return { operation: "activate_campaign" as const, campaign: updated as AdCampaignRow };
    } catch (err) {
      await writeActionLog({
        organizationId: ctx.organizationId,
        adAccountId: confirmed.adAccountId,
        campaignId: campaign.id,
        action: "activate_campaign",
        actorId: ctx.userId,
        via: ctx.via,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const newDaily = Number(confirmed.payload.dailyBudgetCents);
  try {
    if (campaign.external_campaign_id) {
      await client.updateCampaign(campaign.external_campaign_id, accessToken, { dailyBudgetCents: newDaily });
    }
    const { data: updated, error: updError } = await admin
      .from("ad_campaigns")
      .update({ daily_budget_cents: newDaily })
      .eq("id", campaign.id)
      .eq("organization_id", ctx.organizationId)
      .select("*")
      .single();
    if (updError || !updated) throw new Error(updError?.message ?? "update budget failed");

    await writeActionLog({
      organizationId: ctx.organizationId,
      adAccountId: confirmed.adAccountId,
      campaignId: campaign.id,
      action: "update_budget",
      actorId: ctx.userId,
      via: ctx.via,
      beforeState: { dailyBudgetCents: campaign.daily_budget_cents },
      afterState: { dailyBudgetCents: newDaily },
      status: "succeeded",
    });
    return { operation: "update_budget" as const, campaign: updated as AdCampaignRow };
  } catch (err) {
    await writeActionLog({
      organizationId: ctx.organizationId,
      adAccountId: confirmed.adAccountId,
      campaignId: campaign.id,
      action: "update_budget",
      actorId: ctx.userId,
      via: ctx.via,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// Pausar reduz/interrompe gasto; não exige confirmação financeira, mas exige plano e papel admin/owner.
export async function pauseAdCampaign(
  ctx: ServiceContext,
  input: z.input<typeof pauseCampaignSchema>,
  client: MetaAdsClient = createMetaAdsHttpClient(),
) {
  assertMetaAdsPlan(ctx);
  const userId = await assertMember(ctx, true);
  const parsed = pauseCampaignSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("Selecione uma campanha válida para pausar.");

  const campaign = await getCampaignOrThrow(ctx.organizationId, parsed.data.campaignId);
  if (campaign.status === "paused") return campaign;

  try {
    if (campaign.external_campaign_id) {
      const { accessToken } = await getIntegrationToken(ctx.organizationId, campaign.integration_id);
      await client.updateCampaign(campaign.external_campaign_id, accessToken, { status: "PAUSED" });
    }
    const { data: updated, error } = await createAdminClient()
      .from("ad_campaigns")
      .update({ status: "paused" })
      .eq("id", campaign.id)
      .eq("organization_id", ctx.organizationId)
      .select("*")
      .single();
    if (error || !updated) throw new Error(error?.message ?? "pause failed");

    await writeActionLog({
      organizationId: ctx.organizationId,
      adAccountId: campaign.ad_account_id,
      campaignId: campaign.id,
      action: "pause_campaign",
      actorId: userId,
      via: ctx.via,
      beforeState: { status: campaign.status },
      afterState: { status: "paused" },
      status: "succeeded",
    });
    return updated as AdCampaignRow;
  } catch (err) {
    await writeActionLog({
      organizationId: ctx.organizationId,
      adAccountId: campaign.ad_account_id,
      campaignId: campaign.id,
      action: "pause_campaign",
      actorId: userId,
      via: ctx.via,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
