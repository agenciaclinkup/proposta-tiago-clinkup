import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

const base = { organizationName: "Clinkup", userName: "Ana", now: new Date("2026-11-18T15:00:00Z") };

describe("buildSystemPrompt", () => {
  it("define o Hermes em português, acolhedor e com o Contexto Mestre como dados", () => {
    const prompt = buildSystemPrompt({ ...base, masterContext: "Empresa: Clinkup\nNicho: Marketing" });
    expect(prompt).toContain("Hermes");
    expect(prompt).toContain("português do Brasil");
    expect(prompt).toContain("<contexto_mestre>\nEmpresa: Clinkup\nNicho: Marketing\n</contexto_mestre>");
    expect(prompt).toContain("Ana");
    expect(prompt).toContain("18/11/2026");
  });

  it("orienta concluir o onboarding quando não há memória da marca", () => {
    const prompt = buildSystemPrompt({ ...base, masterContext: null });
    expect(prompt).not.toContain("<contexto_mestre>");
    expect(prompt).toContain("onboarding");
  });

  it("deixa a data por último (prefixo estável para cache)", () => {
    const a = buildSystemPrompt({ ...base, masterContext: "x" });
    const b = buildSystemPrompt({ ...base, masterContext: "x", now: new Date("2026-11-19T15:00:00Z") });
    const common = [...a].findIndex((char, i) => char !== b[i]);
    expect(a.slice(common)).toMatch(/^\d/);
    expect(a.lastIndexOf("Data de hoje")).toBeGreaterThan(a.indexOf("</contexto_mestre>"));
  });
});
