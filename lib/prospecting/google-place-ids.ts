import "server-only";
import { z } from "zod";
import { ServiceError } from "@/lib/services/errors";

const inputSchema = z.strictObject({ niche: z.string().trim().min(1).max(200), location: z.string().trim().min(1).max(200), maxResults: z.number().int().min(1).max(60) });
const responseSchema = z.object({ places: z.array(z.object({ id: z.string().min(1).max(500) })).default([]), nextPageToken: z.string().min(1).optional() });

// Apenas identificadores: não armazena nomes, contatos ou qualquer outro conteúdo do Google.
// Não conectado ao serviço de extração enquanto a origem dos dados do CRM não for resolvida.
export async function searchGooglePlaceIds(input: z.input<typeof inputSchema>, options: { apiKey?: string; signal: AbortSignal }) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("Confira o nicho, a região e a quantidade solicitada.");
  const key = options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new ServiceError("A busca Google está indisponível. Configure a integração no servidor.");
  const ids = new Set<string>(); let pageToken: string | undefined;
  for (let page = 0; page < 3 && ids.size < parsed.data.maxResults; page++) {
    let response: Response;
    try {
      response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST", signal: AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]),
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,nextPageToken" },
        body: JSON.stringify({ textQuery: `${parsed.data.niche} em ${parsed.data.location}`, languageCode: "pt-BR", pageSize: Math.min(20, parsed.data.maxResults - ids.size), ...(pageToken ? { pageToken } : {}) }),
      });
    } catch { throw new ServiceError("A busca Google não respondeu. Tente novamente em instantes."); }
    if (response.status === 429) throw new ServiceError("O limite de solicitações do Google foi atingido. Tente novamente mais tarde.");
    if (!response.ok) throw new ServiceError("Não foi possível consultar o Google. Confira a configuração da integração.");
    const data = responseSchema.safeParse(await response.json().catch(() => null));
    if (!data.success) throw new ServiceError("O Google retornou uma resposta inválida. Tente novamente.");
    data.data.places.forEach((place) => { if (ids.size < parsed.data.maxResults) ids.add(place.id); });
    pageToken = data.data.nextPageToken;
    if (!pageToken) break;
  }
  return [...ids];
}
