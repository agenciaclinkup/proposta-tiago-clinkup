import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlan, planIdFromStripePrice } from "./plans";

afterEach(() => vi.unstubAllEnvs());

describe("plans", () => {
  it("encontra plano por id", () => {
    expect(getPlan("growth")?.name).toBe("Growth");
    expect(getPlan("enterprise")).toBeUndefined();
  });

  it("mapeia price do Stripe para o plano", () => {
    vi.stubEnv("STRIPE_PRICE_SCALE", "price_scale_123");
    expect(planIdFromStripePrice("price_scale_123")).toBe("scale");
    expect(planIdFromStripePrice("price_desconhecido")).toBeUndefined();
  });
});
