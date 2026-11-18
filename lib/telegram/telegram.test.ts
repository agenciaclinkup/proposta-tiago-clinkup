import { describe, expect, it } from "vitest";
import { parseCommand, splitMessage, telegramUpdateSchema, verifyWebhookSecret } from "./telegram";

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
