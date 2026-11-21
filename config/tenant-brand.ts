import { z } from "zod";

const safeUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "Informe uma URL HTTP ou HTTPS valida.");
const schema = z.object({
  NEXT_PUBLIC_BRAND_NAME: z.string().trim().min(1).max(80).optional(),
  NEXT_PUBLIC_BRAND_LOGO_URL: safeUrl.optional(),
  NEXT_PUBLIC_BRAND_FAVICON_URL: safeUrl.optional(),
  NEXT_PUBLIC_BRAND_SUPPORT_EMAIL: z.email().optional(),
  NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP: z.string().regex(/^\+?[1-9]\d{9,14}$/).optional(),
  NEXT_PUBLIC_BRAND_PRIMARY: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  NEXT_PUBLIC_BRAND_SECONDARY: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export function parseTenantBrand(env: Record<string, string | undefined>) {
  const values = schema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  return {
    name: values.NEXT_PUBLIC_BRAND_NAME ?? "Clinkup Hermes",
    tagline: "O sistema operacional de crescimento com IA",
    description: "Marketing, vendas e automação em uma só plataforma, orquestrados pelo Agente Hermes.",
    logoUrl: values.NEXT_PUBLIC_BRAND_LOGO_URL ?? null,
    faviconUrl: values.NEXT_PUBLIC_BRAND_FAVICON_URL ?? null,
    supportEmail: values.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL ?? "contato@clinkup.com.br",
    supportWhatsapp: values.NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP ?? null,
    colors: { background: "#050811", surface: "#0B1120", primary: values.NEXT_PUBLIC_BRAND_PRIMARY ?? "#00D4FF", secondary: values.NEXT_PUBLIC_BRAND_SECONDARY ?? "#2563EB" },
  };
}
export const tenantBrand = parseTenantBrand({
  NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
  NEXT_PUBLIC_BRAND_LOGO_URL: process.env.NEXT_PUBLIC_BRAND_LOGO_URL,
  NEXT_PUBLIC_BRAND_FAVICON_URL: process.env.NEXT_PUBLIC_BRAND_FAVICON_URL,
  NEXT_PUBLIC_BRAND_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL,
  NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP: process.env.NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP,
  NEXT_PUBLIC_BRAND_PRIMARY: process.env.NEXT_PUBLIC_BRAND_PRIMARY,
  NEXT_PUBLIC_BRAND_SECONDARY: process.env.NEXT_PUBLIC_BRAND_SECONDARY,
});
