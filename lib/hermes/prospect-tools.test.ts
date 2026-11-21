import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";

const runB2bProspecting = vi.fn();
const listProspects = vi.fn();
const listProspectSearches = vi.fn();
const proposeProspectTransfer = vi.fn();
const confirmProspectTransfer = vi.fn();
const rateLimit = vi.fn();
const recordHermesLog = vi.fn();

vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  RATE_LIMIT_MESSAGE: "Muitas tentativas em pouco tempo.",
  RATE_LIMITS: {
    prospectingSearch: { limit: 5, windowSeconds: 600 },
    crmUser: { limit: 120, windowSeconds: 60 },
    studioGenerateUser: { limit: 10, windowSeconds: 60 },
  },
}));
vi.mock("@/lib/services/b2b-prospecting", async (original) => ({
  ...(await original<typeof import("@/lib/services/b2b-prospecting")>()),
  runB2bProspecting,
}));
vi.mock("@/lib/services/prospecting", async (original) => ({
  ...(await original<typeof import("@/lib/services/prospecting")>()),
  listProspects,
  listProspectSearches,
}));
vi.mock("@/lib/services/prospect-confirmations", async (original) => ({
  ...(await original<typeof import("@/lib/services/prospect-confirmations")>()),
  proposeProspectTransfer,
  confirmProspectTransfer,
}));

const { buildHermesTools } = await import("./tools");
const { toolLabel } = await import("./tool-labels");

const org = "11111111-1111-4111-8111-111111111111";
const prospectId = "55555555-5555-4555-8555-555555555555";
const searchId = "66666666-6666-4666-8666-666666666666";
const ctxWeb = { organizationId: org, userId: "user-1", via: "hermes", channel: "web", planId: "starter" } as ServiceContext;
const ctxTelegram = { organizationId: org, userId: "user-1", via: "hermes", channel: "telegram", planId: "starter" } as ServiceContext;
const binding = { conversationId: "conv-1", proof: null as string | null, messageId: "msg-1" };
const proof = "b".repeat(32);

type Result = { ok: boolean; data?: Record<string, unknown>; error?: string };
const call = (name: string, input: unknown, tools = buildHermesTools(ctxWeb, binding)) =>
  (tools[name] as unknown as { execute: (input: unknown, options: object) => Promise<Result> }).execute(input, { toolCallId: "t1", messages: [] });

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue(true);
  listProspects.mockResolvedValue([{ id: prospectId, name: "Clínica Alfa", city: "Recife", category: "Saúde", phone: "81999990000", email: null, status: "new" }]);
});

describe("Tools de prospecção B2B no Hermes", () => {
  it("registra todas as Tools com rótulos em português", () => {
    const names = Object.keys(buildHermesTools(ctxWeb, binding));
    for (const name of [
      "list_prospect_searches",
      "list_prospect_results",
      "lookup_cnpj_prospects",
      "search_commercial_prospects",
      "propose_send_prospects_to_crm",
      "confirm_prospect_transfer",
    ]) {
      expect(names).toContain(name);
      expect(toolLabel(name).running).toMatch(/…$/);
      expect(toolLabel(name).done).not.toBe("Ação executada");
    }
  });

  it("exige declaração explícita de origem e base legal antes de consultar CNPJ", async () => {
    const withoutAuth = await call("lookup_cnpj_prospects", {
      authorized: false,
      origin: "Cadastro próprio",
      legalBasis: "Legítimo interesse B2B",
      cnpjs: ["11.222.333/0001-81"],
    });
    expect(withoutAuth.ok).toBe(false);
    expect(runB2bProspecting).not.toHaveBeenCalled();

    const invalidCnpj = await call("lookup_cnpj_prospects", {
      authorized: true,
      origin: "Cadastro próprio",
      legalBasis: "Legítimo interesse B2B",
      cnpjs: ["00.000.000/0000-00"],
    });
    expect(invalidCnpj.ok).toBe(false);
    expect(runB2bProspecting).not.toHaveBeenCalled();
  });

  it("usa chave idempotente estável na mesma mensagem para lookup_cnpj_prospects e informa cota em pt-BR", async () => {
    runB2bProspecting.mockResolvedValue({
      created: true,
      search: { id: searchId, status: "succeeded", results_count: 1, charged_count: 1 },
    });
    const input = {
      authorized: true as const,
      origin: "Carteira de clientes",
      legalBasis: "Execução de contrato",
      cnpjs: ["11.222.333/0001-81"],
    };

    const first = await call("lookup_cnpj_prospects", input);
    const second = await call("lookup_cnpj_prospects", input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.data).toMatchObject({
      created: true,
      search: { searchId, status: "succeeded", resultsCount: 1, chargedCount: 1 },
      prospects: [{ prospectId, name: "Clínica Alfa", city: "Recife", status: "new" }],
      notice: expect.stringContaining("Nenhum contato foi enviado ao CRM ainda"),
    });
    const [req1, req2] = runB2bProspecting.mock.calls.map(([, arg]) => arg.requestId);
    expect(req1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(req2).toBe(req1);
  });

  it("gera chaves diferentes entre mensagens ou organizações distintas", async () => {
    runB2bProspecting.mockResolvedValue({
      created: true,
      search: { id: searchId, status: "succeeded", results_count: 1, charged_count: 0 },
    });
    const input = {
      authorized: true as const,
      origin: "Provedor contratado",
      legalBasis: "Legítimo interesse B2B",
      niche: "8630504",
      location: "Recife",
      maxResults: 10,
    };

    await call("search_commercial_prospects", input, buildHermesTools(ctxWeb, binding));
    await call("search_commercial_prospects", input, buildHermesTools(ctxTelegram, { ...binding, messageId: "msg-2" }));
    await call("search_commercial_prospects", input, buildHermesTools({ ...ctxWeb, organizationId: "99999999-9999-4999-8999-999999999999" }, binding));

    const ids = runB2bProspecting.mock.calls.map(([, arg]) => arg.requestId);
    expect(new Set(ids).size).toBe(3);
  });

  it("respeita o rate limit antes de consultar provedor externo", async () => {
    rateLimit.mockResolvedValueOnce(false);
    const res = await call("search_commercial_prospects", {
      authorized: true,
      origin: "Provedor contratado",
      legalBasis: "Legítimo interesse B2B",
      niche: "8630504",
      location: "Recife",
      maxResults: 5,
    });
    expect(res).toEqual({ ok: false, error: "Muitas tentativas em pouco tempo." });
    expect(runB2bProspecting).not.toHaveBeenCalled();
  });

  it("propõe envio ao CRM sem transferir imediatamente e oculta o código de confirmação no log", async () => {
    proposeProspectTransfer.mockResolvedValueOnce({
      code: proof,
      stage: { id: "stage-1", name: "Novo Lead" },
      prospects: [{ prospectId, name: "Clínica Alfa", city: "Recife", category: "Saúde", phone: "81999990000", email: null }],
    });

    const res = await call("propose_send_prospects_to_crm", { prospectIds: [prospectId], stage: "Novo Lead" }, buildHermesTools(ctxTelegram, binding));
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      stage: { id: "stage-1", name: "Novo Lead" },
      count: 1,
      requiresConfirmation: true,
      instruction: `Para confirmar o envio destes leads ao CRM, responda exatamente: CONFIRMAR ${proof}`,
    });
    expect(proposeProspectTransfer).toHaveBeenCalledWith(ctxTelegram, { conversationId: "conv-1" }, { prospectIds: [prospectId], stage: "Novo Lead" });
    // Código de uso único nunca é gravado em hermes_logs.
    expect(recordHermesLog).toHaveBeenCalledWith(
      ctxTelegram,
      expect.objectContaining({
        toolName: "propose_send_prospects_to_crm",
        output: expect.objectContaining({ instruction: undefined, requiresConfirmation: true }),
      }),
    );
  });

  it("recusa confirm_prospect_transfer sem prova confiável vinda da mensagem do usuário", async () => {
    const tools = buildHermesTools(ctxTelegram, { conversationId: "conv-1", proof: null, messageId: "msg-2" });
    const res = await call("confirm_prospect_transfer", { proof }, tools);
    expect(res.ok).toBe(false);
    expect(confirmProspectTransfer).not.toHaveBeenCalled();
  });

  it("executa confirm_prospect_transfer somente com a prova recebida do canal", async () => {
    confirmProspectTransfer.mockResolvedValueOnce({
      stageId: "stage-1",
      transferredCount: 1,
      leads: [{ id: "crm-1", name: "Clínica Alfa", stage_id: "stage-1" }],
    });
    const tools = buildHermesTools(ctxWeb, { conversationId: "conv-1", proof, messageId: "msg-2" });
    const res = await call("confirm_prospect_transfer", {}, tools);
    expect(res).toEqual({
      ok: true,
      data: { stageId: "stage-1", transferredCount: 1, leads: [{ id: "crm-1", name: "Clínica Alfa", stage_id: "stage-1" }] },
    });
    expect(confirmProspectTransfer).toHaveBeenCalledWith(ctxWeb, { conversationId: "conv-1" }, proof);
  });

  it("retorna erro amigável quando o limite de prospecção ou CRM é atingido", async () => {
    runB2bProspecting.mockRejectedValueOnce(new ServiceError("Você atingiu o limite de leads extraídos do plano Starter."));
    const res = await call("lookup_cnpj_prospects", {
      authorized: true,
      origin: "Base própria",
      legalBasis: "Contrato",
      cnpjs: ["11.222.333/0001-81"],
    });
    expect(res).toEqual({ ok: false, error: "Você atingiu o limite de leads extraídos do plano Starter." });
  });
});
