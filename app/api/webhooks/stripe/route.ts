import type Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { subscriptionUpdateFromStripe } from "@/lib/billing";
import { RATE_LIMITS, rateLimitByIp } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  // Limite generoso: o Stripe reenvia eventos recusados com backoff.
  if (!(await rateLimitByIp("stripe-webhook", RATE_LIMITS.stripeWebhookIp, request.headers))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let subscription: Stripe.Subscription | undefined;
  if (event.type === "checkout.session.completed" && event.data.object.mode === "subscription") {
    const id = event.data.object.subscription;
    if (id) subscription = await stripe.subscriptions.retrieve(typeof id === "string" ? id : id.id);
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    subscription = event.data.object;
  }
  if (!subscription) return NextResponse.json({ received: true });

  const update = subscriptionUpdateFromStripe(subscription);
  if (!update) return NextResponse.json({ received: true, ignored: true });

  const admin = createAdminClient();
  const { error } = await admin
    .from("subscriptions")
    .update(update.row)
    .eq("organization_id", update.organizationId);
  if (error) return NextResponse.json({ error: "subscription update failed" }, { status: 500 });

  // Plano efetivo: assinatura cancelada volta para Starter.
  const effectivePlan = update.row.status === "canceled" ? "starter" : update.planId;
  const { error: orgError } = await admin
    .from("organizations")
    .update({ plan_id: effectivePlan })
    .eq("id", update.organizationId);
  if (orgError) return NextResponse.json({ error: "organization update failed" }, { status: 500 });

  return NextResponse.json({ received: true });
}
