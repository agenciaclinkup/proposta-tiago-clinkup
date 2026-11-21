"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { stripePriceId } from "@/config/plans";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { asaasSubscribeSchema, subscribeWithAsaas, type BillingInvoiceRow } from "@/lib/services/asaas-billing";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { getStripe } from "@/lib/stripe";
import { requireWorkspace } from "@/lib/workspace";

const checkoutInput = z.object({ planId: z.enum(["starter", "growth", "scale"]) });

async function requireBillingAdmin() {
  const workspace = await requireWorkspace();
  if (workspace.role === "member") redirect("/billing?status=forbidden");
  if (!(await rateLimit(`billing:user:${workspace.user.id}`, RATE_LIMITS.billingUser))) {
    redirect("/billing?status=rate_limited");
  }
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  return { ...workspace, origin };
}

export async function startCheckout(formData: FormData) {
  const parsed = checkoutInput.safeParse({ planId: formData.get("planId") });
  const price = parsed.success ? stripePriceId(parsed.data.planId) : undefined;
  if (!parsed.success || !price) redirect("/billing?status=unavailable");
  const planId = parsed.data.planId;

  const { organization, subscription, user, origin } = await requireBillingAdmin();

  // Já assinante: troca de plano pelo portal, para não criar uma segunda assinatura.
  if (subscription?.provider === "stripe" && subscription.status !== "canceled" && subscription.provider_customer_id) {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: subscription.provider_customer_id,
      return_url: `${origin}/billing`,
    });
    redirect(portal.url);
  }

  const metadata = { organization_id: organization.id, plan_id: planId };

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: organization.id,
    ...(subscription?.provider === "stripe" && subscription.provider_customer_id
      ? { customer: subscription.provider_customer_id }
      : { customer_email: user.email }),
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
    success_url: `${origin}/billing?status=success`,
    cancel_url: `${origin}/billing?status=canceled`,
  });

  redirect(session.url!);
}

export async function openBillingPortal() {
  const { subscription, origin } = await requireBillingAdmin();
  if (!subscription?.provider_customer_id) redirect("/billing");

  const session = await getStripe().billingPortal.sessions.create({
    customer: subscription.provider_customer_id,
    return_url: `${origin}/billing`,
  });
  redirect(session.url);
}

export async function startAsaasSubscriptionAction(
  input: unknown,
): Promise<{ invoice: BillingInvoiceRow } | { error: string }> {
  const workspace = await requireWorkspace();
  if (workspace.role === "member") {
    return { error: "Apenas proprietários e administradores podem alterar a assinatura." };
  }
  if (!(await rateLimit(`billing:user:${workspace.user.id}`, RATE_LIMITS.billingUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }
  const parsed = asaasSubscribeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Confira os dados de cobrança." };
  }
  try {
    const result = await subscribeWithAsaas(serviceContext(workspace, "manual"), parsed.data);
    revalidatePath("/billing");
    return { invoice: result.invoice };
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Não foi possível gerar a cobrança via Asaas." };
  }
}
