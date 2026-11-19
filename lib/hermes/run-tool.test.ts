import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";

const recordHermesLog = vi.fn();
vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog }));

const { defineTool, runTool } = await import("./run-tool");

const ctx = { organizationId: "org-1", userId: "u-1", via: "hermes", channel: "web" } as ServiceContext;
const echo = defineTool({
  name: "echo",
  description: "Repete a mensagem.",
  input: z.object({ message: z.string().min(1) }),
  execute: async (_ctx, input) => ({ echoed: input.message }),
});

beforeEach(() => {
  recordHermesLog.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runTool", () => {
  it("executa, retorna os dados e registra sucesso", async () => {
    const result = await runTool(ctx, echo, { message: "oi" });
    expect(result).toEqual({ ok: true, data: { echoed: "oi" } });
    expect(recordHermesLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ toolName: "echo", status: "success", input: { message: "oi" }, output: { echoed: "oi" } }),
    );
  });

  it("rejeita input inválido sem executar e registra o erro", async () => {
    const execute = vi.fn();
    const result = await runTool(ctx, { ...echo, execute }, { message: "" });
    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(recordHermesLog).toHaveBeenCalledWith(ctx, expect.objectContaining({ status: "error", error: expect.stringContaining("invalid_input") }));
  });

  it("devolve a mensagem do ServiceError ao usuário", async () => {
    const failing = { ...echo, execute: async () => { throw new ServiceError("Apenas administradores podem fazer isso."); } };
    expect(await runTool(ctx, failing, { message: "x" })).toEqual({ ok: false, error: "Apenas administradores podem fazer isso." });
  });

  it("esconde erro interno do usuário mas registra o detalhe", async () => {
    const failing = { ...echo, execute: async () => { throw new Error("connection refused 10.0.0.5"); } };
    const result = await runTool(ctx, failing, { message: "x" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toContain("10.0.0.5");
    expect(recordHermesLog).toHaveBeenCalledWith(ctx, expect.objectContaining({ status: "error", error: "connection refused 10.0.0.5" }));
  });
});

describe("runTool e códigos de confirmação", () => {
  it("não grava o comando de confirmação no log de atividades", async () => {
    const proposal = defineTool({ name: "export_carousel_to_calendar", description: "x", input: z.object({}), execute: async () => ({ postId: "post", instruction: "Para agendar este post, responda exatamente: CONFIRMAR abc" }) });
    const result = await runTool(ctx, proposal, {});
    expect(result).toMatchObject({ ok: true, data: { instruction: expect.stringContaining("CONFIRMAR") } });
    const logged = recordHermesLog.mock.calls[0]?.[1].output;
    expect(logged).toMatchObject({ postId: "post", requiresConfirmation: true });
    expect(JSON.stringify(logged)).not.toContain("CONFIRMAR");
  });
});
