import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublishedStatus, publishFacebook, publishGoogle, publishInstagram } from "./social-publish";
import { RejectedPublication, UnconfirmedPublication } from "@/lib/services/social-publish-queue";

afterEach(() => vi.unstubAllGlobals());
describe("publicação em provedores", () => {
  it("envia texto e hashtags para a Página usando cabeçalho de autorização", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "post-1" }) });
    vi.stubGlobal("fetch", request);
    await expect(publishFacebook({ accountId: "123", token: "segredo", caption: "Olá #marca", media: [], format: "feed" })).resolves.toBe("post-1");
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/123/feed"), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer segredo" }) }));
    expect(request.mock.calls[0][0]).not.toContain("segredo");
  });
  it("usa o caminho completo da conta e localização do Google", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "accounts/a/locations/b/localPosts/c", state: "LIVE" }) });
    vi.stubGlobal("fetch", request);
    await expect(publishGoogle({ accountId: "accounts/a/locations/b", token: "token", caption: "Olá", media: [], format: "gmb_update" })).resolves.toContain("localPosts");
    expect(request.mock.calls[0][0]).toBe("https://mybusiness.googleapis.com/v4/accounts/a/locations/b/localPosts");
  });
  it("não confirma publicação Google ainda em processamento", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "accounts/a/locations/b/localPosts/c", state: "PROCESSING" }) }));
    await expect(publishGoogle({ accountId: "accounts/a/locations/b", token: "token", caption: "Oi", media: [], format: "gmb_update" })).rejects.toBeInstanceOf(UnconfirmedPublication);
  });
  it("preserva a referência do Reel do Facebook enquanto a Meta processa", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ video_id: "1234" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", request);
    await expect(publishFacebook({ accountId: "123", token: "token", caption: "Oi", media: [{ url: "https://example.com/video", type: "video" }], format: "reels" })).rejects.toMatchObject({ externalId: "1234" });
    expect(request.mock.calls[1][0]).toContain("rupload.facebook.com");
  });
  it("publica no Instagram somente depois do contêiner ficar pronto", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: "1234" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "4321" }) });
    vi.stubGlobal("fetch", request);
    await expect(publishInstagram({ accountId: "123", token: "token", caption: "Oi", media: [{ url: "https://example.com/image", type: "image" }], format: "feed" })).resolves.toBe("4321");
    expect(request.mock.calls[2][0]).toContain("/123/media_publish");
  });
  it("distingue rejeição do provedor de resposta inconclusiva", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(publishFacebook({ accountId: "123", token: "token", caption: "Oi", media: [], format: "feed" })).rejects.toBeInstanceOf(RejectedPublication);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(publishFacebook({ accountId: "123", token: "token", caption: "Oi", media: [], format: "feed" })).rejects.not.toBeInstanceOf(RejectedPublication);
  });
  it("consulta sem reenviar e confirma apenas o estado publicado", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: "PROCESSING" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ state: "LIVE" }) });
    vi.stubGlobal("fetch", request);
    const id = "accounts/a/locations/b/localPosts/c";
    expect(await checkPublishedStatus("google_business", id, "token")).toBe("pending");
    expect(await checkPublishedStatus("google_business", id, "token")).toBe("published");
    expect(request.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });
});
