import type { ServiceContext } from "./context";

// Sem a coluna `error`: pode conter detalhe interno e esta lista vai para a UI e para o modelo.
export async function listRecentActivity(ctx: Pick<ServiceContext, "supabase" | "organizationId">, limit: number) {
  const { data, error } = await ctx.supabase
    .from("hermes_logs")
    .select("id, tool_name, channel, via, status, created_at")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}
