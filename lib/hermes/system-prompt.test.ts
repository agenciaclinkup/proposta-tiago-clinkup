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

describe("Estúdio no prompt do Hermes", () => {
  it("orienta gerar, exportar como rascunho e agendar só com confirmação", () => {
    const prompt = buildSystemPrompt({ ...base, masterContext: null });
    expect(prompt).toContain("generate_carousel");
    expect(prompt).toContain("export_carousel_to_calendar");
    expect(prompt).toMatch(/rascunho/);
    expect(prompt).not.toMatch(/Carrosséis no estúdio[^.]*em breve/);
  });
});

describe("Prospecção B2B no prompt do Hermes", () => {
  it("exige origem/base legal e confirmação persistente antes de enviar ao CRM", () => {
    const prompt = buildSystemPrompt({ ...base, masterContext: null });
    expect(prompt).toContain("lookup_cnpj_prospects");
    expect(prompt).toContain("search_commercial_prospects");
    expect(prompt).toContain("propose_send_prospects_to_crm");
    expect(prompt).toContain("confirm_prospect_transfer");
    expect(prompt).toContain("base legal");
    expect(prompt).toContain("Google Places não é usado");
    expect(prompt).not.toMatch(/Extração de leads[^.]*em breve/);
  });
});
