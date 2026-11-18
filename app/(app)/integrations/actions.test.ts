import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const requireWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { integrationsUser: {}, telegramCodeUser: {} }, RATE_LIMIT_MESSAGE: "Muitas tentativas." }));
const disconnectIntegration = vi.fn();
const createTelegramLinkCode = vi.fn();
const unlinkOwnTelegram = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ disconnectIntegration, createTelegramLinkCode, unlinkOwnTelegram }));
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

describe("generateTelegramCodeAction", () => {
  it("gera o código para o próprio usuário com rate limit", async () => {
    const { generateTelegramCodeAction } = await import("./actions");
    createTelegramLinkCode.mockResolvedValue({ code: "ABCD2345", expiresAt: "2026-11-18T20:10:00.000Z" });
    expect(await generateTelegramCodeAction()).toEqual({ code: "ABCD2345", expiresAt: "2026-11-18T20:10:00.000Z" });
    expect(rateLimit).toHaveBeenCalledWith("telegram-code:user:u-1", expect.anything());
    expect(createTelegramLinkCode).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", userId: "u-1" }));
  });

  it("bloqueia excesso de códigos", async () => {
    const { generateTelegramCodeAction } = await import("./actions");
    rateLimit.mockResolvedValue(false);
    expect(await generateTelegramCodeAction()).toEqual({ error: "Muitas tentativas." });
    expect(createTelegramLinkCode).not.toHaveBeenCalled();
  });
});

describe("unlinkTelegramAction", () => {
  it("valida o id com Zod", async () => {
    const { unlinkTelegramAction } = await import("./actions");
    expect(await unlinkTelegramAction(undefined, form("x"))).toEqual({ error: expect.any(String) });
    expect(unlinkOwnTelegram).not.toHaveBeenCalled();
  });

  it("qualquer papel desvincula o próprio Telegram, com rate limit, e a página atualiza", async () => {
    const { unlinkTelegramAction } = await import("./actions");
    requireWorkspace.mockResolvedValue({ supabase: {}, user: { id: "u-2" }, role: "member", organization: { id: "org-1", plan_id: "starter" } });
    expect(await unlinkTelegramAction(undefined, form(id))).toEqual({ success: expect.any(String) });
    expect(rateLimit).toHaveBeenCalledWith("integrations:user:u-2", expect.anything());
    expect(unlinkOwnTelegram).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", userId: "u-2" }), id);
    expect(revalidatePath).toHaveBeenCalledWith("/integrations");
  });

  it("mostra a mensagem quando o vínculo não é do usuário", async () => {
    const { unlinkTelegramAction } = await import("./actions");
    unlinkOwnTelegram.mockRejectedValue(new ServiceError("Este Telegram não está vinculado à sua conta."));
    expect(await unlinkTelegramAction(undefined, form(id))).toEqual({ error: "Este Telegram não está vinculado à sua conta." });
  });
});
