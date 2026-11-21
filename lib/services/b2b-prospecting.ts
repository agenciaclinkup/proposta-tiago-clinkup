import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { b2bRecordSchema, cnpjSchema, lookupCnpj, normalizeB2b, searchCommercialB2b } from "@/lib/prospecting/b2b";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { searchProspects } from "./prospecting";

const declaration = { requestId: z.uuid(), authorized: z.literal(true), origin: z.string().trim().min(3).max(200), legalBasis: z.string().trim().min(3).max(500) };
export const b2bRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...declaration, type: z.literal("import"), records: z.array(b2bRecordSchema).min(1).max(100) }),
  z.strictObject({ ...declaration, type: z.literal("brasilapi"), cnpjs: z.array(cnpjSchema).min(1).max(5) }),
  z.strictObject({ ...declaration, type: z.literal("commercial"), niche: z.string().trim().min(1).max(200), location: z.string().trim().min(1).max(200), maxResults: z.number().int().min(1).max(100) }),
]);
export async function runB2bProspecting(ctx: ServiceContext, input: z.input<typeof b2bRequestSchema>) {
  const parsed = b2bRequestSchema.safeParse(input);
  if (!parsed.success || !ctx.userId) throw new ServiceError("Confira os dados e declare a origem autorizada e a base legal.");
  const data = parsed.data;
  let imported: ReturnType<typeof normalizeB2b>[] = [];
  try { if (data.type === "import") imported = data.records.map(normalizeB2b); }
  catch { throw new ServiceError("Confira os CNPJs e contatos da lista; use endereços de site HTTP ou HTTPS válidos."); }
  if (data.type === "commercial" && (!process.env.B2B_PROSPECTING_API_URL || !process.env.B2B_PROSPECTING_API_KEY)) throw new ServiceError("A busca B2B está indisponível. Configure o provedor no servidor.");
  const cnpjs = data.type === "brasilapi" ? [...new Set(data.cnpjs)] : [];
  const count = data.type === "import" ? data.records.length : data.type === "brasilapi" ? cnpjs.length : data.maxResults;
  const niche = data.type === "commercial" ? data.niche : data.type === "import" ? "Importação autorizada" : "Consulta CNPJ";
  const location = data.type === "commercial" ? data.location : "Brasil";
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const verifyRequest = async () => {
    const result = await createAdminClient().rpc("record_prospect_source", { p_org: ctx.organizationId, p_user: ctx.userId, p_search: data.requestId, p_type: data.type, p_origin: data.origin, p_basis: data.legalBasis, p_hash: hash });
    if (result.error) throw new ServiceError(result.error.message.includes("prospect_request_conflict") ? "Esta solicitação já foi usada com outros dados." : "Não foi possível registrar a declaração de origem.");
  };
  // A estrutura herdada exige um raio; esta fonte usa município/CNPJ e não aplica raio geográfico.
  return searchProspects(ctx, { requestId: data.requestId, niche, location, radiusKm: 1, maxResults: count }, { search: async (_query, { signal }) => {
    if (data.type === "import") return imported;
    if (data.type === "brasilapi") {
      const records = [];
      for (const cnpj of cnpjs) records.push(await lookupCnpj(cnpj, signal));
      return records;
    }
    return searchCommercialB2b({ niche: data.niche, location: data.location, maxResults: data.maxResults }, { signal });
  } }, { verifyRequest });
}
