import { afterEach, describe, expect, it, vi } from "vitest";
import { b2bListSchema, cnpjSchema, lookupCnpj, searchCommercialB2b } from "./b2b";
afterEach(() => vi.unstubAllGlobals());
describe("fontes B2B", () => {
  it("valida CNPJ e declaração de origem", () => {
    expect(cnpjSchema.safeParse("11.222.333/0001-81").success).toBe(true);
    expect(cnpjSchema.safeParse("11.222.333/0001-82").success).toBe(false);
    expect(b2bListSchema.safeParse({ authorized: false, origin: "Cliente", legalBasis: "Contrato", records: [] }).success).toBe(false);
    expect(b2bListSchema.safeParse({ authorized: true, origin: "Cliente", legalBasis: "Contrato", records: [{ cnpj: "ChIJGooglePlaceId", name: "Empresa" }] }).success).toBe(false);
  });
  it("consulta BrasilAPI sem gravar dados societários e normaliza CNPJ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cnpj: "11222333000181", razao_social: "Empresa Exemplo", municipio: "RECIFE", qsa: [{ cpf: "privado" }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const item = await lookupCnpj("11.222.333/0001-81", new AbortController().signal);
    expect(item).toMatchObject({ placeId: "cnpj:11222333000181", name: "Empresa Exemplo", city: "RECIFE" });
    expect(JSON.stringify(item)).not.toContain("privado");
    expect(fetchMock.mock.calls[0][0]).toBe("https://brasilapi.com.br/api/cnpj/v1/11222333000181");
  });
  it("não chama provedor comercial sem configuração", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(searchCommercialB2b({ niche: "4711302", location: "Recife", maxResults: 10 }, { url: "", key: "", signal: new AbortController().signal })).rejects.toThrow("indisponível");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("usa o contrato oficial da Casa dos Dados para CNAE e município", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cnpjs: [{ cnpj: "11222333000181", razao_social: "Empresa Exemplo", endereco: { municipio: "Recife" } }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const result = await searchCommercialB2b({ niche: "4711302", location: "Recife", maxResults: 10 }, { url: "https://api.casadosdados.com.br/v5/cnpj/pesquisa", key: "segredo", signal: new AbortController().signal });
    expect(result).toEqual([expect.objectContaining({ placeId: "cnpj:11222333000181", city: "Recife" })]);
    expect(fetchMock.mock.calls[0][1].headers["api-key"]).toBe("segredo");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ codigo_atividade_principal: ["4711302"], municipio: ["Recife"], limite: 10 });
  });
});
