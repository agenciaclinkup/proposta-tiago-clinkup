import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const { searchProspects, sendProspectToCrm } = await import("./prospecting");
const id = "11111111-1111-4111-8111-111111111111";
const ctx = { organizationId: id, userId: id, planId: "starter", via: "hermes", channel: "telegram" } as ServiceContext;
const input = { requestId: id, niche: "Dentista", location: "Recife", radiusKm: 10, maxResults: 2 };
beforeEach(() => { vi.clearAllMocks(); });
describe("prospecção compartilhada", () => {
  it("não chama rede nem reserva cota sem provedor configurado", async () => {
    await expect(searchProspects(ctx, input)).rejects.toThrow("indisponível");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("não repete chamada ao provedor em solicitação idempotente", async () => {
    const search = vi.fn();
    rpc.mockResolvedValue({ data: { created: false, search: { status: "running" } }, error: null });
    await searchProspects(ctx, input, { search });
    expect(search).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("begin_lead_search", expect.objectContaining({ p_org: id, p_limit: 300 }));
  });
  it("rejeita respostas malformadas e devolve reserva em falha", async () => {
    rpc.mockResolvedValueOnce({ data: { created: true, search: { status: "running" } }, error: null }).mockResolvedValueOnce({ data: {}, error: null });
    await expect(searchProspects(ctx, input, { search: async () => [{ placeId: "x", name: "X", website: "javascript:alert(1)" }] })).rejects.toThrow();
    expect(rpc).toHaveBeenCalledWith("finish_lead_search", expect.objectContaining({ p_status: "failed", p_results: [] }));
  });
  it("aceita um adaptador simulado e registra apenas os dados validados", async () => {
    rpc.mockResolvedValueOnce({ data: { created: true, search: { status: "running" } }, error: null }).mockResolvedValueOnce({ data: { status: "succeeded", results_count: 1 }, error: null });
    const provider = { search: vi.fn().mockResolvedValue([{ placeId: "abc", name: "Clínica", website: "https://exemplo.com" }]) };
    const result = await searchProspects(ctx, input, provider);
    expect(result.search).toMatchObject({ status: "succeeded", results_count: 1 });
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith("finish_lead_search", expect.objectContaining({ p_status: "succeeded", p_results: [expect.objectContaining({ placeId: "abc", email: null, website: "https://exemplo.com" })] }));
  });
  it("envia ao CRM com limite do plano e contexto da empresa", async () => {
    rpc.mockResolvedValue({ data: { id }, error: null });
    await sendProspectToCrm(ctx, { prospectId: id });
    expect(rpc).toHaveBeenCalledWith("send_scraped_lead_to_crm", expect.objectContaining({ p_org: id, p_user: id, p_limit: 1000 }));
  });
});
