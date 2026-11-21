import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ServiceError } from "@/lib/services/errors";

const rateLimitByIp = vi.fn();
const verifyAsaasWebhookToken = vi.fn();
const processAsaasWebhookEvent = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  rateLimitByIp,
  RATE_LIMITS: { asaasWebhookIp: { limit: 300, windowSeconds: 60 } },
}));
vi.mock("@/lib/integrations/asaas", () => ({ verifyAsaasWebhookToken }));
vi.mock("@/lib/services/asaas-billing", () => ({ processAsaasWebhookEvent }));

const { POST } = await import("./route");

function makeRequest(body: string, token?: string) {
  return new NextRequest("http://localhost:3000/api/webhooks/asaas", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "asaas-access-token": token } : {}),
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitByIp.mockResolvedValue(true);
  verifyAsaasWebhookToken.mockReturnValue(true);
});

describe("POST /api/webhooks/asaas", () => {
  it("retorna 429 quando excede rate limit por IP", async () => {
    rateLimitByIp.mockResolvedValueOnce(false);
    const res = await POST(makeRequest("{}", "tok"));
    expect(res.status).toBe(429);
    expect(processAsaasWebhookEvent).not.toHaveBeenCalled();
  });

  it("retorna 401 quando asaas-access-token é inválido ou ausente", async () => {
    verifyAsaasWebhookToken.mockReturnValueOnce(false);
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(401);
    expect(processAsaasWebhookEvent).not.toHaveBeenCalled();
  });

  it("retorna 400 para JSON ou payload inválido e 200 para evento válido ou duplicado", async () => {
    expect((await POST(makeRequest("{invalido", "tok"))).status).toBe(400);

    processAsaasWebhookEvent.mockRejectedValueOnce(new ServiceError("Payload de webhook Asaas inválido."));
    expect((await POST(makeRequest(JSON.stringify({}), "tok"))).status).toBe(400);

    processAsaasWebhookEvent.mockResolvedValueOnce({ received: true, status: "active" });
    const ok = await POST(makeRequest(JSON.stringify({ id: "evt_1", event: "PAYMENT_CONFIRMED" }), "tok"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true, status: "active" });
  });
});
