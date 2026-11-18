// Identidade da instância. Instalações White-Label trocam estes valores (ou as envs) sem tocar no código.
export const tenantBrand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "Clinkup Hermes",
  tagline: "O sistema operacional de crescimento com IA",
  description:
    "Marketing, vendas e automação em uma só plataforma, orquestrados pelo Agente Hermes.",
  logoUrl: process.env.NEXT_PUBLIC_BRAND_LOGO_URL ?? null,
  supportEmail: process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL ?? "contato@clinkup.com.br",
  colors: {
    background: "#050811",
    surface: "#0B1120",
    primary: process.env.NEXT_PUBLIC_BRAND_PRIMARY ?? "#00D4FF",
    secondary: process.env.NEXT_PUBLIC_BRAND_SECONDARY ?? "#2563EB",
  },
} as const;
