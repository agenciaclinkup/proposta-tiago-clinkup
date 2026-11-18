import { z } from "zod";

const text = (min: number, max: number, message: string) =>
  z.string().trim().min(min, message).max(max, `Use no máximo ${max} caracteres.`);

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Informe uma cor no formato #RRGGBB.");

export const onboardingSchema = z.object({
  companyName: text(2, 120, "Informe o nome da empresa."),
  niche: text(2, 120, "Informe o nicho de atuação."),
  productsServices: text(10, 2000, "Descreva seus produtos ou serviços com pelo menos 10 caracteres."),
  averageTicket: z.coerce.number().min(0, "O ticket médio não pode ser negativo.").max(10_000_000).optional(),
  targetAudience: text(10, 2000, "Descreva seu público-alvo com pelo menos 10 caracteres."),
  differentiators: text(10, 2000, "Descreva seus diferenciais com pelo menos 10 caracteres."),
  toneOfVoice: text(2, 500, "Escolha ou descreva o tom de voz da marca."),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  logoUrl: z.union([z.literal(""), z.url("Informe um link válido para o logo.")]).optional(),
  styleNotes: z.string().trim().max(1000).optional(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

// Texto consolidado injetado no prompt de todos os agentes (carrosséis, legendas, prospecção, anúncios).
export function buildMasterContext(input: OnboardingInput): string {
  const ticket =
    input.averageTicket !== undefined
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(input.averageTicket)
      : "não informado";

  return [
    `Empresa: ${input.companyName}`,
    `Nicho: ${input.niche}`,
    `Produtos e serviços: ${input.productsServices}`,
    `Ticket médio: ${ticket}`,
    `Público-alvo: ${input.targetAudience}`,
    `Diferenciais: ${input.differentiators}`,
    `Tom de voz: ${input.toneOfVoice}`,
    `Identidade visual: cor primária ${input.primaryColor}, cor secundária ${input.secondaryColor}` +
      (input.styleNotes ? `. ${input.styleNotes}` : ""),
  ].join("\n");
}

export function slugify(name: string, suffix: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${base || "empresa"}-${suffix}`;
}
