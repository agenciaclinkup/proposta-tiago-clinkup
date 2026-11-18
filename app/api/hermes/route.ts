import { streamText, type UIMessage } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { chatRequestSchema, conversationTitle } from "@/lib/hermes/chat";
import { startHermesTurn } from "@/lib/hermes/turn";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ensureConversation } from "@/lib/services/conversations";
import { ServiceError } from "@/lib/services/errors";
import { PlanLimitError } from "@/lib/services/usage";
import { loadWorkspace } from "@/lib/workspace";

export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  const loaded = await loadWorkspace();
  if (loaded.status === "unauthenticated") return fail(401, "Sua sessão expirou. Entre novamente para continuar.");
  if (loaded.status === "onboarding") return fail(403, "Conclua o onboarding da sua empresa para conversar com o Hermes.");
  const workspace = loaded.workspace;

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Não consegui ler sua mensagem. Escreva um texto de até 4.000 caracteres e tente novamente.");
  const { conversationId, message } = parsed.data;

  if (!(await rateLimit(`hermes:user:${workspace.user.id}`, RATE_LIMITS.hermesChatUser))) return fail(429, RATE_LIMIT_MESSAGE);

  const ctx = serviceContext(workspace, "hermes", "web");
  const userMessage: UIMessage = { id: message.id, role: "user", parts: message.parts };

  let turn: Awaited<ReturnType<typeof startHermesTurn>>;
  try {
    await ensureConversation(ctx, conversationId, conversationTitle(message.parts[0].text));
    turn = await startHermesTurn(ctx, {
      conversationId,
      userMessage,
      organizationName: workspace.organization.name,
      userName: workspace.profile.full_name,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) return fail(402, error.message);
    if (error instanceof ServiceError) return fail(404, error.message);
    console.error("[hermes] falha ao preparar a conversa", error);
    return fail(500, "Não consegui iniciar a conversa agora. Tente novamente em alguns instantes.");
  }

  const result = streamText(turn.settings);

  return result.toUIMessageStreamResponse({
    originalMessages: turn.messages,
    generateMessageId: () => crypto.randomUUID(),
    onEnd: async ({ messages, outcome }) => {
      // Interrupção pelo usuário ("aborted") consome o crédito; só falha do lado do servidor/modelo estorna.
      if (outcome.status === "failed") turn.refund();
      await turn.persist(messages);
    },
    onError: (error) => {
      console.error("[hermes] erro no streaming", error);
      turn.refund();
      return "Tive um problema para concluir a resposta. Tente enviar a mensagem novamente.";
    },
  });
}
