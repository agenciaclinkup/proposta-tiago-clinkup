import { describe, expect, it } from "vitest";
import { HERMES_TOOLS } from "./tools";
import { CHANNEL_LABELS, toolLabel } from "./tool-labels";
import { vi } from "vitest";

vi.mock("@/lib/services/hermes-log", () => ({ recordHermesLog: vi.fn() }));
vi.mock("@/lib/services/account", () => ({ getPlanAndUsage: vi.fn() }));
vi.mock("@/lib/services/activity", () => ({ listRecentActivity: vi.fn() }));

describe("toolLabel", () => {
  it("tem rótulo em português para toda Tool registrada", () => {
    for (const tool of HERMES_TOOLS) {
      const label = toolLabel(tool.name);
      expect(label.done, tool.name).not.toBe(toolLabel("__desconhecida__").done);
      expect(label.running).toMatch(/…$/);
    }
  });

  it("usa rótulo genérico para Tool desconhecida", () => {
    expect(toolLabel("nova_tool")).toEqual({ running: "Executando uma ação…", done: "Ação executada" });
  });

  it("traduz os canais", () => {
    expect(CHANNEL_LABELS.telegram).toBe("Telegram");
    expect(CHANNEL_LABELS.web).toBe("Painel");
  });
});
