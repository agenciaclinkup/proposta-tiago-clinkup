// Métricas do funil a partir da foto atual: um lead em uma etapa é contado como tendo passado pelas anteriores.
// Progressão = etapas abertas na ordem + ganho; perdidos ficam à parte (entram no total).
// shortcut: não usa o histórico de crm_activities; taxas por período ficam para quando houver relatório temporal.
export type FunnelStageInput = { id: string; name: string; kind: string; count: number; value: number };

export type FunnelStage = FunnelStageInput & {
  reached: number;
  share: number;
  // Fração dos que chegaram nesta etapa e chegaram também na próxima; null na última ou sem ninguém.
  passRate: number | null;
};

export function funnelMetrics(stages: FunnelStageInput[]) {
  const progression = stages.filter((stage) => stage.kind !== "lost");
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  const share = (count: number) => (total > 0 ? count / total : 0);

  const reached = progression.map((_, i) => progression.slice(i).reduce((sum, stage) => sum + stage.count, 0));
  const result: FunnelStage[] = progression.map((stage, i) => ({
    ...stage,
    reached: reached[i],
    share: share(stage.count),
    passRate: i < progression.length - 1 && reached[i] > 0 ? reached[i + 1] / reached[i] : null,
  }));

  const won = stages.filter((stage) => stage.kind === "won");
  const wonCount = won.reduce((sum, stage) => sum + stage.count, 0);

  return {
    stages: result,
    lost: stages.filter((stage) => stage.kind === "lost").map((stage) => ({ ...stage, share: share(stage.count) })),
    total,
    totalValue: stages.reduce((sum, stage) => sum + stage.value, 0),
    wonCount,
    conversion: won.length > 0 && total > 0 ? wonCount / total : null,
  };
}
