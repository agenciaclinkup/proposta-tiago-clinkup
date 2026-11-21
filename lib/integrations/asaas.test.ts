import { afterEach, describe, expect, it, vi } from "vitest";
import { asaasBaseUrl, createAsaasHttpClient, createSimulatedAsaasClient, verifyAsaasWebhookToken } from "./asaas";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("cliente Asaas", () => {
  it("seleciona ambiente sandbox por padrão e production quando configurado", () => {
    expect(asaasBaseUrl(undefined)).toBe("https://api-sandbox.asaas.com/v3");
    expect(asaasBaseUrl("sandbox")).toBe("https://api-sandbox.asaas.com/v3");
    expect(asaasBaseUrl("production")).toBe("https://api.asaas.com/v3");
  });

  it("verifica token do webhook em tempo constante", () => {
    expect(verifyAsaasWebhookToken("segredo-123", "segredo-123")).toBe(true);
    expect(verifyAsaasWebhookToken("segredo-errado", "segredo-123")).toBe(false);
    expect(verifyAsaasWebhookToken(null, "segredo-123")).toBe(false);
    expect(verifyAsaasWebhookToken("segredo-123", undefined)).toBe(false);
  });

  it("traduz erros HTTP 401, 400, 429 e timeout em pt-BR", async () => {
    const client = createAsaasHttpClient({ apiKey: "key_test", env: "sandbox" });

    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 401 }));
    await expect(client.createCustomer({ name: "Ana", email: "a@b.com", cpfCnpj: "12345678901", externalReference: "org" })).rejects.toThrow(
      "não está autorizada",
    );

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ description: "CPF/CNPJ inválido" }] }), { status: 400 }),
    );
    await expect(client.createCustomer({ name: "Ana", email: "a@b.com", cpfCnpj: "12345678901", externalReference: "org" })).rejects.toThrow(
      "CPF/CNPJ inválido",
    );

    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 429 }));
    await expect(client.listSubscriptionPayments("sub_1")).rejects.toThrow("limite de requisições");

    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("timeout"));
    await expect(client.getPixQrCode("pay_1")).rejects.toThrow("não respondeu a tempo");
  });

  it("simula fluxo completo Pix e Boleto sem chamadas externas", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sim = createSimulatedAsaasClient();
    const customer = await sim.createCustomer({ name: "Clínica", email: "c@c.com", cpfCnpj: "11222333000181", externalReference: "org-1" });
    const sub = await sim.createSubscription({
      customerId: customer.id,
      billingType: "PIX",
      valueBRL: 497,
      nextDueDate: "2026-11-24",
      description: "Plano Growth",
      externalReference: "org-1:growth",
    });
    const payments = await sim.listSubscriptionPayments(sub.id);
    expect(payments).toHaveLength(1);
    const pix = await sim.getPixQrCode(payments[0]!.id);
    expect(pix.payload).toContain("BR.GOV.BCB.PIX");
    const boleto = await sim.getBoletoIdentificationField(payments[0]!.id);
    expect(boleto.identificationField).toContain("23793");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
