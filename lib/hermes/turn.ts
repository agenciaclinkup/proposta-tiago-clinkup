import "server-only";
import { anthropic, type AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getBrandContext } from "@/lib/services/brand";
import type { ServiceContext } from "@/lib/services/context";
import { loadConversationMessages, saveConversationMessages } from "@/lib/services/conversations";
import { consumeUsage, refundUsage } from "@/lib/services/usage";
import { messagesToPersist } from "./chat";
import { buildSystemPrompt } from "./system-prompt";
import { buildHermesTools } from "./tools";
import { confirmationFromUserMessage } from "./approval-proof";

export const HERMES_MODEL = "claude-opus-5-5";
const MAX_STEPS = 6;

// Núcleo de um turno do Hermes, igual em todos os canais (painel com streamText, Telegram com generateText):
// cobra 1 crédito, carrega histórico confiável do banco e monta modelo, prompt e Tools.
export async function startHermesTurn(
  ctx: ServiceContext,
  input: { conversationId: string; userMessage: UIMessage; organizationName: string; userName: string | null },
) {
  // 1 crédito de IA por turno do agente, independente de quantas Tools ele usar. PlanLimitError sobe sem cobrança.
  await consumeUsage(ctx, "ai_credits", 1);

  // Estorno no máximo uma vez por turno (a falha pode ser vista por mais de um callback).
  let charged = true;
  const refund = () => {
    if (!charged) return;
    charged = false;
    void refundUsage(ctx, "ai_credits", 1);
  };

  try {
    const [history, brand] = await Promise.all([loadConversationMessages(ctx, input.conversationId), getBrandContext(ctx)]);
    const messages = [...history.filter((m) => m.id !== input.userMessage.id), input.userMessage];
    const existingIds = new Set(history.map((m) => m.id));

    return {
      messages,
      refund,
      persist: async (all: UIMessage[]) => {
        try {
          await saveConversationMessages(ctx, input.conversationId, messagesToPersist(existingIds, all));
        } catch (error) {
          console.error("[hermes] falha ao salvar mensagens", error);
        }
      },
      settings: {
        model: anthropic(HERMES_MODEL),
        system: buildSystemPrompt({
          organizationName: input.organizationName,
          userName: input.userName,
          masterContext: brand?.master_context ?? null,
          now: new Date(),
        }),
        messages: await convertToModelMessages(messages),
        tools: buildHermesTools(ctx, { conversationId: input.conversationId, proof: confirmationFromUserMessage(input.userMessage), messageId: input.userMessage.id }),
        stopWhen: isStepCount(MAX_STEPS),
        maxOutputTokens: 16000,
        providerOptions: {
          anthropic: {
            // Opus 5.5: thinking adaptativo sempre ligado; effort padrão do modelo é "medium" — fixado explicitamente.
            effort: "medium",
            // Recusa do classificador de segurança é reprocessada no servidor por um modelo de fallback.
            fallbacks: "default",
            anthropicBeta: ["server-side-fallback-2026-07-01"],
            metadata: { userId: ctx.userId ?? undefined },
          } satisfies AnthropicProviderOptions,
        },
      },
    };
  } catch (error) {
    refund();
    throw error;
  }
}
