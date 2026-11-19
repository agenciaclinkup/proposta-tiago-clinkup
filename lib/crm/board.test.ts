import { describe, expect, it } from "vitest";
import { moveCardInBoard, type BoardColumn } from "./board";

const board: BoardColumn<{ id: string }>[] = [
  { id: "s1", leads: [{ id: "a" }, { id: "b" }] },
  { id: "s2", leads: [{ id: "c" }] },
];

describe("moveCardInBoard", () => {
  it("move entre colunas na posição pedida sem alterar o quadro original", () => {
    const next = moveCardInBoard(board, "a", "s2", 0);
    expect(next.map((col) => col.leads.map((l) => l.id))).toEqual([["b"], ["a", "c"]]);
    expect(board[0].leads.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("reordena dentro da mesma coluna e limita o índice", () => {
    expect(moveCardInBoard(board, "a", "s1", 99).map((col) => col.leads.map((l) => l.id))).toEqual([["b", "a"], ["c"]]);
  });

  it("devolve o quadro igual se o card ou a coluna não existem", () => {
    expect(moveCardInBoard(board, "zz", "s2", 0)).toBe(board);
    expect(moveCardInBoard(board, "a", "s9", 0)).toBe(board);
  });
});
