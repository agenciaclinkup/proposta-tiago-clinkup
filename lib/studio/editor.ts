export function moveItem<T>(list: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function slugify(title: string) {
  return title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
}

// Mesmas regras de exportCarouselToCalendar, avaliadas antes de chamar o servidor.
export function exportBlocker({ saved, dirty, status, slides }: { saved: boolean; dirty: boolean; status: "draft" | "ready"; slides: number }) {
  if (!saved) return "Salve o carrossel antes de enviá-lo ao calendário.";
  if (dirty) return "Salve as alterações antes de enviar ao calendário.";
  if (status !== "ready") return "Marque o carrossel como concluído e salve para enviá-lo ao calendário.";
  if (slides === 0) return "Adicione ao menos um slide.";
  if (slides > 10) return "O calendário aceita até 10 slides por post. Remova slides antes de enviar.";
  return null;
}
