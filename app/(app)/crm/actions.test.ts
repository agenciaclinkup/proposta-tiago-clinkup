import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const requireWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { crmUser: {} }, RATE_LIMIT_MESSAGE: "Muitas tentativas." }));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));
const services = {
  moveLead: vi.fn(),
  createLead: vi.fn(),
  deleteLead: vi.fn(),
  createStage: vi.fn(),
  updateStage: vi.fn(),
  reorderStages: vi.fn(),
  deleteStage: vi.fn(),
  updateLead: vi.fn(),
  addLeadNote: vi.fn(),
};
vi.mock("@/lib/services/crm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/services/crm")>()), ...services }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const actions = await import("./actions");

const ids = { lead: "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f", stage: "7a1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f" };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireWorkspace.mockResolvedValue({ supabase: {}, user: { id: "u-1" }, role: "admin", organization: { id: "org-1", plan_id: "starter" } });
  rateLimit.mockResolvedValue(true);
  for (const fn of Object.values(services)) fn.mockResolvedValue(undefined);
});

describe("moveLeadAction", () => {
  it("valida com Zod antes de tocar no banco", async () => {
    expect(await actions.moveLeadAction({ leadId: "x", stageId: ids.stage, index: 0 })).toEqual({ error: expect.any(String) });
    expect(await actions.moveLeadAction({ leadId: ids.lead, stageId: ids.stage, index: -1 })).toEqual({ error: expect.any(String) });
    expect(services.moveLead).not.toHaveBeenCalled();
  });

  it("move com rate limit e atualiza a página", async () => {
    expect(await actions.moveLeadAction({ leadId: ids.lead, stageId: ids.stage, index: 2 })).toEqual({ success: expect.any(String) });
    expect(rateLimit).toHaveBeenCalledWith("crm:user:u-1", expect.anything());
    expect(services.moveLead).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", via: "manual" }), {
      leadId: ids.lead,
      stageId: ids.stage,
      index: 2,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/crm", "layout");
  });

  it("devolve a mensagem do service (o quadro desfaz o movimento) e esconde erro interno", async () => {
    services.moveLead.mockRejectedValueOnce(new ServiceError("Não encontramos este lead."));
    expect(await actions.moveLeadAction({ leadId: ids.lead, stageId: ids.stage, index: 0 })).toEqual({ error: "Não encontramos este lead." });
    services.moveLead.mockRejectedValueOnce(new Error("connection refused 10.0.0.5"));
    const result = await actions.moveLeadAction({ leadId: ids.lead, stageId: ids.stage, index: 0 });
    expect(result.error).not.toContain("10.0.0.5");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("aplica rate limit", async () => {
    rateLimit.mockResolvedValue(false);
    expect(await actions.moveLeadAction({ leadId: ids.lead, stageId: ids.stage, index: 0 })).toEqual({ error: "Muitas tentativas." });
  });
});

describe("createLeadAction", () => {
  it("mostra o erro do campo quando o formulário é inválido", async () => {
    expect(await actions.createLeadAction(undefined, form({ name: "", stageId: ids.stage }))).toEqual({
      error: "Informe o nome do lead.",
    });
    expect(services.createLead).not.toHaveBeenCalled();
  });

  it("cria na etapa da coluna", async () => {
    expect(await actions.createLeadAction(undefined, form({ name: "Maria", company: "", value: "1500", stageId: ids.stage }))).toEqual({
      success: expect.any(String),
    });
    expect(services.createLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: "Maria", value: 1500, stageId: ids.stage }));
  });

  it("repassa a mensagem do limite do plano", async () => {
    services.createLead.mockRejectedValueOnce(new ServiceError("Sua empresa atingiu o limite de 1.000 leads no CRM do plano Starter."));
    expect((await actions.createLeadAction(undefined, form({ name: "Maria" })))?.error).toContain("limite");
  });
});

describe("etapas e exclusão", () => {
  it("reordena só com lista de ids válida", async () => {
    expect(await actions.reorderStagesAction(["x"])).toEqual({ error: expect.any(String) });
    expect(await actions.reorderStagesAction([ids.stage, ids.lead])).toEqual({ success: expect.any(String) });
    expect(services.reorderStages).toHaveBeenCalledWith(expect.anything(), [ids.stage, ids.lead]);
  });

  it("cria, renomeia e exclui etapa repassando as regras do service", async () => {
    expect(await actions.createStageAction(undefined, form({ name: "Negociação", color: "#F59E0B" }))).toEqual({ success: expect.any(String) });
    expect(await actions.updateStageAction(undefined, form({ stageId: ids.stage, name: "Contato feito" }))).toEqual({
      success: expect.any(String),
    });
    services.deleteStage.mockRejectedValueOnce(new ServiceError("A etapa “Novo Lead” ainda tem 3 leads."));
    expect(await actions.deleteStageAction(undefined, form({ stageId: ids.stage }))).toEqual({ error: "A etapa “Novo Lead” ainda tem 3 leads." });
  });

  it("exclui lead pelo service (que exige owner/admin)", async () => {
    expect(await actions.deleteLeadAction(undefined, form({ leadId: ids.lead }))).toEqual({ success: expect.any(String) });
    expect(services.deleteLead).toHaveBeenCalledWith(expect.anything(), ids.lead);
    expect(await actions.deleteLeadAction(undefined, form({ leadId: "abc" }))).toEqual({ error: expect.any(String) });
  });
});

describe("ficha do lead", () => {
  it("edita dados com o schema parcial e exige ao menos um campo", async () => {
    services.updateLead.mockResolvedValue(undefined);
    expect(await actions.updateLeadAction(undefined, form({ leadId: ids.lead, name: "Maria Souza", email: "maria@x.com" }))).toEqual({
      success: expect.any(String),
    });
    expect(services.updateLead).toHaveBeenCalledWith(expect.anything(), ids.lead, expect.objectContaining({ name: "Maria Souza" }));
    expect(await actions.updateLeadAction(undefined, form({ leadId: ids.lead, email: "invalido" }))).toEqual({ error: "Informe um e-mail válido." });
  });

  it("adiciona anotação validada", async () => {
    services.addLeadNote.mockResolvedValue(undefined);
    expect(await actions.addLeadNoteAction(undefined, form({ leadId: ids.lead, content: "Pediu retorno amanhã" }))).toEqual({
      success: expect.any(String),
    });
    expect(services.addLeadNote).toHaveBeenCalledWith(expect.anything(), ids.lead, "Pediu retorno amanhã");
    expect(await actions.addLeadNoteAction(undefined, form({ leadId: ids.lead, content: "  " }))).toEqual({ error: "Escreva a anotação." });
  });

  it("excluir pela ficha volta para o quadro", async () => {
    await expect(actions.deleteLeadAction(undefined, form({ leadId: ids.lead, redirectTo: "board" }))).rejects.toThrow("REDIRECT:/crm");
  });
});
