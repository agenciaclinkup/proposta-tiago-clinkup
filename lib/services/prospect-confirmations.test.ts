import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";

const rpc = vi.fn();
const insert = vi.fn();
const maybeSingle = vi.fn();
const scrapedIn = vi.fn();
const crmCountEq = vi.fn();
const listStages = vi.fn();
const resolveStage = vi.fn();

const from = vi.fn((table: string) => {
  if (table === "organization_members") {
    return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) };
  }
  if (table === "scraped_leads") {
    return { select: () => ({ eq: () => ({ in: scrapedIn }) }) };
  }
  if (table === "crm_leads") {
    return { select: () => ({ eq: crmCountEq }) };
  }
  if (table === "prospect_confirmations") {
    return { insert };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
vi.mock("./crm", () => ({ listStages, resolveStage }));

const { proposeProspectTransfer, confirmProspectTransfer } = await import("./prospect-confirmations");

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const pipeId = "33333333-3333-4333-8333-333333333333";
const stageId = "44444444-4444-4444-8444-444444444444";
const prospectA = "55555555-5555-4555-8555-555555555555";
const prospectB = "66666666-6666-4666-8666-666666666666";
const ctx = { organizationId: org, userId: user, planId: "starter", via: "hermes", channel: "telegram" } as ServiceContext;
const binding = { conversationId: "77777777-7777-4777-8777-777777777777" };

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: { user_id: user }, error: null });
  listStages.mockResolvedValue([{ id: stageId, name: "Novo Lead", pipeline_id: pipeId }]);
  resolveStage.mockResolvedValue(stageId);
  scrapedIn.mockResolvedValue({
    data: [{ id: prospectA, name: "Clínica Alfa", city: "Recife", category: "Saúde", phone: "81999990000", email: "a@alfa.com", status: "new" }],
    error: null,
  });
  crmCountEq.mockResolvedValue({ count: 10, error: null });
  insert.mockResolvedValue({ error: null });
});

describe("proposeProspectTransfer", () => {
  it("gera confirmação persistente vinculada à empresa, conversa, etapa e leads selecionados", async () => {
    const result = await proposeProspectTransfer(ctx, binding, { prospectIds: [prospectA, prospectA], stage: "Novo Lead" });
    expect(result.code).toMatch(/^[0-9a-f]{32}$/);
    expect(result.stage).toEqual({ id: stageId, name: "Novo Lead" });
    expect(result.prospects).toHaveLength(1);
    expect(resolveStage).toHaveBeenCalledWith(ctx, "Novo Lead");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: org,
        user_id: user,
        channel: "telegram",
        conversation_id: binding.conversationId,
        pipeline_id: pipeId,
        stage_id: stageId,
        prospect_ids: [prospectA],
        proof_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("recusa usuário fora da organização", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(proposeProspectTransfer(ctx, binding, { prospectIds: [prospectA] })).rejects.toThrow("acesso");
    expect(insert).not.toHaveBeenCalled();
  });

  it("recusa empresa inexistente ou de outra organização", async () => {
    scrapedIn.mockResolvedValueOnce({ data: [], error: null });
    await expect(proposeProspectTransfer(ctx, binding, { prospectIds: [prospectA, prospectB] })).rejects.toThrow("Não encontramos");
    expect(insert).not.toHaveBeenCalled();
  });

  it("recusa empresa já enviada ao CRM", async () => {
    scrapedIn.mockResolvedValueOnce({
      data: [{ id: prospectA, name: "Clínica Alfa", city: null, category: null, phone: null, email: null, status: "sent_to_crm" }],
      error: null,
    });
    await expect(proposeProspectTransfer(ctx, binding, { prospectIds: [prospectA] })).rejects.toThrow("já foram enviadas");
    expect(insert).not.toHaveBeenCalled();
  });

  it("bloqueia quando o lote ultrapassa o limite de leads do CRM no plano", async () => {
    crmCountEq.mockResolvedValueOnce({ count: 1000, error: null });
    await expect(proposeProspectTransfer(ctx, binding, { prospectIds: [prospectA] })).rejects.toThrow("limite de leads no CRM");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("confirmProspectTransfer", () => {
  const proof = "a".repeat(32);

  it("rejeita prova malformada antes de chamar o banco", async () => {
    await expect(confirmProspectTransfer(ctx, binding, "invalido")).rejects.toThrow("Confirmação inválida");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("chama confirm_prospect_transfer com hash da prova e limite do plano", async () => {
    rpc.mockResolvedValueOnce({ data: { stageId, transferredCount: 1, leads: [{ id: "lead-1", name: "Clínica Alfa", stage_id: stageId }] }, error: null });
    const result = await confirmProspectTransfer(ctx, binding, proof);
    expect(result.transferredCount).toBe(1);
    expect(rpc).toHaveBeenCalledWith(
      "confirm_prospect_transfer",
      expect.objectContaining({
        p_org: org,
        p_user: user,
        p_channel: "telegram",
        p_conversation: binding.conversationId,
        p_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_limit: 1000,
      }),
    );
  });

  it("traduz erros de expiração, replay e limite em português", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "confirmation_invalid" } });
    await expect(confirmProspectTransfer(ctx, binding, proof)).rejects.toThrow("expirou, já foi usada");

    rpc.mockResolvedValueOnce({ data: null, error: { message: "prospect_crm_limit" } });
    await expect(confirmProspectTransfer(ctx, binding, proof)).rejects.toThrow("limite de leads no CRM");

    rpc.mockResolvedValueOnce({ data: null, error: { message: "prospect_stage_invalid" } });
    await expect(confirmProspectTransfer(ctx, binding, proof)).rejects.toThrow("etapa do funil");
  });
});
