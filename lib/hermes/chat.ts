import type { UIMessage } from "ai";
import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 4000;

// O cliente envia só a mensagem nova (texto do usuário). Histórico, respostas e resultados de Tools vêm do banco.
export const chatRequestSchema = z.object({
  conversationId: z.uuid(),
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }))
      .min(1)
      .max(10),
  }),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export function conversationTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean || "Nova conversa";
}

export function messagesToPersist(existingIds: Set<string>, messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => !existingIds.has(message.id));
}
