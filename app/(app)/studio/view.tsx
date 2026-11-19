"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Images, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CarouselEditor } from "./carousel-editor";
import { LandingEditor } from "./landing-editor";

export type SlideRole = "hook" | "content" | "cta";
export type StudioTheme = { primaryColor?: string; secondaryColor?: string; backgroundColor?: string; fontFamily?: string };
export type StudioCarousel = { id: string; title: string; status: "draft" | "ready"; theme: StudioTheme; updated_at: string; studio_slides: { position: number; role: SlideRole; heading: string; body: string; image_path: string | null }[] };
export type LandingSection = { type: "hero" | "content" | "features" | "testimonial" | "cta" | "form"; heading: string; body: string; imagePath: string | null };
export type StudioLanding = { id: string; title: string; slug: string; sections: LandingSection[]; pipeline_id: string | null; stage_id: string | null; published: boolean; updated_at: string };
export type StudioAccount = { id: string; provider: string; name: string };
export type StudioStage = { id: string; name: string; pipeline_id: string };
export type StudioCredits = { used: number; limit: number };

const nf = new Intl.NumberFormat("pt-BR");
const updated = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));

export function StudioView({ carousels, landingPages, accounts, stages, credits, aiProvider, orgSlug }: { carousels: StudioCarousel[]; landingPages: StudioLanding[]; accounts: StudioAccount[]; stages: StudioStage[]; credits: StudioCredits; aiProvider: boolean; orgSlug: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"carousels" | "landing">("carousels");
  const [carouselId, setCarouselId] = useState<string | null>(carousels[0]?.id ?? null);
  const [pageId, setPageId] = useState<string | null>(landingPages[0]?.id ?? null);
  const carousel = carouselId === "new" ? null : carousels.find((item) => item.id === carouselId);
  const page = pageId === "new" ? null : landingPages.find((item) => item.id === pageId);
  const saved = (select: (id: string) => void) => (id: string) => { select(id); router.refresh(); };
  const remaining = Math.max(credits.limit - credits.used, 0);

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Criação de conteúdo</p><h1 className="text-3xl font-semibold">Estúdio de criação</h1><p className="mt-1 text-sm text-muted-foreground">Monte carrosséis e landing pages com a identidade da sua marca e envie as peças prontas para o calendário editorial.</p></div>
      <section aria-label="Créditos de IA" className="glass w-full max-w-xs rounded-xl p-4 text-sm">
        <p className="flex items-center gap-2 font-medium"><Sparkles className="size-4 text-primary" aria-hidden /> Créditos de IA do mês</p>
        <p className="mt-1 text-2xl font-semibold">{nf.format(remaining)} <span className="text-sm font-normal text-muted-foreground">de {nf.format(credits.limit)} disponíveis</span></p>
        <Progress value={credits.limit ? Math.min((credits.used / credits.limit) * 100, 100) : 100} className="mt-2" aria-label={`${nf.format(credits.used)} créditos usados`} />
        <p className="mt-2 text-xs text-muted-foreground">{aiProvider ? "Cada geração com IA usa 1 crédito. Se a geração falhar, o crédito é devolvido automaticamente." : "Provedor de IA ainda não configurado: o Estúdio cria uma estrutura-base editável sem consumir créditos."}</p>
      </section>
    </header>

    <div role="tablist" aria-label="Tipo de projeto" className="flex gap-1">
      <Button role="tab" aria-selected={tab === "carousels"} variant={tab === "carousels" ? "secondary" : "ghost"} onClick={() => setTab("carousels")}><Images className="size-4" aria-hidden /> Carrosséis e peças</Button>
      <Button role="tab" aria-selected={tab === "landing"} variant={tab === "landing" ? "secondary" : "ghost"} onClick={() => setTab("landing")}><FileText className="size-4" aria-hidden /> Landing pages</Button>
    </div>

    {tab === "carousels" ? <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <ProjectList label="Seus carrosséis" empty="Nenhum carrossel ainda. Crie o primeiro para começar." newLabel="Novo carrossel" selected={carouselId} onSelect={setCarouselId}
        items={carousels.map((item) => ({ id: item.id, title: item.title, meta: `${item.status === "ready" ? "Concluído" : "Rascunho"} · ${item.studio_slides.length} ${item.studio_slides.length === 1 ? "slide" : "slides"} · ${updated(item.updated_at)}` }))} />
      {carouselId === null ? <EmptyState text="Selecione um carrossel ou crie um novo para editar os slides." />
        : carousel === undefined ? <EmptyState text="Carregando o projeto…" />
        : <CarouselEditor key={carousel ? `${carousel.id}:${carousel.updated_at}` : "new"} carousel={carousel} accounts={accounts} aiProvider={aiProvider} creditsLeft={remaining} onSaved={saved(setCarouselId)} />}
    </div> : <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <ProjectList label="Suas landing pages" empty="Nenhuma landing page ainda. Crie a primeira para captar leads." newLabel="Nova landing page" selected={pageId} onSelect={setPageId}
        items={landingPages.map((item) => ({ id: item.id, title: item.title, meta: `/${item.slug} · ${item.published ? "Publicada" : "Rascunho"}` }))} />
      {pageId === null ? <EmptyState text="Selecione uma landing page ou crie uma nova." />
        : page === undefined ? <EmptyState text="Carregando o projeto…" />
        : <LandingEditor key={page ? `${page.id}:${page.updated_at}` : "new"} page={page} stages={stages} orgSlug={orgSlug} onSaved={saved(setPageId)} />}
    </div>}
  </div>;
}

function ProjectList({ label, empty, newLabel, items, selected, onSelect }: { label: string; empty: string; newLabel: string; items: { id: string; title: string; meta: string }[]; selected: string | null; onSelect: (id: string) => void }) {
  return <nav aria-label={label} className="space-y-2">
    <Button className="w-full" onClick={() => onSelect("new")}><Plus className="size-4" aria-hidden /> {newLabel}</Button>
    {items.length === 0 && <p className="px-1 py-4 text-sm text-muted-foreground">{empty}</p>}
    <ul className="space-y-2">{items.map((item) => <li key={item.id}>
      <button type="button" onClick={() => onSelect(item.id)} aria-current={selected === item.id ? "true" : undefined} className={`w-full rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary ${selected === item.id ? "border-primary/60 bg-primary/10" : "border-border bg-card/40 hover:border-primary/40"}`}>
        <span className="block truncate font-medium">{item.title}</span><span className="block text-xs text-muted-foreground">{item.meta}</span>
      </button>
    </li>)}</ul>
  </nav>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</div>;
}
