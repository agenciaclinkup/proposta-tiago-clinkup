import { describe, expect, it } from "vitest";
import { buildMasterContext, onboardingSchema, slugify } from "./onboarding";

const valid = {
  companyName: "Clinkup",
  niche: "Marketing digital",
  productsServices: "Gestão de tráfego e automação",
  averageTicket: "1500",
  targetAudience: "Clínicas e pequenas empresas locais",
  differentiators: "Operação orientada por IA",
  toneOfVoice: "Profissional e próximo",
  primaryColor: "#00D4FF",
  secondaryColor: "#2563EB",
  logoUrl: "",
};

describe("onboardingSchema", () => {
  it("aceita dados válidos e converte o ticket", () => {
    const parsed = onboardingSchema.parse(valid);
    expect(parsed.averageTicket).toBe(1500);
  });

  it("rejeita cor inválida e descrição curta", () => {
    const result = onboardingSchema.safeParse({ ...valid, primaryColor: "azul", productsServices: "x" });
    expect(result.success).toBe(false);
    const fields = result.error?.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["primaryColor", "productsServices"]));
  });

  it("rejeita logo com link inválido", () => {
    expect(onboardingSchema.safeParse({ ...valid, logoUrl: "logo" }).success).toBe(false);
  });
});

describe("buildMasterContext", () => {
  it("inclui todos os campos da marca", () => {
    const context = buildMasterContext(onboardingSchema.parse(valid));
    expect(context).toContain("Empresa: Clinkup");
    expect(context).toContain("Tom de voz: Profissional e próximo");
    expect(context).toMatch(/Ticket médio: R\$\s?1\.500,00/);
  });

  it("marca ticket ausente como não informado", () => {
    const context = buildMasterContext(onboardingSchema.parse({ ...valid, averageTicket: undefined }));
    expect(context).toContain("Ticket médio: não informado");
  });
});

describe("slugify", () => {
  it("remove acentos e símbolos", () => {
    expect(slugify("Ação & Cia Ltda.", "a1b2")).toBe("acao-cia-ltda-a1b2");
  });

  it("usa fallback para nome sem letras", () => {
    expect(slugify("!!!", "a1b2")).toBe("empresa-a1b2");
  });
});
