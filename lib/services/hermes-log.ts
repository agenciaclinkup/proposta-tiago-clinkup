import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";

export type HermesLogEntry = {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "success" | "error";
  error?: string;
  durationMs: number;
};

// Auditoria gravada pelo servidor (usuário não tem INSERT em hermes_logs). Falha registra e segue.
export async function recordHermesLog(ctx: ServiceContext, entry: HermesLogEntry): Promise<void> {
  const { error } = await createAdminClient()
    .from("hermes_logs")
    .insert({
      organization_id: ctx.organizationId,
      user_id: ctx.userId,
      channel: ctx.channel,
      via: ctx.via,
      tool_name: entry.toolName,
      input: entry.input ?? {},
      output: entry.output ?? null,
      status: entry.status,
      error: entry.error ?? null,
      duration_ms: entry.durationMs,
    });
  if (error) console.error("[hermes-log] falha ao gravar auditoria", entry.toolName, error.message);
}
