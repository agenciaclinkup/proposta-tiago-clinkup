import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSimulatedAsaasClient } from "@/lib/integrations/asaas";
import type { ServiceContext } from "./context";

const memberMaybeSingle = vi.fn();
const subMaybeSingle = vi.fn();
const subUpsert = vi.fn();
const subUpdateEq = vi.fn();
const orgUpdateEq = vi.fn();
const invUpsertSingle = vi.fn();
const invUpsert = vi.fn();
const webhookInsert = vi.fn();

const from = vi.fn((table: string) => {
  if (table === "organization_members") {
    return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: memberMaybeSingle }) }) }) };
  }
  if (table === "subscriptions") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: subMaybeSingle, eq: () => ({ maybeSingle: subMaybeSingle }) }) }),
      upsert: subUpsert,
      update: () => ({ eq: subUpdateEq }),
    };
  }
  if (table === "organizations") {
    return { update: () => ({ eq: orgUpdateEq }) };
  }
  if (table === "billing_invoices") {
    return {
      upsert: (...args: unknown[]) => {
        invUpsert(...args);
        return { select: () => ({ single: invUpsertSingle }) };
      },
    };
  }
  if (table === "billing_webhook_events") {
    return { insert: webhookInsert };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

const { subscribeWithAsaas, processAsaasWebhookEvent } = await import("./asaas-billing");

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const ctx = { organizationId: orgId, userId, planId: "starter", via: "manual", channel: "web" } as ServiceContext;

beforeEach(() => {
  vi.clearAllMocks();
  memberMaybeSingle.mockResolvedValue({ data: { role: "owner" }, error: null });
  subMaybeSingle.mockResolvedValue({ data: { provider: "manual", status: "trialing" }, error: null });
  subUpsert.mockResolvedValue({ error: null });
  subUpdateEq.mockResolvedValue({ error: null });
  orgUpdateEq.mockResolvedValue({ error: null });
  webhookInsert.mockResolvedValue({ error: null });
  invUpsertSingle.mockResolvedValue({
    data: {
      id: "inv-1",
      billing_type: "PIX",
      status: "pending",
      pix_copy_paste: "000201...",
      boleto_identification_field: null,
    },
    error: null,
  });
});

describe("subscribeWithAsaas", () => {
  it("bloqueia membro comum de alterar a assinatura", async () => {
    memberMaybeSingle.mockResolvedValueOnce({ data: { role: "member" }, error: null });
    await expect(
      subscribeWithAsaas(
        ctx,
        { planId: "growth", billingType: "PIX", customerName: "Clínica", customerEmail: "a@b.com", cpfCnpj: "11222333000181" },
        createSimulatedAsaasClient(),
      ),
    ).rejects.toThrow("proprietários e administradores");
  });

  it("cria assinatura recorrente via Pix usando preço de config/plans.ts e gera QR Code sem ativar antes do pagamento", async () => {
    const result = await subscribeWithAsaas(
      ctx,
      { planId: "growth", billingType: "PIX", customerName: "Clínica Alfa", customerEmail: "fin@alfa.com", cpfCnpj: "11.222.333/0001-81" },
      createSimulatedAsaasClient(),
    );
    expect(result.subscriptionId).toMatch(/^sub_sim_/);
    expect(subUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: orgId, plan_id: "growth", provider: "asaas", status: "incomplete" }),
      { onConflict: "organization_id" },
    );
    expect(invUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: orgId,
        plan_id: "growth",
        billing_type: "PIX",
        amount_cents: 49700,
        pix_copy_paste: expect.stringContaining("BR.GOV.BCB.PIX"),
      }),
      expect.anything(),
    );
  });

  it("gera linha digitável ao assinar via Boleto", async () => {
    await subscribeWithAsaas(
      ctx,
      { planId: "scale", billingType: "BOLETO", customerName: "Agência", customerEmail: "fin@ag.com", cpfCnpj: "11222333000181" },
      createSimulatedAsaasClient(),
    );
    expect(invUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: "scale",
        billing_type: "BOLETO",
        amount_cents: 129700,
        boleto_identification_field: expect.stringContaining("23793"),
      }),
      expect.anything(),
    );
  });
});

describe("processAsaasWebhookEvent", () => {
  const baseEvent = {
    id: "evt_001",
    event: "PAYMENT_CONFIRMED",
    payment: {
      id: "pay_001",
      subscription: "sub_001",
      billingType: "PIX",
      value: 497,
      dueDate: "2026-11-24",
      externalReference: `${orgId}:growth`,
      invoiceUrl: "https://sandbox.asaas.com/i/pay_001",
    },
  };

  it("ativa plano e organização ao confirmar pagamento e ignora reenvios idempotentes por event_id", async () => {
    const first = await processAsaasWebhookEvent(baseEvent);
    expect(first).toEqual({ received: true, status: "active" });
    expect(subUpdateEq).toHaveBeenCalled();
    expect(orgUpdateEq).toHaveBeenCalled();

    // Replay do mesmo event_id: conflito 23505 em billing_webhook_events
    webhookInsert.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });
    vi.clearAllMocks();
    const replay = await processAsaasWebhookEvent(baseEvent);
    expect(replay).toEqual({ received: true, duplicate: true });
    expect(subUpdateEq).not.toHaveBeenCalled();
    expect(orgUpdateEq).not.toHaveBeenCalled();
  });

  it("marca inadimplente em PAYMENT_OVERDUE e rebaixa para starter em cancelamento", async () => {
    const overdue = await processAsaasWebhookEvent({ ...baseEvent, id: "evt_002", event: "PAYMENT_OVERDUE" });
    expect(overdue).toEqual({ received: true, status: "past_due" });

    const canceled = await processAsaasWebhookEvent({ ...baseEvent, id: "evt_003", event: "SUBSCRIPTION_DELETED" });
    expect(canceled).toEqual({ received: true, status: "canceled" });
  });
});
