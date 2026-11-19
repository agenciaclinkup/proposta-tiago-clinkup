// Transformação pura do quadro, usada na atualização otimista do Kanban (o servidor confirma ou o cliente desfaz).
export type BoardColumn<L extends { id: string }> = { id: string; leads: L[] };

export function moveCardInBoard<L extends { id: string }, C extends BoardColumn<L>>(
  board: C[],
  leadId: string,
  toStageId: string,
  toIndex: number,
): C[] {
  const from = board.find((column) => column.leads.some((lead) => lead.id === leadId));
  const to = board.find((column) => column.id === toStageId);
  if (!from || !to) return board;

  const card = from.leads.find((lead) => lead.id === leadId)!;
  return board.map((column) => {
    const leads = column.leads.filter((lead) => lead.id !== leadId);
    if (column.id !== toStageId) return column.id === from.id ? { ...column, leads } : column;
    const index = Math.max(0, Math.min(toIndex, leads.length));
    return { ...column, leads: [...leads.slice(0, index), card, ...leads.slice(index)] };
  });
}
