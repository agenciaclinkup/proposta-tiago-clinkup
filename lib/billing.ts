import type Stripe from "stripe";
import { planIdFromStripePrice, type PlanId } from "@/config/plans";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete";

export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      // Status novo da API Stripe: não libera acesso até ser mapeado.
      return "incomplete";
  }
}

export type SubscriptionUpdate = {
  organizationId: string;
  planId: PlanId;
  row: {
    plan_id: PlanId;
    status: SubscriptionStatus;
    provider: "stripe";
    provider_customer_id: string;
    provider_subscription_id: string;
    current_period_end: string | null;
    trial_ends_at: string | null;
    cancel_at_period_end: boolean;
  };
};

// Converte a assinatura Stripe na linha de `subscriptions`. Null quando falta org ou o price não é de um plano conhecido.
export function subscriptionUpdateFromStripe(subscription: Stripe.Subscription): SubscriptionUpdate | null {
  const organizationId = subscription.metadata.organization_id;
  const item = subscription.items.data[0];
  const planId = item ? planIdFromStripePrice(item.price.id) : undefined;
  if (!organizationId || !planId) return null;

  const toIso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);

  return {
    organizationId,
    planId,
    row: {
      plan_id: planId,
      status: mapStripeStatus(subscription.status),
      provider: "stripe",
      provider_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      provider_subscription_id: subscription.id,
      current_period_end: toIso(item.current_period_end),
      trial_ends_at: toIso(subscription.trial_end),
      cancel_at_period_end: subscription.cancel_at_period_end,
    },
  };
}
