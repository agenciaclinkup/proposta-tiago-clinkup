import { describe, expect, it } from "vitest";
import { funnelMetrics } from "./funnel";

const stage = (id: string, kind: "open" | "won" | "lost", count: number, value = 0) => ({ id, name: id, kind, count, value });

describe("funnelMetrics", () => {
  it("calcula participação, taxa de passagem pela etapa seguinte e conversão geral", () => {
    const result = funnelMetrics([
      stage("Novo", "open", 50, 5000),
      stage("Qualificado", "open", 20),
      stage("Proposta", "open", 10),
      stage("Fechado", "won", 20, 30000),
    ]);
    // Chegaram em cada etapa (ela ou além): 100 → 50 → 30 → 20.
    expect(result.total).toBe(100);
    expect(result.stages.map((s) => s.reached)).toEqual([100, 50, 30, 20]);
    expect(result.stages.map((s) => s.passRate)).toEqual([0.5, 0.6, 2 / 3, null]);
    expect(result.stages[0].share).toBe(0.5);
    expect(result.conversion).toBe(0.2);
    expect(result.totalValue).toBe(35000);
  });

  it("deixa perdidos fora da progressão, mas dentro do total", () => {
    const result = funnelMetrics([stage("Novo", "open", 6), stage("Perdido", "lost", 2), stage("Fechado", "won", 2)]);
    expect(result.stages.map((s) => s.name)).toEqual(["Novo", "Fechado"]);
    expect(result.lost).toEqual([expect.objectContaining({ name: "Perdido", count: 2, share: 0.2 })]);
    expect(result.total).toBe(10);
    expect(result.conversion).toBe(0.2);
  });

  it("não divide por zero e sem etapa de ganho não inventa conversão", () => {
    const empty = funnelMetrics([stage("Novo", "open", 0), stage("Fechado", "won", 0)]);
    expect(empty.stages.map((s) => s.passRate)).toEqual([null, null]);
    expect(empty.stages[0].share).toBe(0);
    expect(empty.conversion).toBeNull();
    expect(funnelMetrics([stage("Novo", "open", 3)]).conversion).toBeNull();
  });
});
