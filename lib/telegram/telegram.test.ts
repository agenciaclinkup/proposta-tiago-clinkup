import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";
import { downloadTelegramFile, parseCommand, splitMessage, telegramUpdateSchema, verifyWebhookSecret } from "./telegram";

describe("parseCommand", () => {
  it("reconhece /vincular com código em qualquer caixa e com @nome_do_bot", () => {
    expect(parseCommand("/vincular abcd2345")).toEqual({ type: "link", code: "ABCD2345" });
    expect(parseCommand("/vincular@HermesBot ABCD2345")).toEqual({ type: "link", code: "ABCD2345" });
  });

  it("trata /vincular sem código ou com código inválido", () => {
    expect(parseCommand("/vincular")).toEqual({ type: "link", code: null });
    expect(parseCommand("/vincular 123")).toEqual({ type: "link", code: null });
  });

  it("reconhece /start e mensagens comuns", () => {
    expect(parseCommand("/start")).toEqual({ type: "start" });
    expect(parseCommand("/start ABCD2345")).toEqual({ type: "link", code: "ABCD2345" });
    expect(parseCommand("  Qual é o meu plano?  ")).toEqual({ type: "message", text: "Qual é o meu plano?" });
  });
});

describe("telegramUpdateSchema", () => {
  it("aceita mensagem de texto e descarta campos que não usamos", () => {
    const parsed = telegramUpdateSchema.parse({
      update_id: 10,
      message: { message_id: 1, chat: { id: 99, type: "private", first_name: "Ana" }, from: { id: 99, first_name: "Ana", username: "ana" }, text: "oi", extra: true },
    });
    expect(parsed.message?.chat.id).toBe(99);
    expect(parsed.message).not.toHaveProperty("extra");
  });

  it("rejeita update sem update_id e aceita update sem mensagem (ignorado)", () => {
    expect(telegramUpdateSchema.safeParse({ message: {} }).success).toBe(false);
    expect(telegramUpdateSchema.safeParse({ update_id: 1, edited_message: {} }).success).toBe(true);
  });
});

describe("verifyWebhookSecret", () => {
  it("compara o segredo em tempo constante e rejeita ausente ou diferente", () => {
    expect(verifyWebhookSecret("s3cr3t-token", "s3cr3t-token")).toBe(true);
    expect(verifyWebhookSecret("s3cr3t-tokeX", "s3cr3t-token")).toBe(false);
    expect(verifyWebhookSecret(null, "s3cr3t-token")).toBe(false);
    expect(verifyWebhookSecret("curto", "s3cr3t-token")).toBe(false);
    expect(verifyWebhookSecret("x", undefined)).toBe(false);
  });
});

describe("splitMessage", () => {
  it("quebra respostas longas no limite do Telegram", () => {
    const parts = splitMessage("a".repeat(9000));
    expect(parts.map((p) => p.length)).toEqual([4000, 4000, 1000]);
    expect(splitMessage("curta")).toEqual(["curta"]);
  });
});

describe("downloadTelegramFile", () => {
  const fetchMock = vi.fn();
  afterEach(() => vi.unstubAllGlobals());

  it("busca o caminho do arquivo e baixa o áudio", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "voice/file_1.oga", file_size: 3 } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const file = await downloadTelegramFile("123:abc", "file-1", 1000);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.telegram.org/bot123:abc/getFile?file_id=file-1");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.telegram.org/file/bot123:abc/voice/file_1.oga");
    expect(file.size).toBe(3);
  });

  it("recusa arquivo acima do limite sem baixar", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "voice/big.oga", file_size: 5000 } }));
    await expect(downloadTelegramFile("123:abc", "file-2", 1000)).rejects.toBeInstanceOf(ServiceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
