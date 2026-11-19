"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { moveItem, slugify } from "@/lib/studio/editor";
import { saveLandingPageAction } from "./actions";
import type { LandingSection, StudioLanding, StudioStage } from "./view";

const TYPES: [LandingSection["type"], string][] = [["hero", "Destaque principal"], ["content", "Conteúdo"], ["features", "Benefícios"], ["testimonial", "Depoimento"], ["cta", "Chamada para ação"], ["form", "Formulário de contato"]];
const typeName = (type: LandingSection["type"]) => TYPES.find(([id]) => id === type)?.[1] ?? type;
const STARTER: LandingSection[] = [
  { type: "hero", heading: "", body: "", imagePath: null },
  { type: "features", heading: "", body: "", imagePath: null },
  { type: "form", heading: "Fale com a nossa equipe", body: "Deixe seus dados e retornamos em breve.", imagePath: null },
];

export function LandingEditor({ page, stages, onSaved }: { page: StudioLanding | null; stages: StudioStage[]; onSaved: (id: string) => void }) {
  const initial = useMemo(() => ({ title: page?.title ?? "", slug: page?.slug ?? "", sections: page?.sections ?? STARTER, stageId: page?.stage_id ?? "", published: page?.published ?? false }), [page]);
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const [sections, setSections] = useState<LandingSection[]>(initial.sections);
  const [stageId, setStageId] = useState(initial.stageId);
  const [published, setPublished] = useState(initial.published);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const dirty = JSON.stringify({ title, slug, sections, stageId, published }) !== JSON.stringify(initial);
  const update = (index: number, patch: Partial<LandingSection>) => setSections((list) => list.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  function save() {
    setError("");
    const stage = stages.find((item) => item.id === stageId);
    start(async () => {
      const result = await saveLandingPageAction({ pageId: page?.id, title, slug, sections, pipelineId: stage?.pipeline_id ?? null, stageId: stage?.id ?? null, published });
      if ("error" in result) setError(result.error); else { toast.success("Landing page salva."); onSaved(result.id); }
    });
  }

  return <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="landing-title">Título da página</Label><Input id="landing-title" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} placeholder="Ex.: Avaliação gratuita de clareamento" /></div>
        <div className="space-y-1.5"><Label htmlFor="landing-slug">Endereço da página</Label><Input id="landing-slug" value={slug} maxLength={80} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} placeholder="avaliacao-gratuita" aria-describedby="landing-slug-help" /><p id="landing-slug-help" className="text-xs text-muted-foreground">Use letras minúsculas, números e hífens.</p></div>
        <div className="space-y-1.5"><Label htmlFor="landing-stage">Leads do formulário entram no CRM em</Label><select id="landing-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Não enviar ao CRM</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Marcar como pronta para publicar</label>
      </div>
      <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">O endereço público e o formulário que cria leads automaticamente no CRM serão liberados em uma próxima etapa. Você já pode deixar o conteúdo e a etapa do funil prontos.</p>

      <section aria-label="Seções da página" className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Seções ({sections.length}/30)</h2><Button variant="outline" size="sm" disabled={sections.length >= 30} onClick={() => setSections([...sections, { type: "content", heading: "", body: "", imagePath: null }])}><Plus className="size-4" aria-hidden /> Adicionar seção</Button></div>
        {sections.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma seção. Adicione a primeira para montar a página.</p>}
        <ol className="space-y-3">{sections.map((section, index) => <li key={index} className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5"><Label htmlFor={`section-type-${index}`}>Seção {index + 1}</Label><select id={`section-type-${index}`} value={section.type} onChange={(e) => update(index, { type: e.target.value as LandingSection["type"] })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{TYPES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
            <div className="ml-auto flex gap-1">
              <Button variant="outline" size="icon" aria-label={`Mover seção ${index + 1} para cima`} disabled={index === 0} onClick={() => setSections(moveItem(sections, index, -1))}><ArrowUp className="size-4" /></Button>
              <Button variant="outline" size="icon" aria-label={`Mover seção ${index + 1} para baixo`} disabled={index === sections.length - 1} onClick={() => setSections(moveItem(sections, index, 1))}><ArrowDown className="size-4" /></Button>
              <Button variant="outline" size="icon" aria-label={`Excluir seção ${index + 1}`} onClick={() => setSections(sections.filter((_, position) => position !== index))}><Trash2 className="size-4" /></Button>
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor={`section-heading-${index}`}>Título</Label><Input id={`section-heading-${index}`} value={section.heading} maxLength={300} onChange={(e) => update(index, { heading: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor={`section-body-${index}`}>Texto</Label><Textarea id={`section-body-${index}`} value={section.body} maxLength={5000} rows={3} onChange={(e) => update(index, { body: e.target.value })} /></div>
        </li>)}</ol>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending || !title.trim() || !slug}>{pending ? "Salvando…" : "Salvar landing page"}</Button>
        <div aria-live="polite">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : dirty && <p className="text-sm text-amber-400">Há alterações não salvas.</p>}</div>
      </div>
    </div>

    <aside aria-label="Prévia da landing page" className="space-y-2">
      <h2 className="text-lg font-semibold">Prévia</h2>
      <div className="max-h-[70vh] space-y-px overflow-y-auto rounded-xl border border-border bg-[#050811] text-sm">
        {sections.length === 0 && <p className="p-6 text-muted-foreground">A prévia aparece aqui.</p>}
        {sections.map((section, index) => <div key={index} className={section.type === "hero" ? "bg-gradient-to-br from-primary/20 to-transparent p-6" : "border-t border-white/5 p-5"}>
          <p className="text-[10px] uppercase tracking-widest text-primary">{typeName(section.type)}</p>
          <p className={`mt-1 font-semibold ${section.type === "hero" ? "text-xl" : "text-base"}`}>{section.heading || "Título da seção"}</p>
          {section.body && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{section.body}</p>}
          {section.type === "form" && <div className="mt-3 space-y-2" aria-hidden><div className="h-8 rounded bg-white/10" /><div className="h-8 rounded bg-white/10" /><div className="h-8 w-28 rounded bg-primary/70" /></div>}
          {section.type === "cta" && <div className="mt-3 h-9 w-36 rounded-md bg-primary/80" aria-hidden />}
        </div>)}
      </div>
      <p className="text-xs text-muted-foreground">Endereço: /{slug || "sua-pagina"}</p>
    </aside>
  </div>;
}
