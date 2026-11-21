import { afterEach, describe, expect, it, vi } from "vitest";
import { searchGooglePlaceIds } from "./google-place-ids";
afterEach(() => vi.unstubAllGlobals());
describe("consulta de identificadores Places", () => {
  it("não chama rede sem credencial", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(searchGooglePlaceIds({ niche: "Dentista", location: "Recife", maxResults: 5 }, { apiKey: "", signal: new AbortController().signal })).rejects.toThrow("indisponível");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("solicita somente IDs, pagina sem exceder a quantidade e elimina duplicados", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ places: [{ id: "a" }, { id: "b" }], nextPageToken: "next" }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ places: [{ id: "b" }, { id: "c" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchGooglePlaceIds({ niche: "Dentista", location: "Recife", maxResults: 3 }, { apiKey: "chave", signal: new AbortController().signal })).toEqual(["a", "b", "c"]);
    expect(fetchMock.mock.calls[0][1].headers["X-Goog-FieldMask"]).toBe("places.id,nextPageToken");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).pageToken).toBe("next");
  });
  it("traduz limite do provedor sem expor resposta ou credencial", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("segredo", { status: 429 })));
    await expect(searchGooglePlaceIds({ niche: "Dentista", location: "Recife", maxResults: 1 }, { apiKey: "chave", signal: new AbortController().signal })).rejects.toThrow("limite");
  });
});
