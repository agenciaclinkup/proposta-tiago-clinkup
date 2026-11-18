import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapStripeStatus, subscriptionUpdateFromStripe } from "./billing";

afterEach(() => vi.unstubAllEnvs());

const subscription = (overrides: Partial<Stripe.Subscription> = {}) =>
  ({
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    cancel_at_period_end: false,
    trial_end: null,
    metadata: { organization_id: "org_1" },
    items: { data: [{ price: { id: "price_growth" }, current_period_end: 1_800_000_000 }] },
    ...overrides,
  }) as unknown as Stripe.Subscription;

describe("mapStripeStatus", () => {
  it.each([
    ["active", "active"],
    ["unpaid", "past_due"],
    ["paused", "past_due"],
    ["incomplete_expired", "canceled"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(mapStripeStatus(input)).toBe(expected);
  });
});

describe("subscriptionUpdateFromStripe", () => {
  it("monta a linha da assinatura", () => {
    vi.stubEnv("STRIPE_PRICE_GROWTH", "price_growth");
    const update = subscriptionUpdateFromStripe(subscription());
    expect(update?.organizationId).toBe("org_1");
    expect(update?.row).toMatchObject({
      plan_id: "growth",
      status: "active",
      provider_customer_id: "cus_1",
      current_period_end: new Date(1_800_000_000_000).toISOString(),
    });
  });

  it("ignora assinatura sem organização ou com price desconhecido", () => {
    vi.stubEnv("STRIPE_PRICE_GROWTH", "price_growth");
    expect(subscriptionUpdateFromStripe(subscription({ metadata: {} }))).toBeNull();
    vi.stubEnv("STRIPE_PRICE_GROWTH", "outro");
    expect(subscriptionUpdateFromStripe(subscription())).toBeNull();
  });
});
