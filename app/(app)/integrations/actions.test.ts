import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const requireWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { integrationsUser: {} }, RATE_LIMIT_MESSAGE: "Muitas tentativas." }));
const disconnectIntegration = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ disconnectIntegration }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { disconnectIntegrationAction } = await import("./actions");

const id = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
const form = (value: string) => {
  const data = new FormData();
  data.set("integrationId", value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspace.mockResolvedValue({ supabase: {}, user: { id: "u-1" }, organization: { id: "org-1", plan_id: "starter" } });
  rateLimit.mockResolvedValue(true);
  disconnectIntegration.mockResolvedValue(undefined);
});

describe("disconnectIntegrationAction", () => {
  it("valida o id com Zod antes de tocar no banco", async () => {
    expect(await disconnectIntegrationAction(undefined, form("x"))).toEqual({ error: expect.any(String) });
    expect(disconnectIntegration).not.toHaveBeenCalled();
  });

  it("aplica rate limit por usuário", async () => {
    rateLimit.mockResolvedValue(false);
    expect(await disconnectIntegrationAction(undefined, form(id))).toEqual({ error: "Muitas tentativas." });
    expect(rateLimit).toHaveBeenCalledWith("integrations:user:u-1", expect.anything());
  });

  it("desconecta pelo service (RLS de admin) e atualiza a página", async () => {
    expect(await disconnectIntegrationAction(undefined, form(id))).toEqual({ success: expect.any(String) });
    expect(disconnectIntegration).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }), id);
    expect(revalidatePath).toHaveBeenCalledWith("/integrations");
  });

  it("explica quando o usuário não é admin ou a integração não existe", async () => {
    disconnectIntegration.mockRejectedValue(new ServiceError("Apenas administradores podem desconectar."));
    expect(await disconnectIntegrationAction(undefined, form(id))).toEqual({ error: "Apenas administradores podem desconectar." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
