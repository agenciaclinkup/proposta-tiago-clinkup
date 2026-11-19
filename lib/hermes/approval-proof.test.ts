import { describe, expect, it } from "vitest";
import { confirmationFromUserMessage } from "./approval-proof";

describe("confirmação enviada pelo usuário", () => {
  const code = "0123456789abcdef0123456789abcdef";
  it("aceita somente uma mensagem de texto com o comando completo", () => {
    expect(confirmationFromUserMessage({ role: "user", parts: [{ type: "text", text: `CONFIRMAR ${code}` }] })).toBe(code);
  });
  it("rejeita texto adicional, mensagens do assistente e fragmentos", () => {
    expect(confirmationFromUserMessage({ role: "assistant", parts: [{ type: "text", text: `CONFIRMAR ${code}` }] })).toBeNull();
    expect(confirmationFromUserMessage({ role: "user", parts: [{ type: "text", text: `não CONFIRMAR ${code}` }] })).toBeNull();
    expect(confirmationFromUserMessage({ role: "user", parts: [{ type: "text", text: "CONFIRMAR " }, { type: "text", text: code }] })).toBeNull();
  });
});
