import "server-only";
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { MAX_MESSAGE_LENGTH } from "@/lib/hermes/chat";
import { startHermesTurn } from "@/lib/hermes/turn";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { ensureTelegramConversation } from "@/lib/services/conversations";
import { ServiceError } from "@/lib/services/errors";
import { findTelegramLink, linkTelegramChat } from "@/lib/services/integrations";
import { loadTelegramSession } from "./session";
import { parseCommand, sendTelegramMessage, type TelegramUpdate } from "./telegram";

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

const TEXT = {
  welcome:
    "Olá! Eu sou o Hermes, seu assistente de marketing, vendas e automação.\n\nPara começar, vincule este chat à sua conta: no painel, abra Integrações > Telegram, clique em Gerar código e envie aqui:\n/vincular SEU_CODIGO",
  notLinked:
    "Este chat ainda não está vinculado a uma conta.\n\nNo painel, abra Integrações > Telegram, clique em Gerar código e envie aqui:\n/vincular SEU_CODIGO\n\nO código vale por 10 minutos.",
  linkUsage: "Envie o comando junto com o código de 8 caracteres gerado no painel, por exemplo:\n/vincular ABCD2345",
  linkInvalid:
    "Esse código é inválido ou expirou. Gere um novo código em Integrações > Telegram (ele vale por 10 minutos) e envie novamente.",
  linked: "Pronto! Este chat foi vinculado à sua conta. Agora é só me mandar mensagens, como: “Quanto do meu plano eu já usei?”",
  unavailable:
    "Não consegui acessar a sua empresa. Confira no painel se você ainda faz parte dela e se o onboarding foi concluído. Se precisar, vincule este chat de novo em Integrações > Telegram.",
  groups: "Por segurança, eu só atendo em conversa privada. Abra uma conversa direta comigo para continuar.",
  voice: "Recebi seu áudio! A conversa por áudio será liberada em breve. Por enquanto, me envie sua mensagem por texto.",
  onlyText: "Por enquanto eu entendo apenas mensagens de texto. Me conte por escrito como posso ajudar.",
  tooLong: `Sua mensagem passou de ${MAX_MESSAGE_LENGTH.toLocaleString("pt-BR")} caracteres. Pode resumir ou dividir em partes?`,
  failed: "Tive um problema para concluir a resposta. Tente enviar a mensagem novamente em alguns instantes.",
};

// shortcut: dedupe por janela fixa de 24 h em private.rate_limits (falha aberta); trocar por tabela de updates se surgir duplicidade.
const UPDATE_ONCE = { limit: 1, windowSeconds: 86_400 };

export async function handleTelegramMessage(botToken: string, updateId: number, message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const reply = (text: string) => sendTelegramMessage(botToken, chatId, text);

  try {
    if (!(await rateLimit(`telegram:update:${updateId}`, UPDATE_ONCE))) return;
    if (message.chat.type !== "private") return reply(TEXT.groups);
    if (!(await rateLimit(`telegram:chat:${chatId}`, RATE_LIMITS.telegramChat))) return reply(RATE_LIMIT_MESSAGE);

    if (message.voice) return reply(TEXT.voice);
    if (!message.text) return reply(TEXT.onlyText);

    const command = parseCommand(message.text);
    if (command.type === "start") return reply((await findTelegramLink(chatId)) ? TEXT.linked : TEXT.welcome);
    if (command.type === "link") {
      if (!command.code) return reply(TEXT.linkUsage);
      const displayName = message.from?.username ? `@${message.from.username}` : (message.from?.first_name ?? null);
      const link = await linkTelegramChat(command.code, { chatId, displayName });
      return reply(link ? TEXT.linked : TEXT.linkInvalid);
    }

    const link = await findTelegramLink(chatId);
    if (!link) return reply(TEXT.notLinked);
    const session = await loadTelegramSession(link);
    if (!session) return reply(TEXT.unavailable);
    if (command.text.length > MAX_MESSAGE_LENGTH) return reply(TEXT.tooLong);

    await ensureTelegramConversation(link.organizationId, link.userId, link.integrationId);

    let turn: Awaited<ReturnType<typeof startHermesTurn>>;
    try {
      turn = await startHermesTurn(session.ctx, {
        conversationId: link.integrationId,
        userMessage: { id: randomUUID(), role: "user", parts: [{ type: "text", text: command.text }] },
        organizationName: session.organizationName,
        userName: session.userName,
      });
    } catch (error) {
      if (error instanceof ServiceError) return reply(error.message);
      throw error;
    }

    try {
      const result = await generateText(turn.settings);
      const text = result.text.trim() || "Pronto! Concluí o que você pediu.";
      await turn.persist([...turn.messages, { id: randomUUID(), role: "assistant", parts: [{ type: "text", text }] }]);
      await reply(text);
    } catch (error) {
      turn.refund();
      console.error("[telegram] falha na resposta do Hermes", error);
      await reply(TEXT.failed);
    }
  } catch (error) {
    console.error("[telegram] falha ao processar mensagem", error);
    await reply(TEXT.failed).catch(() => {});
  }
}
