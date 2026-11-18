import { anthropic, type AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { convertToModelMessages, isStepCount, streamText, type UIMessage } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { chatRequestSchema, conversationTitle, messagesToPersist } from "@/lib/hermes/chat";
import { buildSystemPrompt } from "@/lib/hermes/system-prompt";
import { buildHermesTools } from "@/lib/hermes/tools";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { getBrandContext } from "@/lib/services/brand";
import { serviceContext } from "@/lib/services/context";
import { ensureConversation, loadConversationMessages, saveConversationMessages } from "@/lib/services/conversations";
import { ServiceError } from "@/lib/services/errors";
import { consumeUsage, PlanLimitError } from "@/lib/services/usage";
import { loadWorkspace } from "@/lib/workspace";

export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const MAX_STEPS = 6;

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

  let history: UIMessage[];
  let masterContext: string | null;
  try {
    await ensureConversation(ctx, conversationId, conversationTitle(message.parts[0].text));
    // 1 crédito de IA por turno do agente, independente de quantas Tools ele usar.
    await consumeUsage(ctx, "ai_credits", 1);
    const [messages, brand] = await Promise.all([loadConversationMessages(ctx, conversationId), getBrandContext(ctx)]);
    history = messages;
    masterContext = brand?.master_context ?? null;
  } catch (error) {
    if (error instanceof PlanLimitError) return fail(402, error.message);
    if (error instanceof ServiceError) return fail(404, error.message);
    console.error("[hermes] falha ao preparar a conversa", error);
    return fail(500, "Não consegui iniciar a conversa agora. Tente novamente em alguns instantes.");
  }

  const allMessages = [...history.filter((m) => m.id !== userMessage.id), userMessage];
  const existingIds = new Set(history.map((m) => m.id));

  const result = streamText({
    model: anthropic(MODEL),
    system: buildSystemPrompt({
      organizationName: workspace.organization.name,
      userName: workspace.profile.full_name,
      masterContext,
      now: new Date(),
    }),
    messages: await convertToModelMessages(allMessages),
    tools: buildHermesTools(ctx),
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: 16000,
    providerOptions: {
      anthropic: {
        // Opus 5.5: thinking adaptativo sempre ligado; effort padrão do modelo é "medium" — fixado explicitamente.
        effort: "medium",
        // Recusa do classificador de segurança é reprocessada no servidor por um modelo de fallback.
        fallbacks: "default",
        anthropicBeta: ["server-side-fallback-2026-07-01"],
        metadata: { userId: workspace.user.id },
      } satisfies AnthropicProviderOptions,
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: allMessages,
    generateMessageId: () => crypto.randomUUID(),
    onEnd: async ({ messages }) => {
      try {
        await saveConversationMessages(ctx, conversationId, messagesToPersist(existingIds, messages));
      } catch (error) {
        console.error("[hermes] falha ao salvar mensagens", error);
      }
    },
    onError: (error) => {
      console.error("[hermes] erro no streaming", error);
      return "Tive um problema para concluir a resposta. Tente enviar a mensagem novamente.";
    },
  });
}
