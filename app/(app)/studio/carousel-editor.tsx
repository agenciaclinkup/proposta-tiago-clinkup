"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { SLIDE_HEIGHT, SLIDE_WIDTH, SlideArt } from "@/components/studio/slide-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { exportBlocker, moveItem } from "@/lib/studio/editor";
import { createClient } from "@/lib/supabase/client";
import { exportCarouselAction, generateCarouselAction, prepareStudioUploadAction, saveCarouselAction, studioAssetUrlsAction } from "./actions";
import type { SlideRole, StudioAccount, StudioCarousel, StudioTheme } from "./view";

type Slide = { role: SlideRole; heading: string; body: string; imagePath: string | null };
const ROLES: [SlideRole, string][] = [["hook", "Gancho"], ["content", "Conteúdo"], ["cta", "Chamada para ação"]];
const FONTS = ["Inter", "Plus Jakarta Sans"];
const CHANNELS = [{ id: "instagram", name: "Instagram", provider: "instagram" }, { id: "facebook", name: "Facebook", provider: "facebook_page" }, { id: "google_business", name: "Google Meu Negócio", provider: "google_business" }] as const;
const DEFAULT_THEME = { primaryColor: "#00D4FF", secondaryColor: "#2563EB", backgroundColor: "#050811", fontFamily: "Inter" };
const roleName = (role: SlideRole) => ROLES.find(([id]) => id === role)?.[1] ?? role;

function Preview({ slide, theme, index, total, url, width }: { slide: Slide; theme: StudioTheme; index: number; total: number; url: string | null; width: number }) {
  const scale = width / SLIDE_WIDTH;
  return <div style={{ width, height: SLIDE_HEIGHT * scale }} className="overflow-hidden rounded-lg border border-border">
    <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}><SlideArt slide={slide} theme={theme} index={index} total={total} backgroundUrl={url} /></div>
  </div>;
}

export function CarouselEditor({ carousel, accounts, aiProvider, creditsLeft, onSaved }: { carousel: StudioCarousel | null; accounts: StudioAccount[]; aiProvider: boolean; creditsLeft: number; onSaved: (id: string) => void }) {
  const initial = useMemo(() => ({
    title: carousel?.title ?? "", status: carousel?.status ?? "draft", theme: { ...DEFAULT_THEME, ...carousel?.theme },
    slides: carousel ? [...carousel.studio_slides].sort((a, b) => a.position - b.position).map((s): Slide => ({ role: s.role, heading: s.heading, body: s.body, imagePath: s.image_path }))
      : [{ role: "hook", heading: "", body: "", imagePath: null }, { role: "cta", heading: "", body: "", imagePath: null }] as Slide[],
  }), [carousel]);
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<"draft" | "ready">(initial.status);
  const [theme, setTheme] = useState<StudioTheme>(initial.theme);
  const [slides, setSlides] = useState<Slide[]>(initial.slides);
  const [current, setCurrent] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(5);
  const [pendingRequest, setPendingRequest] = useState<{ requestId: string; prompt: string; slideCount: number } | null>(null);
  const [mode, setMode] = useState<"draft" | "scheduled">("draft");
  const [date, setDate] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify({ title, status, theme, slides }) !== JSON.stringify(initial);
  const slide = slides[Math.min(current, slides.length - 1)];
  const blocker = exportBlocker({ saved: Boolean(carousel), dirty, status, slides: slides.length });

  useEffect(() => {
    const paths = [...new Set(initial.slides.flatMap((item) => item.imagePath ?? []))];
    if (paths.length) studioAssetUrlsAction(paths).then((result) => { if ("urls" in result) setUrls((known) => ({ ...result.urls, ...known })); });
  }, [initial]);

  const update = (patch: Partial<Slide>) => setSlides((list) => list.map((item, index) => (index === current ? { ...item, ...patch } : item)));
  const payload = () => ({ carouselId: carousel?.id, title, status, theme, slides });
  // Sucesso vira toast: o editor remonta após router.refresh() e perderia a mensagem.
  const feedback = (message: string, ok = false) => { setError(ok ? "" : message); setNotice(""); if (ok && message) toast.success(message); };
  const inform = (message: string) => { setError(""); setNotice(message); };

  function save() {
    feedback("");
    start(async () => {
      const result = await saveCarouselAction(payload());
      if ("error" in result) feedback(result.error); else { feedback("Carrossel salvo.", true); onSaved(result.id); }
    });
  }

  async function upload(file: File) {
    feedback(""); setUploading(true);
    try {
      const result = await prepareStudioUploadAction({ type: file.type, size: file.size });
      if ("error" in result) throw new Error(result.error);
      const { error: uploadError } = await createClient().storage.from("studio-assets").uploadToSignedUrl(result.path, result.token, file, { contentType: file.type });
      if (uploadError) throw new Error("Não foi possível enviar a imagem. Tente novamente.");
      setUrls((known) => ({ ...known, [result.path]: URL.createObjectURL(file) }));
      update({ imagePath: result.path });
    } catch (reason) { feedback(reason instanceof Error ? reason.message : "Falha no envio da imagem."); } finally { setUploading(false); }
  }

  function generate(retry = false) {
    if (!carousel) { feedback("Salve o carrossel antes de gerar com IA."); return; }
    if (!retry && slides.some((item) => item.heading || item.body) && !window.confirm(`Os slides atuais serão substituídos pelo conteúdo gerado.${dirty ? " Alterações não salvas serão perdidas." : ""}${aiProvider ? " Esta geração usa 1 crédito de IA." : ""} Deseja continuar?`)) return;
    const request = retry && pendingRequest ? pendingRequest : { requestId: crypto.randomUUID(), prompt, slideCount: count };
    feedback("");
    start(async () => {
      const result = await generateCarouselAction({ ...request, carouselId: carousel.id });
      if ("error" in result) { feedback(result.error); setPendingRequest(null); return; }
      if (result.status === "started") { setPendingRequest(request); inform("A geração ainda está em andamento. Aguarde alguns segundos e confira novamente."); return; }
      setPendingRequest(null);
      if (result.status === "failed") { feedback(result.message ?? "A geração não foi concluída. Tente novamente."); return; }
      feedback(result.charged ? "Slides gerados com IA (1 crédito usado)." : "Slides gerados. Revise os textos antes de concluir.", true);
      onSaved(carousel.id);
    });
  }

  function exportToCalendar() {
    if (!carousel || blocker) return;
    const chosen = Object.entries(targets).filter(([, id]) => id).map(([channel, integrationId]) => ({ channel, integrationId }));
    if (mode === "scheduled" && (!date || chosen.length === 0)) { feedback("Para agendar, escolha data, horário e ao menos uma conta."); return; }
    feedback("");
    start(async () => {
      const result = await exportCarouselAction({ carouselId: carousel.id, schedule: mode === "scheduled" ? { scheduledAt: `${date}:00-03:00`, targets: chosen } : null });
      if ("error" in result) feedback(result.error);
      else feedback(mode === "scheduled" ? "Post agendado no calendário editorial." : "Rascunho criado no calendário editorial.", true);
    });
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1 space-y-1.5"><Label htmlFor="carousel-title">Nome do projeto</Label><Input id="carousel-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Campanha de novembro" /></div>
      <div className="space-y-1.5"><Label htmlFor="carousel-status">Situação</Label><select id="carousel-status" value={status} onChange={(e) => setStatus(e.target.value as "draft" | "ready")} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="draft">Rascunho</option><option value="ready">Concluído</option></select></div>
      <Button onClick={save} disabled={pending || uploading || !title.trim()}>{pending ? "Salvando…" : "Salvar"}</Button>
    </div>
    <div aria-live="polite">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p className="text-sm text-emerald-400">{notice}</p>}{dirty && !error && !notice && <p className="text-sm text-amber-400">Há alterações não salvas.</p>}</div>

    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <fieldset className="grid gap-3 rounded-xl border border-border bg-card/40 p-4 sm:grid-cols-4">
          <legend className="px-1 text-sm font-medium">Identidade visual</legend>
          {([["primaryColor", "Cor principal"], ["secondaryColor", "Cor secundária"], ["backgroundColor", "Fundo"]] as const).map(([key, name]) =>
            <div key={key} className="space-y-1.5"><Label htmlFor={`theme-${key}`}>{name}</Label><input id={`theme-${key}`} type="color" value={theme[key]} onChange={(e) => setTheme({ ...theme, [key]: e.target.value })} className="h-10 w-full cursor-pointer rounded-md border border-input bg-background" /></div>)}
          <div className="space-y-1.5"><Label htmlFor="theme-font">Fonte</Label><select id="theme-font" value={theme.fontFamily} onChange={(e) => setTheme({ ...theme, fontFamily: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{FONTS.map((font) => <option key={font}>{font}</option>)}</select></div>
        </fieldset>

        <section aria-label="Slides" className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Slides ({slides.length}/20)</h2><Button variant="outline" size="sm" disabled={slides.length >= 20} onClick={() => { setSlides([...slides.slice(0, -1), { role: "content", heading: "", body: "", imagePath: null }, ...slides.slice(-1)]); setCurrent(Math.max(slides.length - 1, 0)); }}><Plus className="size-4" aria-hidden /> Adicionar slide</Button></div>
          <ol className="flex gap-3 overflow-x-auto pb-2">{slides.map((item, index) => <li key={index} className="shrink-0">
            <button type="button" onClick={() => setCurrent(index)} aria-label={`Editar slide ${index + 1}: ${roleName(item.role)}`} aria-current={index === current ? "true" : undefined} className={`block rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-primary ${index === current ? "ring-2 ring-primary" : ""}`}>
              <Preview slide={item} theme={theme} index={index} total={slides.length} url={item.imagePath ? urls[item.imagePath] ?? null : null} width={96} />
              <span className="mt-1 block text-center text-xs text-muted-foreground">{index + 1}. {roleName(item.role)}</span>
            </button>
          </li>)}</ol>
          {slides.length === 0 && <p className="text-sm text-muted-foreground">Nenhum slide. Adicione um slide ou gere com IA.</p>}
          {slide && <div className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label htmlFor="slide-role">Tipo do slide {current + 1}</Label><select id="slide-role" value={slide.role} onChange={(e) => update({ role: e.target.value as SlideRole })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{ROLES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
              <div className="ml-auto flex gap-1">
                <Button variant="outline" size="icon" aria-label="Mover slide para a esquerda" disabled={current === 0} onClick={() => { setSlides(moveItem(slides, current, -1)); setCurrent(current - 1); }}><ArrowUp className="size-4 -rotate-90" /></Button>
                <Button variant="outline" size="icon" aria-label="Mover slide para a direita" disabled={current >= slides.length - 1} onClick={() => { setSlides(moveItem(slides, current, 1)); setCurrent(current + 1); }}><ArrowDown className="size-4 -rotate-90" /></Button>
                <Button variant="outline" size="icon" aria-label="Excluir slide" onClick={() => { setSlides(slides.filter((_, index) => index !== current)); setCurrent(Math.max(current - 1, 0)); }}><Trash2 className="size-4" /></Button>
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="slide-heading">Título</Label><Input id="slide-heading" value={slide.heading} maxLength={300} onChange={(e) => update({ heading: e.target.value })} placeholder="Uma frase curta que prenda a atenção" /></div>
            <div className="space-y-1.5"><Label htmlFor="slide-body">Texto</Label><Textarea id="slide-body" value={slide.body} maxLength={3000} rows={4} onChange={(e) => update({ body: e.target.value })} placeholder="Explique o ponto principal deste slide" /></div>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="slide-image" className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"><ImagePlus className="size-4" aria-hidden /> {uploading ? "Enviando…" : slide.imagePath ? "Trocar imagem de fundo" : "Adicionar imagem de fundo"}</Label>
              <input id="slide-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
              {slide.imagePath && <Button variant="ghost" size="sm" onClick={() => update({ imagePath: null })}><X className="size-4" aria-hidden /> Remover imagem</Button>}
              <span className="text-xs text-muted-foreground">JPEG, PNG ou WebP até 50 MB.</span>
            </div>
          </div>}
        </section>
      </div>

      <aside className="space-y-5">
        <section aria-label="Prévia do slide" className="space-y-2">
          <h2 className="text-lg font-semibold">Prévia em tempo real</h2>
          {slide ? <Preview slide={slide} theme={theme} index={current} total={slides.length} url={slide.imagePath ? urls[slide.imagePath] ?? null : null} width={320} /> : <p className="text-sm text-muted-foreground">Adicione um slide para ver a prévia.</p>}
          <p className="text-xs text-muted-foreground">Formato retrato 1080×1350, ideal para o feed do Instagram.</p>
        </section>

        <section aria-label="Gerar com IA" className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" aria-hidden /> Gerar com IA</h2>
          <p className="text-xs text-muted-foreground">{aiProvider ? `O Hermes escreve os slides usando o contexto da sua marca. Usa 1 crédito (você tem ${creditsLeft}); se falhar, o crédito volta.` : "Sem provedor de IA configurado, criamos uma estrutura-base para você completar, sem consumir créditos."}</p>
          <div className="space-y-1.5"><Label htmlFor="ai-prompt">O que você quer comunicar?</Label><Textarea id="ai-prompt" value={prompt} maxLength={5000} rows={4} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: Carrossel explicando 3 benefícios do clareamento dental, com convite para agendar avaliação." /></div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5"><Label htmlFor="ai-count">Slides</Label><select id="ai-count" value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{Array.from({ length: 10 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></div>
            <Button className="flex-1" onClick={() => generate()} disabled={pending || !prompt.trim() || !carousel || (aiProvider && creditsLeft <= 0)}>{pending ? "Gerando…" : "Gerar slides"}</Button>
          </div>
          {pendingRequest && <Button variant="outline" className="w-full" disabled={pending} onClick={() => generate(true)}>Conferir geração em andamento</Button>}
          {!carousel && <p className="text-xs text-muted-foreground">Salve o carrossel para liberar a geração com IA.</p>}
          {aiProvider && creditsLeft <= 0 && <p className="text-xs text-amber-400">Seus créditos de IA deste mês acabaram. <Link href="/billing" className="underline">Conheça os planos</Link>.</p>}
        </section>

        <section aria-label="Enviar ao calendário" className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Send className="size-4 text-primary" aria-hidden /> Enviar ao calendário</h2>
          <p className="text-xs text-muted-foreground">Cada slide vira uma imagem 1080×1350. Nada é publicado automaticamente: você revisa o post no <Link href="/calendar" className="underline">calendário editorial</Link>.</p>
          <fieldset className="space-y-2 text-sm"><legend className="sr-only">Como enviar</legend>
            <label className="flex items-center gap-2"><input type="radio" name="export-mode" checked={mode === "draft"} onChange={() => setMode("draft")} /> Criar rascunho sem data</label>
            <label className="flex items-center gap-2"><input type="radio" name="export-mode" checked={mode === "scheduled"} onChange={() => setMode("scheduled")} /> Agendar para data e horário</label>
          </fieldset>
          {mode === "scheduled" && <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="export-date">Data e horário (Brasília)</Label><Input id="export-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            {CHANNELS.map((channel) => { const options = accounts.filter((account) => account.provider === channel.provider); return <div key={channel.id} className="space-y-1.5">
              <Label htmlFor={`export-${channel.id}`}>{channel.name}</Label>
              <select id={`export-${channel.id}`} value={targets[channel.id] ?? ""} disabled={!options.length} onChange={(e) => setTargets({ ...targets, [channel.id]: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"><option value="">{options.length ? "Não publicar neste canal" : "Nenhuma conta conectada"}</option>{options.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
            </div>; })}
            {!accounts.length && <p className="text-xs text-muted-foreground">Conecte suas contas em <Link href="/integrations" className="underline">Integrações</Link> para agendar.</p>}
            <p className="text-xs text-muted-foreground">O agendamento conta 1 post no limite mensal do seu plano.</p>
          </div>}
          {blocker && <p className="text-xs text-amber-400">{blocker}</p>}
          <Button className="w-full" variant="secondary" disabled={pending || Boolean(blocker)} onClick={exportToCalendar}>{pending ? "Enviando…" : mode === "scheduled" ? "Agendar no calendário" : "Criar rascunho no calendário"}</Button>
        </section>
      </aside>
    </div>
  </div>;
}
