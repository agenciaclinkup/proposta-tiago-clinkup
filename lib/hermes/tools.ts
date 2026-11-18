import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { onboardingSchema } from "@/lib/onboarding";
import { getPlanAndUsage } from "@/lib/services/account";
import { listRecentActivity } from "@/lib/services/activity";
import { getBrandContext, mergeBrandPatch, saveBrandContext } from "@/lib/services/brand";
import type { ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
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

export const HERMES_TOOLS: HermesTool[] = [
  getBrandContextTool,
  updateBrandContextTool,
  getPlanAndUsageTool,
  listRecentActivityTool,
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
