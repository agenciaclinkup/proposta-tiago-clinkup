export function canEditPost(status: string | null): boolean {
  return status === null || status === "draft" || status === "scheduled";
}

export function statusLabel(status: string): string {
  return ({ draft: "Rascunho", scheduled: "Agendado", publishing: "Em publicação", published: "Publicado", failed: "Falhou" } as Record<string, string>)[status] ?? status;
}
