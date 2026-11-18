import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const { consumeUsage, currentPeriodStart, limitFor, PlanLimitError } = await import("./usage");

const ctx = { organizationId: "org-1", planId: "starter" } as ServiceContext;

beforeEach(() => rpc.mockReset());

describe("limitFor", () => {
  it("lê o limite mensal do plano", () => {
    expect(limitFor("starter", "ai_credits")).toBe(500);
    expect(limitFor("growth", "scraped_leads")).toBe(2000);
    expect(limitFor("scale", "scheduled_posts")).toBe(1000);
  });
});

describe("currentPeriodStart", () => {
  it("usa o mês no fuso de Brasília", () => {
    // 01/12 às 01:00 UTC ainda é 30/11 em São Paulo (UTC-3).
    expect(currentPeriodStart(new Date("2026-12-01T01:00:00Z"))).toBe("2026-11-01");
    expect(currentPeriodStart(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12-01");
  });
});

describe("consumeUsage", () => {
  it("consome dentro do limite do plano", async () => {
    rpc.mockResolvedValueOnce({ data: { allowed: true, used: 3 }, error: null });
    await expect(consumeUsage(ctx, "ai_credits", 3)).resolves.toEqual({ used: 3, limit: 500 });
    expect(rpc).toHaveBeenCalledWith("consume_usage", {
      p_organization_id: "org-1",
      p_metric: "ai_credits",
      p_amount: 3,
      p_limit: 500,
    });
  });

  it("lança PlanLimitError com mensagem para o usuário quando estoura", async () => {
    rpc.mockResolvedValueOnce({ data: { allowed: false, used: 500 }, error: null });
    const error = await consumeUsage(ctx, "ai_credits").catch((e) => e);
    expect(error).toBeInstanceOf(PlanLimitError);
    expect(error.message).toContain("créditos de IA");
    expect(error.message).toContain("Starter");
  });

  it("propaga erro do banco (não libera consumo sem registro)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(consumeUsage(ctx, "ai_credits")).rejects.toThrow("down");
  });
});

describe("PlanLimitError", () => {
  it("é um ServiceError (mensagem segura para o usuário)", async () => {
    const { ServiceError } = await import("./errors");
    expect(new PlanLimitError("ai_credits", 1, 1, "Starter")).toBeInstanceOf(ServiceError);
  });
});
