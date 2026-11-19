import { describe, expect, it } from "vitest";
import { exportBlocker, moveItem, slugify } from "./editor";

describe("utilitários do editor do Estúdio", () => {
  it("move itens sem sair dos limites e sem alterar a lista original", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 2, 1)).toBe(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
  it("gera endereço válido a partir do título em português", () => {
    expect(slugify("Promoção de Verão — Clínica São João!")).toBe("promocao-de-verao-clinica-sao-joao");
    expect(slugify("   ")).toBe("");
    expect(slugify("a".repeat(100))).toHaveLength(80);
  });
  it("explica por que a exportação ainda não está disponível", () => {
    expect(exportBlocker({ saved: false, dirty: false, status: "ready", slides: 2 })).toMatch(/Salve/);
    expect(exportBlocker({ saved: true, dirty: true, status: "ready", slides: 2 })).toMatch(/alterações/);
    expect(exportBlocker({ saved: true, dirty: false, status: "draft", slides: 2 })).toMatch(/concluído/);
    expect(exportBlocker({ saved: true, dirty: false, status: "ready", slides: 11 })).toMatch(/10 slides/);
    expect(exportBlocker({ saved: true, dirty: false, status: "ready", slides: 3 })).toBeNull();
  });
});
