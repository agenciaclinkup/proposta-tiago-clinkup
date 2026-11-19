import { z } from "zod";

export const publicSlugSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const organizationSlugSchema = z.string().regex(/^[a-z0-9-]{3,64}$/);
const plain = (max: number) => z.string().trim().max(max).transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));
export const captureSchema = z.strictObject({
  name: plain(200).refine((value) => value.length > 0, "Informe seu nome."),
  email: plain(320).refine((value) => !value || z.email().safeParse(value).success, "Informe um e-mail válido."),
  whatsapp: plain(40).refine((value) => !value || (/^[+\d()\s.-]+$/.test(value) && value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 15), "Informe um WhatsApp válido."),
  message: plain(5000).refine((value) => value.length > 0, "Escreva sua mensagem."), consent: z.literal(true), website: z.string().max(500),
}).refine((value) => Boolean(value.email || value.whatsapp), { message: "Informe seu e-mail ou WhatsApp." });
