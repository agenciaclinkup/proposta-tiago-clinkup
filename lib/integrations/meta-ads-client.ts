import "server-only";
import { z } from "zod";
import { META_GRAPH_VERSION } from "@/lib/integrations/meta";
import { ServiceError } from "@/lib/services/errors";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const DEFAULT_TIMEOUT_MS = 15_000;

export const AD_OBJECTIVES = [
  "OUTCOME_LEADS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_AWARENESS",
  "OUTCOME_SALES",
] as const;
export type AdObjective = (typeof AD_OBJECTIVES)[number];

export const metaRemoteCampaignSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  objective: z.enum(AD_OBJECTIVES).catch("OUTCOME_LEADS"),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).catch("PAUSED"),
  daily_budget: z.coerce.number().int().min(100).catch(100),
});

export const metaRemoteAdSetSchema = z.object({
  id: z.string().min(1).max(100),
  campaign_id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).catch("PAUSED"),
  daily_budget: z.coerce.number().int().min(100).optional(),
  optimization_goal: z.string().max(100).optional(),
  targeting: z.record(z.string(), z.unknown()).optional().default({}),
});

export const metaRemoteAdSchema = z.object({
  id: z.string().min(1).max(100),
  adset_id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).catch("PAUSED"),
  creative: z.record(z.string(), z.unknown()).optional().default({}),
});

export const metaRemoteInsightSchema = z.object({
  campaign_id: z.string().min(1).max(100),
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_stop: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend_cents: z.number().int().min(0),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  leads: z.number().int().min(0),
  roas: z.number().min(0),
  raw: z.record(z.string(), z.unknown()).default({}),
});

export type MetaRemoteCampaign = z.output<typeof metaRemoteCampaignSchema>;
export type MetaRemoteAdSet = z.output<typeof metaRemoteAdSetSchema>;
export type MetaRemoteAd = z.output<typeof metaRemoteAdSchema>;
export type MetaRemoteInsight = z.output<typeof metaRemoteInsightSchema>;

export type MetaAdsClient = {
  listCampaigns(adAccountId: string, accessToken: string, signal?: AbortSignal): Promise<MetaRemoteCampaign[]>;
  listAdSets(adAccountId: string, accessToken: string, signal?: AbortSignal): Promise<MetaRemoteAdSet[]>;
  listAds(adAccountId: string, accessToken: string, signal?: AbortSignal): Promise<MetaRemoteAd[]>;
  getCampaignInsights(
    adAccountId: string,
    accessToken: string,
    range: { since: string; until: string },
    signal?: AbortSignal,
  ): Promise<MetaRemoteInsight[]>;
  createCampaign(
    adAccountId: string,
    accessToken: string,
    input: { name: string; objective: AdObjective; dailyBudgetCents: number; status: "ACTIVE" | "PAUSED" },
    signal?: AbortSignal,
  ): Promise<{ id: string }>;
  updateCampaign(
    externalCampaignId: string,
    accessToken: string,
    patch: { status?: "ACTIVE" | "PAUSED"; dailyBudgetCents?: number },
    signal?: AbortSignal,
  ): Promise<{ success: true }>;
};

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number } };

function mapMetaApiError(status: number, body: GraphErrorBody): ServiceError {
  const code = body.error?.code;
  if (status === 401 || code === 190) {
    return new ServiceError("O token da conta Meta Ads expirou ou foi revogado. Reconecte a conta em Integrações.");
  }
  if (code === 10 || code === 200 || status === 403) {
    return new ServiceError("A conta Meta Ads não tem permissão suficiente (ads_management/ads_read). Reconecte em Integrações.");
  }
  if (status === 429 || code === 17 || code === 613) {
    return new ServiceError("O limite de requisições da Meta Marketing API foi atingido. Tente novamente em alguns minutos.");
  }
  return new ServiceError("A Meta Marketing API retornou um erro ao processar a solicitação. Confira a conta e tente novamente.");
}

async function metaFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; accessToken: string; params?: Record<string, string>; body?: Record<string, string>; signal?: AbortSignal },
): Promise<T> {
  const url = new URL(`${GRAPH}/${path.replace(/^\/+/, "")}`);
  if (init.params) {
    for (const [k, v] of Object.entries(init.params)) url.searchParams.set(k, v);
  }
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${init.accessToken}`,
        ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: init.body ? new URLSearchParams(init.body).toString() : undefined,
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    throw new ServiceError("A Meta Marketing API não respondeu a tempo. Tente novamente em alguns instantes.");
  }
  const parsed = (await response.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!response.ok || parsed.error) throw mapMetaApiError(response.status, parsed);
  return parsed;
}

const rawInsightRowSchema = z.object({
  campaign_id: z.string().min(1),
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_stop: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.coerce.number().min(0).default(0),
  impressions: z.coerce.number().int().min(0).default(0),
  clicks: z.coerce.number().int().min(0).default(0),
  actions: z.array(z.object({ action_type: z.string(), value: z.coerce.number().min(0) })).optional(),
  purchase_roas: z.array(z.object({ value: z.coerce.number().min(0) })).optional(),
});

export function createMetaAdsHttpClient(): MetaAdsClient {
  return {
    async listCampaigns(adAccountId, accessToken, signal) {
      const res = await metaFetch<{ data?: unknown[] }>(`${adAccountId}/campaigns`, {
        method: "GET",
        accessToken,
        params: { fields: "id,name,objective,status,daily_budget", limit: "100" },
        signal,
      });
      return z.array(metaRemoteCampaignSchema).parse(res.data ?? []);
    },
    async listAdSets(adAccountId, accessToken, signal) {
      const res = await metaFetch<{ data?: unknown[] }>(`${adAccountId}/adsets`, {
        method: "GET",
        accessToken,
        params: { fields: "id,campaign_id,name,status,daily_budget,optimization_goal,targeting", limit: "100" },
        signal,
      });
      return z.array(metaRemoteAdSetSchema).parse(res.data ?? []);
    },
    async listAds(adAccountId, accessToken, signal) {
      const res = await metaFetch<{ data?: unknown[] }>(`${adAccountId}/ads`, {
        method: "GET",
        accessToken,
        params: { fields: "id,adset_id,name,status,creative{id,name,title,body}", limit: "100" },
        signal,
      });
      return z.array(metaRemoteAdSchema).parse(res.data ?? []);
    },
    async getCampaignInsights(adAccountId, accessToken, range, signal) {
      const res = await metaFetch<{ data?: unknown[] }>(`${adAccountId}/insights`, {
        method: "GET",
        accessToken,
        params: {
          level: "campaign",
          fields: "campaign_id,date_start,date_stop,spend,impressions,clicks,actions,purchase_roas",
          time_range: JSON.stringify({ since: range.since, until: range.until }),
          limit: "100",
        },
        signal,
      });
      return z.array(rawInsightRowSchema).parse(res.data ?? []).map((row) => {
        const leads = Math.round(
          (row.actions ?? [])
            .filter((a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped")
            .reduce((sum, a) => sum + a.value, 0),
        );
        return metaRemoteInsightSchema.parse({
          campaign_id: row.campaign_id,
          date_start: row.date_start,
          date_stop: row.date_stop,
          spend_cents: Math.round(row.spend * 100),
          impressions: row.impressions,
          clicks: row.clicks,
          leads,
          roas: row.purchase_roas?.[0]?.value ?? 0,
          raw: row,
        });
      });
    },
    async createCampaign(adAccountId, accessToken, input, signal) {
      const res = await metaFetch<{ id?: string }>(`${adAccountId}/campaigns`, {
        method: "POST",
        accessToken,
        body: {
          name: input.name,
          objective: input.objective,
          status: input.status,
          daily_budget: String(input.dailyBudgetCents),
          special_ad_categories: "[]",
        },
        signal,
      });
      if (!res.id) throw new ServiceError("A Meta Marketing API não retornou o identificador da campanha criada.");
      return { id: res.id };
    },
    async updateCampaign(externalCampaignId, accessToken, patch, signal) {
      const body: Record<string, string> = {};
      if (patch.status) body.status = patch.status;
      if (patch.dailyBudgetCents !== undefined) body.daily_budget = String(patch.dailyBudgetCents);
      await metaFetch<{ success?: boolean }>(externalCampaignId, { method: "POST", accessToken, body, signal });
      return { success: true };
    },
  };
}

// Cliente simulado para testes automatizados e validação local sem chamadas externas à Meta.
export function createSimulatedMetaAdsClient(seed?: {
  campaigns?: MetaRemoteCampaign[];
  adSets?: MetaRemoteAdSet[];
  ads?: MetaRemoteAd[];
  insights?: MetaRemoteInsight[];
}): MetaAdsClient {
  let seq = 1;
  const campaigns = [...(seed?.campaigns ?? [])];
  const adSets = [...(seed?.adSets ?? [])];
  const ads = [...(seed?.ads ?? [])];
  const insights = [...(seed?.insights ?? [])];
  return {
    async listCampaigns() { return [...campaigns]; },
    async listAdSets() { return [...adSets]; },
    async listAds() { return [...ads]; },
    async getCampaignInsights() { return [...insights]; },
    async createCampaign(_adAccountId, _accessToken, input) {
      const id = `sim_camp_${seq++}`;
      campaigns.push({ id, name: input.name, objective: input.objective, status: input.status, daily_budget: input.dailyBudgetCents });
      return { id };
    },
    async updateCampaign(externalCampaignId, _accessToken, patch) {
      const target = campaigns.find((c) => c.id === externalCampaignId);
      if (target) {
        if (patch.status) target.status = patch.status;
        if (patch.dailyBudgetCents !== undefined) target.daily_budget = patch.dailyBudgetCents;
      }
      return { success: true };
    },
  };
}
