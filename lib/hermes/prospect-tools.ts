import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { cnpjSchema } from "@/lib/prospecting/b2b";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { runB2bProspecting } from "@/lib/services/b2b-prospecting";
import { ServiceError } from "@/lib/services/errors";
import { confirmProspectTransfer, proposeProspectTransfer, proposeProspectTransferSchema } from "@/lib/services/prospect-confirmations";
import { listProspects } from "@/lib/services/prospecting";
import { defineTool } from "./run-tool";

export type ProspectApproval = { conversationId: string; proof: string | null; messageId?: string };

// UUID v5 (SHA-1) estável por mensagem e parâmetros: evita cobrança duplicada em chamadas repetidas ou paralelas.
export function deterministicProspectUuid(...parts: string[]) {
  const hex = createHash("sha1").update(JSON.stringify(["clinkup-prospect", ...parts])).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const declarationFields = {
  authorized: z.literal(true, { message: "Confirme com o usuário que a origem dos dados é autorizada." }),
  origin: z.string().trim().min(3, "Informe a origem dos dados (mínimo 3 caracteres).").max(200),
  legalBasis: z.string().trim().min(3, "Informe a base legal declarada pelo usuário (mínimo 3 caracteres).").max(500),
};

const lookupCnpjSchema = z.strictObject({
  ...declarationFields,
  cnpjs: z.array(cnpjSchema).min(1, "Informe ao menos um CNPJ válido.").max(5, "Consulte no máximo 5 CNPJs por vez."),
});

const searchCommercialSchema = z.strictObject({
  ...declarationFields,
  niche: z.string().trim().min(1, "Informe o segmento ou CNAE de 7 dígitos.").max(200),
  location: z.string().trim().min(1, "Informe o município ou região.").max(200),
  maxResults: z.number().int().min(1).max(100),
});

type SearchRecord = { id: string; status: string; results_count?: number; charged_count?: number };
type ProspectSummaryRow = { id: string; name: string; city?: string | null; category?: string | null; phone?: string | null; email?: string | null; status?: string };

function summarizeProspects(rows: ProspectSummaryRow[]) {
  return rows.map((row) => ({
    prospectId: row.id,
    name: row.name,
    city: row.city ?? null,
    category: row.category ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    status: row.status ?? "new",
  }));
}

function searchNotice(created: boolean, search: SearchRecord) {
  if (search.status === "running") {
    return "A consulta ainda está em andamento. Aguarde alguns instantes e verifique os resultados.";
  }
  if (search.status === "failed") {
    return "A consulta não foi concluída; a reserva da cota mensal foi devolvida.";
  }
  const found = search.results_count ?? 0;
  const charged = search.charged_count ?? 0;
  const reused = Math.max(0, found - charged);
  const replay = created ? "" : " (resultado recuperado da mesma solicitação, sem nova cobrança)";
  const quotaDetail = reused > 0
    ? `${charged} novo(s) cobrado(s) da cota mensal e ${reused} já conhecido(s) sem nova cobrança`
    : `${charged} unidade(s) cobrada(s) da cota mensal`;
  return `Consulta concluída com ${found} empresa(s)${replay}: ${quotaDetail}. Nenhum contato foi enviado ao CRM ainda.`;
}

export function buildProspectTurnTools(approval: ProspectApproval | undefined) {
  const requireConversation = () => {
    if (!approval) throw new ServiceError("Não foi possível identificar esta conversa.");
    return approval;
  };
  const requireMessageBinding = () => {
    if (!approval?.messageId) throw new ServiceError("Não foi possível identificar esta conversa.");
    return { conversationId: approval.conversationId, messageId: approval.messageId };
  };

  const lookupCnpjTool = defineTool({
    name: "lookup_cnpj_prospects",
    description:
      "Consulta de 1 a 5 CNPJs autorizados via BrasilAPI (sem quadro societário) e registra a origem e a base legal declaradas pelo usuário. Cobra da cota mensal apenas CNPJs novos na empresa e não envia ao CRM automaticamente.",
    input: lookupCnpjSchema,
    execute: async (ctx, input) => {
      const { conversationId, messageId } = requireMessageBinding();
      if (!(await rateLimit(`prospecting:search:${ctx.userId}`, RATE_LIMITS.prospectingSearch))) {
        throw new ServiceError(RATE_LIMIT_MESSAGE);
      }
      const uniqueCnpjs = [...new Set(input.cnpjs)].sort();
      const requestId = deterministicProspectUuid(
        "brasilapi",
        ctx.organizationId,
        ctx.userId ?? "",
        conversationId,
        messageId,
        ...uniqueCnpjs,
        input.origin,
        input.legalBasis,
      );
      const result = await runB2bProspecting(ctx, { type: "brasilapi", requestId, ...input });
      const search = result.search as SearchRecord;
      const prospects = search.status === "succeeded" ? summarizeProspects((await listProspects(ctx, search.id)) as ProspectSummaryRow[]) : [];
      return {
        created: result.created,
        search: { searchId: search.id, status: search.status, resultsCount: search.results_count ?? 0, chargedCount: search.charged_count ?? 0 },
        prospects,
        notice: searchNotice(result.created, search),
      };
    },
  });

  const searchCommercialTool = defineTool({
    name: "search_commercial_prospects",
    description:
      "Busca empresas B2B por segmento/CNAE (7 dígitos na Casa dos Dados) e município via provedor comercial configurado no servidor, registrando origem e base legal declaradas pelo usuário. Reserva a cota mensal solicitada e devolve automaticamente resultados já conhecidos ou não retornados; não envia ao CRM automaticamente.",
    input: searchCommercialSchema,
    execute: async (ctx, input) => {
      const { conversationId, messageId } = requireMessageBinding();
      if (!(await rateLimit(`prospecting:search:${ctx.userId}`, RATE_LIMITS.prospectingSearch))) {
        throw new ServiceError(RATE_LIMIT_MESSAGE);
      }
      const requestId = deterministicProspectUuid(
        "commercial",
        ctx.organizationId,
        ctx.userId ?? "",
        conversationId,
        messageId,
        input.niche,
        input.location,
        String(input.maxResults),
        input.origin,
        input.legalBasis,
      );
      const result = await runB2bProspecting(ctx, { type: "commercial", requestId, ...input });
      const search = result.search as SearchRecord;
      const prospects = search.status === "succeeded" ? summarizeProspects((await listProspects(ctx, search.id)) as ProspectSummaryRow[]) : [];
      return {
        created: result.created,
        search: { searchId: search.id, status: search.status, resultsCount: search.results_count ?? 0, chargedCount: search.charged_count ?? 0 },
        prospects,
        notice: searchNotice(result.created, search),
      };
    },
  });

  const proposeTransferTool = defineTool({
    name: "propose_send_prospects_to_crm",
    description:
      "Prepara uma proposta persistente para transferir de 1 a 20 resultados de prospecção selecionados para uma etapa do CRM (padrão: primeira etapa do funil). Não transfere nada ainda; mostre o resumo e o comando de confirmação gerado para o usuário responder em uma nova mensagem.",
    input: proposeProspectTransferSchema,
    execute: async (ctx, input) => {
      const { conversationId } = requireConversation();
      const proposal = await proposeProspectTransfer(ctx, { conversationId }, input);
      return {
        stage: proposal.stage,
        prospects: proposal.prospects,
        count: proposal.prospects.length,
        requiresConfirmation: true,
        instruction: `Para confirmar o envio destes leads ao CRM, responda exatamente: CONFIRMAR ${proposal.code}`,
      };
    },
  });

  const confirmTransferTool = defineTool({
    name: "confirm_prospect_transfer",
    description:
      "Executa a transferência transacional dos leads de prospecção aprovados para o CRM somente quando a mensagem atual do usuário contém o comando de confirmação completo.",
    input: z.object({}),
    execute: async (ctx) => {
      const { conversationId, proof } = requireConversation();
      if (!proof) {
        throw new ServiceError("Peça ao usuário que envie o comando de confirmação recebido na proposta.");
      }
      if (!(await rateLimit(`prospecting:send:${ctx.userId}`, RATE_LIMITS.crmUser))) {
        throw new ServiceError(RATE_LIMIT_MESSAGE);
      }
      return confirmProspectTransfer(ctx, { conversationId }, proof);
    },
  });

  return [lookupCnpjTool, searchCommercialTool, proposeTransferTool, confirmTransferTool];
}
