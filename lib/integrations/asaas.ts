import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ServiceError } from "@/lib/services/errors";

const DEFAULT_TIMEOUT_MS = 15_000;

export type AsaasBillingType = "PIX" | "BOLETO";

export const asaasCustomerResponseSchema = z.object({
  id: z.string().min(1).max(200),
});

export const asaasSubscriptionResponseSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.string().default("ACTIVE"),
  nextDueDate: z.string().optional(),
});

export const asaasPaymentItemSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.string(),
  billingType: z.enum(["PIX", "BOLETO", "CREDIT_CARD"]).catch("PIX"),
  value: z.coerce.number().min(0),
  dueDate: z.string().optional(),
  invoiceUrl: z.string().url().optional().nullable(),
  bankSlipUrl: z.string().url().optional().nullable(),
});

export const asaasPixQrCodeSchema = z.object({
  encodedImage: z.string().min(1),
  payload: z.string().min(1),
  expirationDate: z.string().optional(),
});

export const asaasBoletoFieldSchema = z.object({
  identificationField: z.string().min(1),
  barCode: z.string().optional(),
});

export type AsaasPaymentItem = z.output<typeof asaasPaymentItemSchema>;
export type AsaasPixQrCode = z.output<typeof asaasPixQrCodeSchema>;
export type AsaasBoletoField = z.output<typeof asaasBoletoFieldSchema>;

export type AsaasClient = {
  createCustomer(input: { name: string; email: string; cpfCnpj: string; externalReference: string }): Promise<{ id: string }>;
  createSubscription(input: {
    customerId: string;
    billingType: AsaasBillingType;
    valueBRL: number;
    nextDueDate: string;
    description: string;
    externalReference: string;
  }): Promise<{ id: string; status: string; nextDueDate?: string }>;
  updateSubscription(
    subscriptionId: string,
    input: { billingType: AsaasBillingType; valueBRL: number; description: string; externalReference: string },
  ): Promise<{ id: string; status: string; nextDueDate?: string }>;
  listSubscriptionPayments(subscriptionId: string): Promise<AsaasPaymentItem[]>;
  getPixQrCode(paymentId: string): Promise<AsaasPixQrCode>;
  getBoletoIdentificationField(paymentId: string): Promise<AsaasBoletoField>;
};

export function asaasBaseUrl(env = process.env.ASAAS_ENV): string {
  return env?.toLowerCase() === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

export function verifyAsaasWebhookToken(
  received: string | null,
  expected: string | undefined = process.env.ASAAS_WEBHOOK_TOKEN,
): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type AsaasErrorBody = { errors?: { code?: string; description?: string }[] };

function mapAsaasError(status: number, body: AsaasErrorBody): ServiceError {
  if (status === 401 || status === 403) {
    return new ServiceError("A integração de cobrança Asaas não está autorizada. Verifique a chave de API no servidor.");
  }
  if (status === 429) {
    return new ServiceError("O provedor de pagamentos atingiu o limite de requisições. Tente novamente em instantes.");
  }
  const description = body.errors?.[0]?.description;
  if (status === 400 && description) {
    return new ServiceError(`Confira os dados de cobrança informados: ${description}`);
  }
  return new ServiceError("Não foi possível processar a cobrança na Asaas agora. Tente novamente em alguns instantes.");
}

async function asaasFetch<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT"; apiKey: string; baseUrl: string; body?: Record<string, unknown>; signal?: AbortSignal },
): Promise<T> {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${init.baseUrl}/${path.replace(/^\/+/, "")}`, {
      method: init.method,
      headers: {
        access_token: init.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    throw new ServiceError("O servidor de pagamentos Asaas não respondeu a tempo. Tente novamente.");
  }
  const parsed = (await response.json().catch(() => ({}))) as T & AsaasErrorBody;
  if (!response.ok) throw mapAsaasError(response.status, parsed);
  return parsed;
}

export function createAsaasHttpClient(options?: { apiKey?: string; env?: string }): AsaasClient {
  const apiKey = options?.apiKey ?? process.env.ASAAS_API_KEY;
  if (!apiKey) {
    throw new ServiceError("Pagamentos via Pix e Boleto (Asaas) ainda não estão configurados no servidor.");
  }
  const baseUrl = asaasBaseUrl(options?.env);

  return {
    async createCustomer(input) {
      const res = await asaasFetch<unknown>("customers", {
        method: "POST",
        apiKey,
        baseUrl,
        body: {
          name: input.name,
          email: input.email,
          cpfCnpj: input.cpfCnpj,
          externalReference: input.externalReference,
        },
      });
      return asaasCustomerResponseSchema.parse(res);
    },
    async createSubscription(input) {
      const res = await asaasFetch<unknown>("subscriptions", {
        method: "POST",
        apiKey,
        baseUrl,
        body: {
          customer: input.customerId,
          billingType: input.billingType,
          value: input.valueBRL,
          nextDueDate: input.nextDueDate,
          cycle: "MONTHLY",
          description: input.description,
          externalReference: input.externalReference,
        },
      });
      return asaasSubscriptionResponseSchema.parse(res);
    },
    async updateSubscription(subscriptionId, input) {
      const res = await asaasFetch<unknown>(`subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: "PUT",
        apiKey,
        baseUrl,
        body: {
          billingType: input.billingType,
          value: input.valueBRL,
          description: input.description,
          externalReference: input.externalReference,
          updatePendingPayments: true,
        },
      });
      return asaasSubscriptionResponseSchema.parse(res);
    },
    async listSubscriptionPayments(subscriptionId) {
      const res = await asaasFetch<{ data?: unknown[] }>(`subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=5`, {
        method: "GET",
        apiKey,
        baseUrl,
      });
      return z.array(asaasPaymentItemSchema).parse(res.data ?? []);
    },
    async getPixQrCode(paymentId) {
      const res = await asaasFetch<unknown>(`payments/${encodeURIComponent(paymentId)}/pixQrCode`, {
        method: "GET",
        apiKey,
        baseUrl,
      });
      return asaasPixQrCodeSchema.parse(res);
    },
    async getBoletoIdentificationField(paymentId) {
      const res = await asaasFetch<unknown>(`payments/${encodeURIComponent(paymentId)}/identificationField`, {
        method: "GET",
        apiKey,
        baseUrl,
      });
      return asaasBoletoFieldSchema.parse(res);
    },
  };
}

// Modo simulado seguro para testes automatizados sem chamadas externas reais à API Asaas.
export function createSimulatedAsaasClient(): AsaasClient {
  let seq = 1;
  const paymentsBySub = new Map<string, AsaasPaymentItem[]>();

  return {
    async createCustomer() {
      return { id: `cus_sim_${seq++}` };
    },
    async createSubscription(input) {
      const subId = `sub_sim_${seq++}`;
      const payId = `pay_sim_${seq++}`;
      paymentsBySub.set(subId, [
        {
          id: payId,
          status: "PENDING",
          billingType: input.billingType,
          value: input.valueBRL,
          dueDate: input.nextDueDate,
          invoiceUrl: `https://sandbox.asaas.com/i/${payId}`,
          bankSlipUrl: input.billingType === "BOLETO" ? `https://sandbox.asaas.com/b/pdf/${payId}` : null,
        },
      ]);
      return { id: subId, status: "ACTIVE", nextDueDate: input.nextDueDate };
    },
    async updateSubscription(subscriptionId, input) {
      const payId = `pay_sim_${seq++}`;
      paymentsBySub.set(subscriptionId, [
        {
          id: payId,
          status: "PENDING",
          billingType: input.billingType,
          value: input.valueBRL,
          dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
          invoiceUrl: `https://sandbox.asaas.com/i/${payId}`,
          bankSlipUrl: input.billingType === "BOLETO" ? `https://sandbox.asaas.com/b/pdf/${payId}` : null,
        },
      ]);
      return { id: subscriptionId, status: "ACTIVE" };
    },
    async listSubscriptionPayments(subscriptionId) {
      return paymentsBySub.get(subscriptionId) ?? [];
    },
    async getPixQrCode(paymentId) {
      return {
        encodedImage: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        payload: `00020126580014BR.GOV.BCB.PIX0136sim-${paymentId}5204000053039865802BR`,
      };
    },
    async getBoletoIdentificationField() {
      return {
        identificationField: "23793.38128 60000.000003 00000.000400 1 84340000019700",
        barCode: "23791843400000197003381260000000000000000400",
      };
    },
  };
}
