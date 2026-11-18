import "server-only";
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { MAX_MESSAGE_LENGTH } from "@/lib/hermes/chat";
import { startHermesTurn } from "@/lib/hermes/turn";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { ensureTelegramConversation } from "@/lib/services/conversations";
import { ServiceError } from "@/lib/services/errors";
import { findTelegramLink, linkTelegramChat } from "@/lib/services/integrations";
import { getUsageSummary } from "@/lib/services/usage";
import { transcribeAudio } from "@/lib/transcription";
import { loadTelegramSession } from "./session";
import { downloadTelegramFile, parseCommand, sendTelegramMessage, type TelegramScope, type TelegramUpdate } from "./telegram";

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;
type Reply = (text: string) => Promise<void>;

// Limites anti-abuso do áudio: checados antes de baixar e de transcrever (transcrição tem custo).
const MAX_AUDIO_SECONDS = 5 * 60;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const TEXT = {
  welcome:
    "Olá! Eu sou o Hermes, seu assistente de marketing, vendas e automação.\n\nPara começar, vincule este chat à sua conta: no painel, abra Integrações > Telegram, clique em Gerar código e envie aqui:\n/vincular SEU_CODIGO",
  notLinked:
    "Este chat ainda não está vinculado a uma conta.\n\nNo painel, abra Integrações > Telegram, clique em Gerar código e envie aqui:\n/vincular SEU_CODIGO\n\nO código vale por 10 minutos.",
  linkUsage: "Envie o comando junto com o código de 8 caracteres gerado no painel, por exemplo:\n/vincular ABCD2345",
  linkInvalid:
    "Esse código é inválido ou expirou. Gere um novo código em Integrações > Telegram (ele vale por 10 minutos) e envie novamente.",
  linked:
    "Pronto! Este chat está vinculado à sua conta. Agora é só me mandar mensagens de texto ou áudio, como: “Quanto do meu plano eu já usei?”",
  unavailable:
    "Não consegui acessar a sua empresa. Confira no painel se você ainda faz parte dela e se o onboarding foi concluído. Se precisar, vincule este chat de novo em Integrações > Telegram.",
  groups: "Por segurança, eu só atendo em conversa privada. Abra uma conversa direta comigo para continuar.",
  onlyText: "Por enquanto eu entendo mensagens de texto e de áudio. Me conte como posso ajudar.",
  tooLong: `Sua mensagem passou de ${MAX_MESSAGE_LENGTH.toLocaleString("pt-BR")} caracteres. Pode resumir ou dividir em partes?`,
  audioTooLong: "Esse áudio passou de 5 minutos. Envie um áudio mais curto ou escreva sua mensagem, por favor.",
  notUnderstood: "Não consegui entender o seu áudio. Pode gravar de novo, em um lugar mais silencioso, ou escrever a mensagem?",
  noCredits:
    "Os créditos de IA do seu plano acabaram neste mês. Para continuar conversando comigo, faça o upgrade na página Planos do painel.",
  failed: "Tive um problema para concluir a resposta. Tente enviar a mensagem novamente em alguns instantes.",
};

// shortcut: dedupe por janela fixa de 24 h em private.rate_limits (falha aberta); trocar por tabela de updates se surgir duplicidade.
const UPDATE_ONCE = { limit: 1, windowSeconds: 86_400 };

// `scope` presente = bot próprio de uma empresa: vínculo, busca e sessão ficam restritos a essa empresa.
export async function handleTelegramMessage(
  botToken: string,
  updateId: number,
  message: TelegramMessage,
  scope?: TelegramScope,
): Promise<void> {
  const chatId = message.chat.id;
  const reply: Reply = (text) => sendTelegramMessage(botToken, chatId, text);

  try {
    // update_id é sequencial por bot: a chave inclui o bot próprio para não colidir com o da plataforma.
    if (!(await rateLimit(`telegram:update:${scope ? `${scope.botId}:` : ""}${updateId}`, UPDATE_ONCE))) return;
    if (message.chat.type !== "private") return reply(TEXT.groups);
    if (!(await rateLimit(`telegram:chat:${chatId}`, RATE_LIMITS.telegramChat))) return reply(RATE_LIMIT_MESSAGE);

    const audio = message.voice ?? message.audio;
    if (audio) return handleAudio(botToken, chatId, audio, reply, scope);
    if (!message.text) return reply(TEXT.onlyText);

    const command = parseCommand(message.text);
    if (command.type === "start") return reply((await findTelegramLink(chatId, scope)) ? TEXT.linked : TEXT.welcome);
    if (command.type === "link") {
      if (!command.code) return reply(TEXT.linkUsage);
      const displayName = message.from?.username ? `@${message.from.username}` : (message.from?.first_name ?? null);
      const link = await linkTelegramChat(command.code, { chatId, displayName }, scope);
      return reply(link ? TEXT.linked : TEXT.linkInvalid);
    }

    const target = await linkedSession(chatId, scope);
    if (typeof target === "string") return reply(target);
    if (command.text.length > MAX_MESSAGE_LENGTH) return reply(TEXT.tooLong);
    await answer(target, command.text, reply);
  } catch (error) {
    console.error("[telegram] falha ao processar mensagem", error);
    await reply(TEXT.failed).catch(() => {});
  }
}

async function handleAudio(
  botToken: string,
  chatId: number,
  audio: NonNullable<TelegramMessage["voice"]>,
  reply: Reply,
  scope?: TelegramScope,
): Promise<void> {
  if ((audio.duration ?? 0) > MAX_AUDIO_SECONDS || (audio.file_size ?? 0) > MAX_AUDIO_BYTES) return reply(TEXT.audioTooLong);

  const target = await linkedSession(chatId, scope);
  if (typeof target === "string") return reply(target);

  // Sem crédito, nem baixa nem transcreve (evita custo de transcrição em conta sem saldo).
  const credits = (await getUsageSummary(target.session.ctx)).find((item) => item.metric === "ai_credits");
  if (credits && credits.used >= credits.limit) return reply(TEXT.noCredits);

  let heard: string;
  try {
    const file = await downloadTelegramFile(botToken, audio.file_id, MAX_AUDIO_BYTES);
    heard = (await transcribeAudio(file, file.name)).trim();
  } catch (error) {
    if (error instanceof ServiceError) return reply(error.message);
    console.error("[telegram] falha ao transcrever áudio", error);
    return reply(TEXT.notUnderstood);
  }
  if (!heard) return reply(TEXT.notUnderstood);
  if (heard.length > MAX_MESSAGE_LENGTH) return reply(TEXT.tooLong);

  // Mesmo turno do texto: 1 crédito, sem cobrança extra pela transcrição.
  await answer(target, heard, reply, heard);
}

async function linkedSession(chatId: number, scope?: TelegramScope) {
  const link = await findTelegramLink(chatId, scope);
  if (!link) return TEXT.notLinked;
  // Defesa em profundidade: bot próprio nunca abre sessão (dados e créditos) de outra empresa.
  if (scope && link.organizationId !== scope.organizationId) return TEXT.unavailable;
  const session = await loadTelegramSession(link);
  if (!session) return TEXT.unavailable;
  return { link, session };
}

async function answer(
  { link, session }: Exclude<Awaited<ReturnType<typeof linkedSession>>, string>,
  text: string,
  reply: Reply,
  heard?: string,
): Promise<void> {
  await ensureTelegramConversation(link.organizationId, link.userId, link.integrationId);

  let turn: Awaited<ReturnType<typeof startHermesTurn>>;
  try {
    turn = await startHermesTurn(session.ctx, {
      conversationId: link.integrationId,
      userMessage: { id: randomUUID(), role: "user", parts: [{ type: "text", text }] },
      organizationName: session.organizationName,
      userName: session.userName,
    });
  } catch (error) {
    if (error instanceof ServiceError) return reply(error.message);
    throw error;
  }

  try {
    const result = await generateText(turn.settings);
    const answerText = result.text.trim() || "Pronto! Concluí o que você pediu.";
    await turn.persist([...turn.messages, { id: randomUUID(), role: "assistant", parts: [{ type: "text", text: answerText }] }]);
    await reply(heard ? `🎙️ Entendi: “${heard}”\n\n${answerText}` : answerText);
  } catch (error) {
    turn.refund();
    console.error("[telegram] falha na resposta do Hermes", error);
    await reply(TEXT.failed);
  }
}
