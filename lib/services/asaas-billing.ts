import "server-only";
import { z } from "zod";
import { getPlan, type PlanId } from "@/config/plans";
import { createAsaasHttpClient, type AsaasClient } from "@/lib/integrations/asaas";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

export const asaasSubscribeSchema = z.strictObject({
  planId: z.enum(["starter", "growth", "scale"]),
  billingType: z.enum(["PIX", "BOLETO"]),
  customerName: z.string().trim().min(2, "Informe o nome completo ou razão social.").max(120),
  customerEmail: z.email("Informe um e-mail válido para envio da fatura."),
  cpfCnpj: z
    .string()
    .trim()
    .regex(/^[\d./-]+$/, "Informe um CPF ou CNPJ válido.")
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 11 || v.length === 14, "CPF deve ter 11 dígitos e CNPJ 14 dígitos."),
});

export const asaasWebhookPayloadSchema = z.object({
  id: z.string().min(1).max(200),
  event: z.string().min(1).max(100),
  payment: z
    .object({
      id: z.string().min(1).max(200),
      subscription: z.string().nullish(),
      status: z.string().optional(),
      billingType: z.enum(["PIX", "BOLETO", "CREDIT_CARD"]).catch("PIX"),
      value: z.coerce.number().min(0).default(0),
      dueDate: z.string().nullish(),
      externalReference: z.string().nullish(),
      invoiceUrl: z.string().nullish(),
      bankSlipUrl: z.string().nullish(),
    })
    .optional(),
  subscription: z
    .object({
      id: z.string().min(1).max(200),
      externalReference: z.string().nullish(),
    })
    .optional(),
});

export type BillingInvoiceRow = {
  id: string;
  organization_id: string;
  provider: string;
  external_payment_id: string;
  external_subscription_id: string | null;
  plan_id: string;
  billing_type: string;
  status: string;
  amount_cents: number;
  due_date: string | null;
  invoice_url: string | null;
  bank_slip_url: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  boleto_identification_field: string | null;
  paid_at: string | null;
  created_at: string;
};

export function parseExternalReference(ref: string | null | undefined): { organizationId: string; planId: PlanId } | null {
  if (!ref) return null;
  const [orgPart, planPart] = ref.split(":");
  const org = z.uuid().safeParse(orgPart);
  const plan = z.enum(["starter", "growth", "scale"]).safeParse(planPart);
  if (!org.success || !plan.success) return null;
  return { organizationId: org.data, planId: plan.data };
}

function nextDueDateIso(daysAhead = 3): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

export async function listOrganizationInvoices(ctx: ServiceContext): Promise<BillingInvoiceRow[]> {
  const { data, error } = await ctx.supabase
    .from("billing_invoices")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingInvoiceRow[];
}

export async function subscribeWithAsaas(
  ctx: ServiceContext,
  input: z.input<typeof asaasSubscribeSchema>,
  client?: AsaasClient,
) {
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para gerenciar a assinatura.");
  const admin = createAdminClient();
  const { data: membership, error: memError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (memError || !membership || !["owner", "admin"].includes(membership.role)) {
    throw new ServiceError("Apenas proprietários e administradores podem alterar a assinatura.");
  }

  const parsed = asaasSubscribeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira os dados de cobrança.");
  }
  const data = parsed.data;
  const plan = getPlan(data.planId);
  if (!plan) throw new ServiceError("Plano selecionado não encontrado.");

  const asaas = client ?? createAsaasHttpClient();

  const { data: currentSub } = await admin
    .from("subscriptions")
    .select("provider, provider_customer_id, provider_subscription_id, status")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();

  let customerId = currentSub?.provider === "asaas" ? currentSub.provider_customer_id : null;
  if (!customerId) {
    const customer = await asaas.createCustomer({
      name: data.customerName,
      email: data.customerEmail,
      cpfCnpj: data.cpfCnpj,
      externalReference: ctx.organizationId,
    });
    customerId = customer.id;
  }

  const externalReference = `${ctx.organizationId}:${plan.id}`;
  const description = `Assinatura Clinkup — Plano ${plan.name}`;
  const dueDate = nextDueDateIso(data.billingType === "PIX" ? 1 : 3);

  let subscriptionId = currentSub?.provider === "asaas" && currentSub.status !== "canceled" ? currentSub.provider_subscription_id : null;
  if (subscriptionId) {
    await asaas.updateSubscription(subscriptionId, {
      billingType: data.billingType,
      valueBRL: plan.priceMonthlyBRL,
      description,
      externalReference,
    });
  } else {
    const createdSub = await asaas.createSubscription({
      customerId,
      billingType: data.billingType,
      valueBRL: plan.priceMonthlyBRL,
      nextDueDate: dueDate,
      description,
      externalReference,
    });
    subscriptionId = createdSub.id;
  }

  const payments = await asaas.listSubscriptionPayments(subscriptionId);
  const latestPayment = payments[0];
  if (!latestPayment) {
    throw new ServiceError("A assinatura foi criada, mas a primeira fatura ainda está sendo gerada. Recarregue em instantes.");
  }

  let pixQrCode: string | null = null;
  let pixCopyPaste: string | null = null;
  let boletoField: string | null = null;

  if (data.billingType === "PIX") {
    const pix = await asaas.getPixQrCode(latestPayment.id);
    pixQrCode = pix.encodedImage;
    pixCopyPaste = pix.payload;
  } else {
    const boleto = await asaas.getBoletoIdentificationField(latestPayment.id);
    boletoField = boleto.identificationField;
  }

  // Assinatura só vira "active" após o webhook confirmar o pagamento; preserva acesso se já estava ativa.
  const nextSubStatus = currentSub?.status === "active" ? "active" : "incomplete";
  const { error: subError } = await admin.from("subscriptions").upsert(
    {
      organization_id: ctx.organizationId,
      plan_id: plan.id,
      status: nextSubStatus,
      provider: "asaas",
      provider_customer_id: customerId,
      provider_subscription_id: subscriptionId,
      cancel_at_period_end: false,
    },
    { onConflict: "organization_id" },
  );
  if (subError) throw new Error(subError.message);

  const { data: invoice, error: invError } = await admin
    .from("billing_invoices")
    .upsert(
      {
        organization_id: ctx.organizationId,
        provider: "asaas",
        external_payment_id: latestPayment.id,
        external_subscription_id: subscriptionId,
        plan_id: plan.id,
        billing_type: data.billingType,
        status: "pending",
        amount_cents: Math.round(latestPayment.value * 100),
        due_date: latestPayment.dueDate ?? dueDate,
        invoice_url: latestPayment.invoiceUrl ?? null,
        bank_slip_url: latestPayment.bankSlipUrl ?? null,
        pix_qr_code: pixQrCode,
        pix_copy_paste: pixCopyPaste,
        boleto_identification_field: boletoField,
      },
      { onConflict: "organization_id,provider,external_payment_id" },
    )
    .select("*")
    .single();
  if (invError || !invoice) throw new Error(invError?.message ?? "invoice upsert failed");

  return {
    subscriptionId,
    invoice: invoice as BillingInvoiceRow,
  };
}

export async function processAsaasWebhookEvent(rawPayload: unknown): Promise<{
  received: true;
  duplicate?: boolean;
  ignored?: boolean;
  status?: string;
}> {
  const parsed = asaasWebhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new ServiceError("Payload de webhook Asaas inválido.");
  }
  const event = parsed.data;
  const admin = createAdminClient();

  const ref = parseExternalReference(event.payment?.externalReference ?? event.subscription?.externalReference);
  const subId = event.payment?.subscription ?? event.subscription?.id ?? null;

  let organizationId = ref?.organizationId ?? null;
  let planId: PlanId | null = ref?.planId ?? null;

  if (!organizationId && subId) {
    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("organization_id, plan_id")
      .eq("provider", "asaas")
      .eq("provider_subscription_id", subId)
      .maybeSingle();
    if (existingSub) {
      organizationId = existingSub.organization_id;
      planId = existingSub.plan_id as PlanId;
    }
  }

  // Idempotência estrita por (provider, event_id): reenvios da Asaas nunca são processados duas vezes.
  const { error: dedupeError } = await admin.from("billing_webhook_events").insert({
    provider: "asaas",
    event_id: event.id,
    event_type: event.event,
    organization_id: organizationId,
  });
  if (dedupeError?.code === "23505") {
    return { received: true, duplicate: true };
  }
  if (dedupeError) throw new Error(dedupeError.message);

  if (!organizationId || !planId) {
    return { received: true, ignored: true };
  }

  const nextPeriodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
  let subStatus: "active" | "past_due" | "canceled" | null = null;
  let invoiceStatus: "pending" | "confirmed" | "overdue" | "canceled" | "refunded" | null = null;

  if (event.event === "PAYMENT_CONFIRMED" || event.event === "PAYMENT_RECEIVED") {
    subStatus = "active";
    invoiceStatus = "confirmed";
  } else if (event.event === "PAYMENT_OVERDUE") {
    subStatus = "past_due";
    invoiceStatus = "overdue";
  } else if (event.event === "PAYMENT_REFUNDED") {
    subStatus = "canceled";
    invoiceStatus = "refunded";
  } else if (event.event === "PAYMENT_DELETED" || event.event === "SUBSCRIPTION_DELETED") {
    subStatus = "canceled";
    invoiceStatus = "canceled";
  } else if (event.event === "PAYMENT_CREATED" || event.event === "PAYMENT_UPDATED") {
    invoiceStatus = "pending";
  }

  if (event.payment && invoiceStatus) {
    await admin.from("billing_invoices").upsert(
      {
        organization_id: organizationId,
        provider: "asaas",
        external_payment_id: event.payment.id,
        external_subscription_id: subId,
        plan_id: planId,
        billing_type: event.payment.billingType,
        status: invoiceStatus,
        amount_cents: Math.round(event.payment.value * 100),
        due_date: event.payment.dueDate ?? null,
        invoice_url: event.payment.invoiceUrl?.startsWith("https://") ? event.payment.invoiceUrl : null,
        bank_slip_url: event.payment.bankSlipUrl?.startsWith("https://") ? event.payment.bankSlipUrl : null,
        paid_at: invoiceStatus === "confirmed" ? new Date().toISOString() : null,
      },
      { onConflict: "organization_id,provider,external_payment_id" },
    );
  }

  if (subStatus) {
    const { error: updSubError } = await admin
      .from("subscriptions")
      .update({
        plan_id: planId,
        status: subStatus,
        provider: "asaas",
        ...(subStatus === "active" ? { current_period_end: nextPeriodEnd } : {}),
      })
      .eq("organization_id", organizationId);
    if (updSubError) throw new Error(updSubError.message);

    const effectivePlan = subStatus === "canceled" ? "starter" : planId;
    const { error: updOrgError } = await admin
      .from("organizations")
      .update({ plan_id: effectivePlan })
      .eq("id", organizationId);
    if (updOrgError) throw new Error(updOrgError.message);
  }

  return { received: true, status: subStatus ?? invoiceStatus ?? "ignored" };
}
