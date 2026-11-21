import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const assertSuperAdminActor = vi.fn();
const rateLimit = vi.fn();
const revalidatePath = vi.fn();
const adminUpdateTenantSubscription = vi.fn();
const adminAdjustTenantAiCredits = vi.fn();

vi.mock("@/lib/super-admin", () => ({ assertSuperAdminActor }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  RATE_LIMIT_MESSAGE: "Muitas tentativas.",
  RATE_LIMITS: { superAdminWrite: { limit: 30, windowSeconds: 600 } },
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/services/super-admin", async (original) => ({
  ...(await original<typeof import("@/lib/services/super-admin")>()),
  adminUpdateTenantSubscription,
  adminAdjustTenantAiCredits,
}));

const { adminUpdateSubscriptionAction, adminAdjustCreditsAction } = await import("./actions");

const orgId = "11111111-1111-4111-8111-111111111111";
const actor = { id: "admin-1", email: "admin@clinkup.com", fullName: "Admin" };

beforeEach(() => {
  vi.clearAllMocks();
  assertSuperAdminActor.mockResolvedValue(actor);
  rateLimit.mockResolvedValue(true);
});

describe("Server Actions Super-Admin", () => {
  it("bloqueia usuário comum sem executar mutações", async () => {
    assertSuperAdminActor.mockRejectedValueOnce(new ServiceError("Acesso restrito à equipe Super-Admin da plataforma."));
    const res = await adminUpdateSubscriptionAction({
      organizationId: orgId,
      planId: "scale",
      status: "active",
      isWhiteLabel: true,
      reason: "Teste",
    });
    expect(res).toEqual({ error: "Acesso restrito à equipe Super-Admin da plataforma." });
    expect(adminUpdateTenantSubscription).not.toHaveBeenCalled();
  });

  it("aplica rate limit e valida Zod antes de ajustar assinatura", async () => {
    rateLimit.mockResolvedValueOnce(false);
    expect(
      await adminUpdateSubscriptionAction({ organizationId: orgId, planId: "growth", status: "active", isWhiteLabel: false, reason: "Suporte" }),
    ).toEqual({ error: "Muitas tentativas." });

    expect(
      await adminUpdateSubscriptionAction({ organizationId: "invalido", planId: "growth", status: "active", isWhiteLabel: false, reason: "Suporte" }),
    ).toHaveProperty("error");

    adminUpdateTenantSubscription.mockResolvedValueOnce({ organizationId: orgId });
    expect(
      await adminUpdateSubscriptionAction({ organizationId: orgId, planId: "growth", status: "active", isWhiteLabel: true, reason: "Cortesia anual" }),
    ).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("concede bônus de créditos de IA e revalida /admin", async () => {
    adminAdjustTenantAiCredits.mockResolvedValueOnce({ used: 5, bonus: 300 });
    expect(await adminAdjustCreditsAction({ organizationId: orgId, delta: 300, reason: "Compensação suporte" })).toEqual({
      used: 5,
      bonus: 300,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });
});
