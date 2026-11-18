import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";

const insert = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));

const { recordHermesLog } = await import("./hermes-log");

const ctx = { organizationId: "org-1", userId: "user-1", via: "hermes", channel: "telegram" } as ServiceContext;

beforeEach(() => insert.mockReset());

describe("recordHermesLog", () => {
  it("grava a ação com org, usuário, canal e origem do contexto", async () => {
    insert.mockResolvedValueOnce({ error: null });
    await recordHermesLog(ctx, { toolName: "create_post", input: { a: 1 }, output: { id: "p1" }, status: "success", durationMs: 40 });
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      user_id: "user-1",
      channel: "telegram",
      via: "hermes",
      tool_name: "create_post",
      input: { a: 1 },
      output: { id: "p1" },
      status: "success",
      error: null,
      duration_ms: 40,
    });
  });

  it("não derruba a ação se a auditoria falhar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    insert.mockResolvedValueOnce({ error: { message: "down" } });
    await expect(
      recordHermesLog(ctx, { toolName: "x", input: {}, status: "error", error: "boom", durationMs: 1 }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
