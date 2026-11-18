import { describe, expect, it, vi } from "vitest";
import { onboardingSchema } from "@/lib/onboarding";
import { brandRowFromInput, inputFromBrandRow, mergeBrandPatch } from "./brand";
import { ServiceError } from "./errors";

const input = onboardingSchema.parse({
  companyName: "Clinkup",
  niche: "Marketing digital",
  productsServices: "Gestão de tráfego e automação",
  targetAudience: "Clínicas e pequenas empresas",
  differentiators: "Operação orientada por IA",
  toneOfVoice: "Profissional e próximo",
  primaryColor: "#00D4FF",
  secondaryColor: "#2563EB",
  logoUrl: "",
});

describe("brandRowFromInput", () => {
  it("mapeia o formulário para a linha de brand_context com Contexto Mestre", () => {
    const row = brandRowFromInput("org-1", input);
    expect(row).toMatchObject({
      organization_id: "org-1",
      company_name: "Clinkup",
      average_ticket: null,
      visual_identity: { primary_color: "#00D4FF", secondary_color: "#2563EB", logo_url: null, style_notes: null },
    });
    expect(row.master_context).toContain("Empresa: Clinkup");
  });
});

describe("inputFromBrandRow", () => {
  it("reconstrói o formulário a partir da linha salva", () => {
    expect(inputFromBrandRow(brandRowFromInput("org-1", input))).toEqual(input);
  });
});

describe("mergeBrandPatch", () => {
  const row = brandRowFromInput("org-1", input);

  it("aplica alteração parcial e regenera o Contexto Mestre", () => {
    const merged = mergeBrandPatch(row, { toneOfVoice: "Descontraído e bem-humorado" });
    expect(merged.toneOfVoice).toBe("Descontraído e bem-humorado");
    expect(merged.companyName).toBe("Clinkup");
  });

  it("rejeita alteração inválida com mensagem para o usuário", () => {
    expect(() => mergeBrandPatch(row, { primaryColor: "azul" })).toThrow(ServiceError);
  });
});

describe("saveBrandContext com papel", () => {
  it("member não altera a memória da marca, mesmo sem RLS (ex.: Telegram)", async () => {
    const { saveBrandContext } = await import("./brand");
    const upsert = vi.fn();
    const ctx = { supabase: { from: () => ({ upsert }) }, organizationId: "org-1", role: "member" } as never;
    await expect(saveBrandContext(ctx, input)).rejects.toBeInstanceOf(ServiceError);
    expect(upsert).not.toHaveBeenCalled();
  });
});
