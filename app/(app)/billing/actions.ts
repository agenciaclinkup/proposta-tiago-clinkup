"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPlan, stripePriceId } from "@/config/plans";
import { getStripe } from "@/lib/stripe";
import { requireWorkspace } from "@/lib/workspace";

async function requireBillingAdmin() {
  const workspace = await requireWorkspace();
  const { data: membership } = await workspace.supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization.id)
    .eq("user_id", workspace.user.id)
    .single();
  if (membership?.role !== "owner" && membership?.role !== "admin") redirect("/billing?status=forbidden");
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  return { ...workspace, origin };
}

export async function startCheckout(formData: FormData) {
  const plan = getPlan(String(formData.get("planId")));
  const price = plan && stripePriceId(plan.id);
  if (!plan || !price) redirect("/billing?status=unavailable");

  const { organization, subscription, user, origin } = await requireBillingAdmin();

  // Já assinante: troca de plano pelo portal, para não criar uma segunda assinatura.
  if (subscription?.provider === "stripe" && subscription.status !== "canceled" && subscription.provider_customer_id) {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: subscription.provider_customer_id,
      return_url: `${origin}/billing`,
    });
    redirect(portal.url);
  }

  const metadata = { organization_id: organization.id, plan_id: plan.id };

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
