import "server-only";
import { isIP } from "node:net";
import { z } from "zod";
import { ServiceError } from "@/lib/services/errors";
import { prospectSchema } from "./provider";

function validCnpj(value: string) {
  if (/^(\d)\1{13}$/.test(value)) return false;
  const check = (digits: string, weights: number[]) => { const remainder = [...digits].reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0) % 11; return remainder < 2 ? 0 : 11 - remainder; };
  return Number(value[12]) === check(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) && Number(value[13]) === check(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}
export const cnpjSchema = z.string().trim().regex(/^[\d./-]+$/).transform((value) => value.replace(/\D/g, "")).refine((value) => value.length === 14 && validCnpj(value), "Informe um CNPJ válido.");
const opt = z.string().trim().max(500).optional().default("");
export const b2bRecordSchema = z.strictObject({ cnpj: cnpjSchema, name: z.string().trim().min(1).max(200), category: opt, address: opt, city: opt, phone: opt, whatsapp: opt, email: opt, website: opt, instagram: opt });
export const b2bListSchema = z.strictObject({ authorized: z.literal(true), origin: z.string().trim().min(3).max(200), legalBasis: z.string().trim().min(3).max(500), records: z.array(b2bRecordSchema).min(1).max(100) });
export function normalizeB2b(input: z.output<typeof b2bRecordSchema>) {
  return prospectSchema.parse({ placeId: `cnpj:${input.cnpj}`, name: input.name, category: input.category || null, address: input.address || null, city: input.city || null, phone: input.phone || null, whatsapp: input.whatsapp || null, email: input.email || null, website: input.website || null, instagram: input.instagram || null });
}
const brasilSchema = z.object({ cnpj: cnpjSchema, razao_social: z.string().trim().min(1).max(200), nome_fantasia: z.string().nullish(), municipio: z.string().nullish(), cnae_fiscal_descricao: z.string().nullish(), ddd_telefone_1: z.string().nullish(), email: z.string().nullish(), logradouro: z.string().nullish(), numero: z.string().nullish() });
export async function lookupCnpj(raw: string, signal: AbortSignal) {
  const id = cnpjSchema.safeParse(raw);
  if (!id.success) throw new ServiceError("Informe um CNPJ válido.");
  let response: Response;
  try { response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${id.data}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), cache: "no-store", redirect: "error" }); }
  catch { throw new ServiceError("A consulta ao CNPJ não respondeu. Tente novamente."); }
  if (response.status === 429) throw new ServiceError("O limite da consulta de CNPJ foi atingido. Tente mais tarde.");
  if (!response.ok) throw new ServiceError(response.status === 404 ? "CNPJ não encontrado." : "A consulta de CNPJ está indisponível.");
  const parsed = brasilSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.cnpj !== id.data) throw new ServiceError("A consulta retornou dados inválidos.");
  const item = parsed.data;
  return normalizeB2b(b2bRecordSchema.parse({ cnpj: item.cnpj, name: item.nome_fantasia?.trim() || item.razao_social, city: item.municipio || "", category: item.cnae_fiscal_descricao || "", phone: item.ddd_telefone_1 || "", email: item.email || "", address: [item.logradouro, item.numero].filter(Boolean).join(", ") }));
}
export async function searchCommercialB2b(input: { niche: string; location: string; maxResults: number }, options: { url?: string; key?: string; signal: AbortSignal }) {
  if (!z.strictObject({ niche: z.string().trim().min(1).max(200), location: z.string().trim().min(1).max(200), maxResults: z.number().int().min(1).max(100) }).safeParse(input).success) throw new ServiceError("Confira o segmento, a região e a quantidade.");
  const url = options.url ?? process.env.B2B_PROSPECTING_API_URL; const key = options.key ?? process.env.B2B_PROSPECTING_API_KEY;
  if (!url || !key) throw new ServiceError("A busca B2B está indisponível. Configure o provedor no servidor.");
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { throw new ServiceError("O endereço do provedor B2B é inválido."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.port || parsedUrl.hostname === "localhost" || isIP(parsedUrl.hostname.replace(/^\[|\]$/g, "")) || parsedUrl.hostname.endsWith(".local") || parsedUrl.hostname.endsWith(".internal")) throw new ServiceError("O endereço do provedor B2B é inválido.");
  const casa = parsedUrl.hostname === "api.casadosdados.com.br" && parsedUrl.pathname === "/v5/cnpj/pesquisa";
  if (casa && !/^\d{7}$/.test(input.niche)) throw new ServiceError("Para a Casa dos Dados, informe o CNAE com sete dígitos.");
  let response: Response;
  try { response = await fetch(parsedUrl, { method: "POST", signal: AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]), redirect: "error", cache: "no-store", headers: casa ? { "Content-Type": "application/json", "api-key": key } : { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(casa ? { codigo_atividade_principal: [input.niche], municipio: [input.location], limite: input.maxResults, pagina: 1 } : input) }); }
  catch { throw new ServiceError("O provedor B2B não respondeu. Tente novamente."); }
  if (!response.ok) throw new ServiceError(response.status === 429 ? "O limite do provedor B2B foi atingido." : "O provedor B2B está indisponível.");
  const raw: unknown = await response.json().catch(() => null);
  if (casa) {
    const body = z.object({ cnpjs: z.array(z.object({ cnpj: cnpjSchema, razao_social: z.string().min(1).max(200), nome_fantasia: z.string().nullish(), endereco: z.object({ municipio: z.string().nullish(), logradouro: z.string().nullish(), numero: z.string().nullish() }).nullish() })).max(input.maxResults) }).safeParse(raw);
    if (!body.success) throw new ServiceError("O provedor B2B retornou dados inválidos.");
    return body.data.cnpjs.map((item) => normalizeB2b(b2bRecordSchema.parse({ cnpj: item.cnpj, name: item.nome_fantasia?.trim() || item.razao_social, city: item.endereco?.municipio || "", address: [item.endereco?.logradouro, item.endereco?.numero].filter(Boolean).join(", ") })));
  }
  const body = z.object({ records: z.array(b2bRecordSchema).max(input.maxResults) }).safeParse(raw);
  if (!body.success) throw new ServiceError("O provedor B2B retornou dados inválidos.");
  try { return body.data.records.map(normalizeB2b); } catch { throw new ServiceError("O provedor B2B retornou contatos inválidos."); }
}
