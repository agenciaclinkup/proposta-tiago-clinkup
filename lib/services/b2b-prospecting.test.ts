import { beforeEach, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";
const rpc = vi.fn(); const search = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("./prospecting", () => ({ searchProspects: search }));
const { runB2bProspecting } = await import("./b2b-prospecting");
const id = "11111111-1111-4111-8111-111111111111";
const ctx = { organizationId: id, userId: id, planId: "starter", via: "manual" } as ServiceContext;
const input = { requestId: id, type: "import" as const, authorized: true as const, origin: "Base própria", legalBasis: "Contrato", records: [{ cnpj: "11222333000181", name: "Empresa" }] };
beforeEach(() => { vi.clearAllMocks(); });
it("exige declaração antes de reservar ou consultar", async () => {
  await expect(runB2bProspecting(ctx, { ...input, authorized: false } as never)).rejects.toThrow("declare");
  expect(search).not.toHaveBeenCalled();
});
it("registra origem e associa hash à solicitação antes de processar a lista", async () => {
  rpc.mockResolvedValue({ data: true, error: null });
  search.mockImplementation(async (_ctx, _input, provider, options) => { await options.verifyRequest(); return { created: true, search: await provider.search({}, { signal: new AbortController().signal }) }; });
  const result = await runB2bProspecting(ctx, input);
  expect(rpc).toHaveBeenCalledWith("record_prospect_source", expect.objectContaining({ p_org: id, p_user: id, p_type: "import", p_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
  expect(result.search).toEqual([expect.objectContaining({ placeId: "cnpj:11222333000181" })]);
});
