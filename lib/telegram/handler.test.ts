import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMITS: { telegramChat: {} }, RATE_LIMIT_MESSAGE: "Muitas mensagens." }));
const linkTelegramChat = vi.fn();
const findTelegramLink = vi.fn();
vi.mock("@/lib/services/integrations", () => ({ linkTelegramChat, findTelegramLink }));
const loadTelegramSession = vi.fn();
vi.mock("./session", () => ({ loadTelegramSession }));
const ensureTelegramConversation = vi.fn();
vi.mock("@/lib/services/conversations", () => ({ ensureTelegramConversation }));
const startHermesTurn = vi.fn();
vi.mock("@/lib/hermes/turn", () => ({ startHermesTurn }));
const generateText = vi.fn();
vi.mock("ai", () => ({ generateText }));
const sendTelegramMessage = vi.fn();
const downloadTelegramFile = vi.fn();
vi.mock("./telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./telegram")>()),
  sendTelegramMessage,
  downloadTelegramFile,
}));
const transcribeAudio = vi.fn();
vi.mock("@/lib/transcription", () => ({ transcribeAudio }));
const getUsageSummary = vi.fn();
vi.mock("@/lib/services/usage", () => ({ getUsageSummary }));

const { handleTelegramMessage } = await import("./handler");

const chat = { id: 777, type: "private" };
const message = (text?: string, extra: object = {}) => ({ message_id: 1, chat, from: { id: 777, first_name: "Ana" }, text, ...extra });
const replies = () => sendTelegramMessage.mock.calls.map((call) => call[2] as string);
const turn = { settings: { tools: {} }, messages: [{ id: "u" }], persist: vi.fn(), refund: vi.fn() };
const session = { ctx: { organizationId: "org-1", channel: "telegram" }, organizationName: "Clinkup", userName: "Ana" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rateLimit.mockResolvedValue(true);
  findTelegramLink.mockResolvedValue({ integrationId: "int-1", organizationId: "org-1", userId: "u-1" });
  loadTelegramSession.mockResolvedValue(session);
  startHermesTurn.mockResolvedValue(turn);
  generateText.mockResolvedValue({ text: "Seu plano é o Starter." });
});

describe("handleTelegramMessage", () => {
  it("processa cada update uma única vez (Telegram reenvia quando demora)", async () => {
    rateLimit.mockResolvedValueOnce(false);
    await handleTelegramMessage("bot", 10, message("oi"));
    expect(rateLimit).toHaveBeenCalledWith("telegram:update:10", expect.anything());
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("aplica rate limit por chat", async () => {
    rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await handleTelegramMessage("bot", 11, message("oi"));
    expect(rateLimit).toHaveBeenLastCalledWith("telegram:chat:777", expect.anything());
    expect(replies()).toEqual(["Muitas mensagens."]);
    expect(startHermesTurn).not.toHaveBeenCalled();
  });

  it("recusa grupos", async () => {
    await handleTelegramMessage("bot", 12, { ...message("oi"), chat: { id: -5, type: "group" } });
    expect(replies()[0]).toContain("conversa privada");
  });

  it("vincula com /vincular CODIGO válido", async () => {
    linkTelegramChat.mockResolvedValueOnce({ organization_id: "org-1", user_id: "u-1" });
    await handleTelegramMessage("bot", 13, message("/vincular abcd2345"));
    expect(linkTelegramChat).toHaveBeenCalledWith("ABCD2345", { chatId: 777, displayName: "Ana" });
    expect(replies()[0]).toContain("vinculado");
  });

  it("explica código inválido, vencido ou ausente", async () => {
    linkTelegramChat.mockResolvedValueOnce(null);
    await handleTelegramMessage("bot", 14, message("/vincular ABCD2345"));
    await handleTelegramMessage("bot", 15, message("/vincular"));
    expect(replies()[0]).toContain("inválido ou expirou");
    expect(replies()[1]).toContain("/vincular");
    expect(linkTelegramChat).toHaveBeenCalledTimes(1);
  });

  it("orienta chat não vinculado sem chamar o Hermes", async () => {
    findTelegramLink.mockResolvedValueOnce(null);
    await handleTelegramMessage("bot", 16, message("Qual é o meu plano?"));
    expect(replies()[0]).toContain("Integrações");
    expect(startHermesTurn).not.toHaveBeenCalled();
  });

  it("responde com o Hermes usando o núcleo compartilhado e salva o histórico", async () => {
    await handleTelegramMessage("bot", 17, message("Qual é o meu plano?"));
    expect(ensureTelegramConversation).toHaveBeenCalledWith("org-1", "u-1", "int-1");
    expect(startHermesTurn).toHaveBeenCalledWith(session.ctx, expect.objectContaining({ conversationId: "int-1", organizationName: "Clinkup" }));
    expect(generateText).toHaveBeenCalledWith(turn.settings);
    expect(turn.persist.mock.calls[0][0].at(-1)).toMatchObject({ role: "assistant", parts: [{ type: "text", text: "Seu plano é o Starter." }] });
    expect(replies()).toEqual(["Seu plano é o Starter."]);
  });

  it("devolve a mensagem amigável de regra de negócio (ex.: limite do plano)", async () => {
    startHermesTurn.mockRejectedValueOnce(new ServiceError("Você atingiu o limite de créditos de IA."));
    await handleTelegramMessage("bot", 18, message("oi"));
    expect(replies()).toEqual(["Você atingiu o limite de créditos de IA."]);
  });

  it("estorna o crédito e avisa quando o modelo falha", async () => {
    generateText.mockRejectedValueOnce(new Error("overloaded"));
    await handleTelegramMessage("bot", 19, message("oi"));
    expect(turn.refund).toHaveBeenCalledTimes(1);
    expect(replies()[0]).toContain("Tente enviar");
  });

});

describe("mensagens de áudio", () => {
  const voice = (extra: object = {}) => message(undefined, { voice: { file_id: "f-1", duration: 12, file_size: 20_000, ...extra } });

  beforeEach(() => {
    getUsageSummary.mockResolvedValue([{ metric: "ai_credits", used: 3, limit: 500 }]);
    downloadTelegramFile.mockResolvedValue(new Blob([new Uint8Array([1])]));
    transcribeAudio.mockResolvedValue("Qual é o meu plano?");
  });

  it("transcreve e responde pelo Hermes mostrando o que foi entendido, com 1 crédito", async () => {
    await handleTelegramMessage("bot", 30, voice());
    expect(downloadTelegramFile).toHaveBeenCalledWith("bot", "f-1", expect.any(Number));
    expect(startHermesTurn).toHaveBeenCalledTimes(1);
    expect(startHermesTurn.mock.calls[0][1].userMessage.parts[0].text).toBe("Qual é o meu plano?");
    expect(replies()).toHaveLength(1);
    expect(replies()[0]).toContain("Qual é o meu plano?");
    expect(replies()[0]).toContain("Seu plano é o Starter.");
  });

  it("aceita arquivo de áudio além de mensagem de voz", async () => {
    await handleTelegramMessage("bot", 31, message(undefined, { audio: { file_id: "a-1", duration: 30 } }));
    expect(downloadTelegramFile).toHaveBeenCalledWith("bot", "a-1", expect.any(Number));
  });

  it("recusa áudio longo demais sem baixar nem cobrar", async () => {
    await handleTelegramMessage("bot", 32, voice({ duration: 600 }));
    expect(replies()[0]).toContain("5 minutos");
    expect(downloadTelegramFile).not.toHaveBeenCalled();
    expect(startHermesTurn).not.toHaveBeenCalled();
  });

  it("não transcreve para chat não vinculado", async () => {
    findTelegramLink.mockResolvedValueOnce(null);
    await handleTelegramMessage("bot", 33, voice());
    expect(replies()[0]).toContain("Integrações");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("não transcreve quando os créditos do mês acabaram", async () => {
    getUsageSummary.mockResolvedValue([{ metric: "ai_credits", used: 500, limit: 500 }]);
    await handleTelegramMessage("bot", 34, voice());
    expect(replies()[0]).toContain("créditos");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("pede para repetir quando não entende o áudio, sem cobrar", async () => {
    transcribeAudio.mockResolvedValueOnce("   ");
    await handleTelegramMessage("bot", 35, voice());
    transcribeAudio.mockRejectedValueOnce(new Error("api down"));
    await handleTelegramMessage("bot", 36, voice());
    expect(replies()[0]).toContain("Não consegui entender");
    expect(replies()[1]).toContain("Não consegui entender");
    expect(startHermesTurn).not.toHaveBeenCalled();
  });
});
