import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteMetaUserData = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ deleteMetaUserData }));
const rateLimitByIp = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIp, RATE_LIMITS: { metaWebhookIp: {} } }));

const { POST: deauthorize } = await import("./deauthorize/route");
const { POST: dataDeletion } = await import("./data-deletion/route");

const signed = (payload: object, secret = "app-secret") => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${createHmac("sha256", secret).update(encoded).digest("base64url")}.${encoded}`;
};
const post = (handler: (r: NextRequest) => Promise<Response>, signedRequest: string) =>
  handler(
    new NextRequest("https://app.clinkup.com.br/api/webhooks/meta/x", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ signed_request: signedRequest }).toString(),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("META_APP_SECRET", "app-secret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.clinkup.com.br");
  rateLimitByIp.mockResolvedValue(true);
  deleteMetaUserData.mockResolvedValue(2);
});
afterEach(() => vi.unstubAllEnvs());

describe("callbacks de conformidade da Meta", () => {
  it("recusam signed_request com assinatura inválida", async () => {
    expect((await post(deauthorize, signed({ algorithm: "HMAC-SHA256", user_id: "m" }, "outro"))).status).toBe(400);
    expect((await post(dataDeletion, "lixo")).status).toBe(400);
    expect(deleteMetaUserData).not.toHaveBeenCalled();
  });

  it("desautorização remove as integrações daquele usuário Meta", async () => {
    expect((await post(deauthorize, signed({ algorithm: "HMAC-SHA256", user_id: "meta-42" }))).status).toBe(200);
    expect(deleteMetaUserData).toHaveBeenCalledWith("meta-42");
  });

  it("exclusão de dados remove e responde com url de status e confirmation_code", async () => {
    const res = await post(dataDeletion, signed({ algorithm: "HMAC-SHA256", user_id: "meta-42" }));
    const body = await res.json();
    expect(deleteMetaUserData).toHaveBeenCalledWith("meta-42");
    expect(body.confirmation_code).toMatch(/^[A-Z0-9]{12}$/);
    expect(body.url).toBe(`https://app.clinkup.com.br/meta/exclusao-de-dados?codigo=${body.confirmation_code}`);
  });

  it("aplicam rate limit por IP", async () => {
    rateLimitByIp.mockResolvedValue(false);
    expect((await post(dataDeletion, signed({ algorithm: "HMAC-SHA256", user_id: "m" }))).status).toBe(429);
  });
});
