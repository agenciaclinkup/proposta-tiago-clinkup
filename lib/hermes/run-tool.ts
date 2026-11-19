import "server-only";
import type { z } from "zod";
import type { ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { recordHermesLog } from "@/lib/services/hermes-log";

export type HermesTool<S extends z.ZodType = z.ZodType, R = unknown> = {
  name: string;
  description: string;
  input: S;
  // Ações com custo ou efeito externo (publicar, gastar em Ads) pedem confirmação do usuário.
  needsApproval?: boolean;
  execute: (ctx: ServiceContext, input: z.output<S>) => Promise<R>;
};

export type ToolResult<R> = { ok: true; data: R } | { ok: false; error: string };

export const GENERIC_TOOL_ERROR = "Não consegui concluir esta ação agora. Tente novamente em alguns instantes.";

export function defineTool<S extends z.ZodType, R>(tool: HermesTool<S, R>): HermesTool<S, R> {
  return tool;
}

// Ponto único de execução das Tools (chat, Telegram, webhooks): valida com Zod, executa o service e audita.
export async function runTool<S extends z.ZodType, R>(
  ctx: ServiceContext,
  tool: HermesTool<S, R>,
  rawInput: unknown,
): Promise<ToolResult<R>> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
    await recordHermesLog(ctx, { toolName: tool.name, input: rawInput, status: "error", error: `invalid_input: ${detail}`, durationMs: elapsed() });
    return { ok: false, error: `Não consegui entender os dados para esta ação. ${detail}` };
  }

  try {
    const data = await tool.execute(ctx, parsed.data);
    // Códigos de confirmação são credenciais de uso único e não pertencem ao feed da organização.
    const output = ["plan_week_with_ai", "publish_post_now"].includes(tool.name) ? { requiresConfirmation: true } : data;
    await recordHermesLog(ctx, { toolName: tool.name, input: parsed.data, output, status: "success", durationMs: elapsed() });
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordHermesLog(ctx, { toolName: tool.name, input: parsed.data, status: "error", error: message, durationMs: elapsed() });
    if (error instanceof ServiceError) return { ok: false, error: error.message };
    console.error(`[hermes] tool ${tool.name} falhou`, error);
    return { ok: false, error: GENERIC_TOOL_ERROR };
  }
}
