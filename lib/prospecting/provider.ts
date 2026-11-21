import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const website = optionalText(500).refine((value) => {
  if (!value) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "Informe um endereço de site válido.");
export const prospectSchema = z.strictObject({
  placeId: z.string().trim().min(1).max(500), name: z.string().trim().min(1).max(200),
  category: optionalText(200), address: optionalText(500), city: optionalText(200), phone: optionalText(40),
  whatsapp: optionalText(40), email: z.union([z.email().max(320), z.literal(""), z.null()]).optional().transform((value) => value || null),
  website, instagram: optionalText(100), rating: z.number().min(0).max(5).nullable().optional().transform((value) => value ?? null),
});
export type Prospect = z.output<typeof prospectSchema>;
export type ProspectProvider = { search: (input: { niche: string; location: string; radiusKm: number; maxResults: number }, options: { signal: AbortSignal }) => Promise<unknown> };
