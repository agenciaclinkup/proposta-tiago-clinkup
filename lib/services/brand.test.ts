import { describe, expect, it } from "vitest";
import { onboardingSchema } from "@/lib/onboarding";
import { brandRowFromInput } from "./brand";

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
