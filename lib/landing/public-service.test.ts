import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.fn();
const orgLookup = vi.fn();
const pageLookup = vi.fn();
const brandLookup = vi.fn();
const filters: Array<[string, string, unknown]> = [];
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: (table: string) => { const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query; }, maybeSingle: table === "organizations" ? orgLookup : table === "brand_context" ? brandLookup : pageLookup }; return query; } }) }));
const { getPublicLanding, capturePublicLead } = await import("./public-service");
const valid = { name: "Ana", email: "ana@example.com", whatsapp: "", message: "Olá", consent: true, website: "" };
beforeEach(() => { vi.clearAllMocks(); filters.length = 0; brandLookup.mockResolvedValue({ data: null, error: null }); });
describe("página pública", () => {
  it("restringe a busca à empresa e publicação e devolve somente dados públicos", async () => {
    orgLookup.mockResolvedValue({ data: { id: "org-id", name: "Empresa" }, error: null });
    pageLookup.mockResolvedValue({ data: { organization_id: "org-id", stage_id: "secret-stage", title: "Página", sections: [{ type: "hero", heading: "Olá", body: "Texto", imagePath: "org-id/foto.png" }] }, error: null });
    const page = await getPublicLanding("empresa", "pagina");
    expect(filters).toEqual(expect.arrayContaining([["organizations", "slug", "empresa"], ["landing_pages", "organization_id", "org-id"], ["landing_pages", "published", true]]));
    expect(JSON.stringify(page)).not.toContain("secret-stage");
    expect(JSON.stringify(page)).not.toContain("org-id");
  });
  it("retorna ausente para página não publicada", async () => {
    orgLookup.mockResolvedValue({ data: { id: "org-id", name: "Empresa" }, error: null });
    pageLookup.mockResolvedValue({ data: null, error: null });
    expect(await getPublicLanding("empresa", "rascunho")).toBeNull();
  });
  it("honeypot não grava e dados inválidos não chegam ao banco", async () => {
    expect(await capturePublicLead("empresa", "pagina", { ...valid, website: "spam" })).toBe(true);
    expect(await capturePublicLead("empresa", "pagina", { ...valid, consent: false })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("repassa somente os limites oficiais e devolve falha genérica quando excedido", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await capturePublicLead("empresa", "pagina", valid)).toBe(false);
    expect(rpc).toHaveBeenCalledWith("capture_landing_lead", expect.objectContaining({ p_org_slug: "empresa", p_slug: "pagina", p_limits: { starter: 1000, growth: 10000, scale: 100000 } }));
  });
});
