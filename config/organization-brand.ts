import { z } from "zod";
const url = z.url().max(2048).refine((value) => {
  const parsed = new URL(value);
  return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
}, "Informe um endereco HTTP ou HTTPS valido.");
const optionalUrl = z.union([z.literal(""), url, z.null()]).transform((value) => value || null);
export const organizationBrandSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  logoUrl: optionalUrl,
  faviconUrl: optionalUrl,
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  supportEmail: z.email().max(254),
  supportWhatsapp: z.string().regex(/^\+?[1-9]\d{9,14}$/),
  hideClinkup: z.boolean(),
});
export function canManageOrganizationBrand(input: { role: string; planId: string; isWhiteLabel: boolean; isSuperAdmin?: boolean }) {
  return input.isSuperAdmin === true || ((input.role === "owner" || input.role === "admin") && (input.planId === "scale" || input.isWhiteLabel));
}
