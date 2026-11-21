import "server-only";
import { z } from "zod";
import { listProspectSearches, listProspects } from "@/lib/services/prospecting";
import { defineTool } from "./run-tool";

export const PROSPECT_REVIEW_TOOLS = [
  defineTool({ name: "list_prospect_searches", description: "Lista as pesquisas de prospecção da empresa para escolher qual revisar.", input: z.object({}), execute: (ctx) => listProspectSearches(ctx) }),
  defineTool({ name: "list_prospect_results", description: "Lista os resultados de uma pesquisa da empresa para revisão; não transfere contatos ao CRM.", input: z.object({ searchId: z.uuid() }), execute: (ctx, { searchId }) => listProspects(ctx, searchId) }),
] as const;
