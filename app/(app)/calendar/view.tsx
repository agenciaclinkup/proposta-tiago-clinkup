"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { canEditPost, statusLabel } from "@/lib/calendar/state";
import { prepareMediaUpload, savePostAction } from "./actions";

type Channel = "instagram" | "facebook" | "google_business";
type Media = { path: string; type: "image" | "video" };
export type CalendarIntegration = { id: string; provider: string; name: string };
export type CalendarPost = { id: string; status: string; format: string; caption: string; hashtags: string[]; media: Media[]; scheduled_at: string | null; social_post_targets: { channel: Channel; integration_id: string }[] };
const CHANNELS: { id: Channel; name: string; provider: string }[] = [
  { id: "instagram", name: "Instagram", provider: "instagram" }, { id: "facebook", name: "Facebook", provider: "facebook_page" }, { id: "google_business", name: "Google Meu Negócio", provider: "google_business" },
];
const FORMATS = [["feed", "Feed"], ["reels", "Reels"], ["stories", "Stories"], ["carousel", "Carrossel"], ["gmb_update", "Atualização Google"]];
const localDate = (value: string) => new Date(new Date(value).getTime() - 3 * 3600000).toISOString().slice(0, 16);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const dayName = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const today = () => new Date(new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10) + "T12:00:00Z");
const label = (post: CalendarPost) => post.caption.trim().slice(0, 55) || FORMATS.find(([id]) => id === post.format)?.[1] || "Post sem legenda";

export function CalendarView({ posts, accounts, truncated }: { posts: CalendarPost[]; accounts: CalendarIntegration[]; truncated: boolean }) {
  const [view, setView] = useState<"month" | "week" | "list">("month");
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<CalendarPost | null | "new">(null);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), view === "month" ? 1 : date.getUTCDate(), 12));
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const days = Array.from({ length: view === "month" ? 42 : 7 }, (_, index) => { const value = new Date(first); value.setUTCDate(value.getUTCDate() + index); return value; });
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    posts.filter((p) => p.scheduled_at).forEach((p) => { const key = localDate(p.scheduled_at!).slice(0, 10); map.set(key, [...(map.get(key) ?? []), p]); });
    return map;
  }, [posts]);
  const shift = (amount: number) => { const next = new Date(date); if (view === "month") { next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + amount); } else next.setUTCDate(next.getUTCDate() + 7 * amount); setDate(next); };
  const heading = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  const drafts = posts.filter((p) => !p.scheduled_at);
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Planejamento de conteúdo</p><h1 className="text-3xl font-semibold">Calendário editorial</h1><p className="mt-1 text-sm text-muted-foreground">Organize seus posts e acompanhe o que está preparado para cada canal.</p></div><Button onClick={() => setEditing("new")}><Plus className="size-4" /> Novo post</Button></header>
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">Um post agendado conta uma vez no limite mensal, mesmo com vários canais. Editar um agendamento não cobra novamente; voltar a rascunho não estorna, e agendar outra vez consome uma unidade. A publicação automática será disponibilizada em breve.</div>
    {truncated && <p role="status" className="text-sm text-amber-400">Mostrando os primeiros 1.000 posts. A paginação para volumes maiores será disponibilizada em breve.</p>}
    <section aria-label="Calendário de posts" className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Button variant="outline" size="icon" aria-label="Período anterior" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button><h2 className="min-w-36 text-center text-lg font-semibold capitalize">{heading}</h2><Button variant="outline" size="icon" aria-label="Próximo período" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button><Button variant="ghost" onClick={() => setDate(today())}>Hoje</Button></div><div className="flex gap-1" aria-label="Visão"><Button variant={view === "month" ? "secondary" : "ghost"} onClick={() => setView("month")}>Mês</Button><Button variant={view === "week" ? "secondary" : "ghost"} onClick={() => setView("week")}>Semana</Button><Button variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}>Lista</Button></div></div>
      {view === "list" ? <div className="space-y-2">{posts.length === 0 && <p className="py-6 text-sm text-muted-foreground">Nenhum post ainda. Crie um rascunho para começar.</p>}{posts.map((post) => <PostButton key={post.id} post={post} onClick={() => setEditing(post)} />)}</div> : <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-7 text-center text-xs text-muted-foreground">{dayName.map((name) => <div key={name} className="pb-2">{name}</div>)}</div><div className="grid grid-cols-7 border-l border-t border-border">{days.map((day) => { const key = dateKey(day); const entries = grouped.get(key) ?? []; return <div key={key} className={`min-h-28 border-b border-r border-border p-2 ${day.getUTCMonth() !== date.getUTCMonth() && view === "month" ? "opacity-50" : ""}`}><div className={`mb-1 text-sm ${key === dateKey(today()) ? "font-bold text-primary" : "text-muted-foreground"}`}>{day.getUTCDate()}</div><div className="space-y-1">{entries.map((post) => <PostButton compact key={post.id} post={post} onClick={() => setEditing(post)} />)}</div></div>; })}</div></div></div>}
    </section>
    {view !== "list" && <section><h2 className="mb-3 text-lg font-semibold">Rascunhos sem data</h2>{drafts.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{drafts.map((post) => <PostButton key={post.id} post={post} onClick={() => setEditing(post)} />)}</div> : <p className="text-sm text-muted-foreground">Nenhum rascunho sem data.</p>}</section>}
    {editing && <PostEditor key={editing === "new" ? "new" : editing.id} post={editing === "new" ? null : editing} accounts={accounts} onClose={() => setEditing(null)} />}
  </div>;
}

function PostButton({ post, onClick, compact = false }: { post: CalendarPost; onClick: () => void; compact?: boolean }) {
  return <button type="button" onClick={onClick} className={`w-full rounded-md border border-border bg-background/60 text-left hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary ${compact ? "p-1.5 text-xs" : "p-3 text-sm"}`}><span className="block truncate font-medium">{label(post)}</span><span className="block text-xs text-muted-foreground">{post.scheduled_at ? `${localDate(post.scheduled_at).slice(11)} · ` : ""}{statusLabel(post.status)}</span></button>;
}

function PostEditor({ post, accounts, onClose }: { post: CalendarPost | null; accounts: CalendarIntegration[]; onClose: () => void }) {
  const [format, setFormat] = useState(post?.format ?? "feed");
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [hashtags, setHashtags] = useState(post?.hashtags.join(" ") ?? "");
  const [date, setDate] = useState(post?.scheduled_at ? localDate(post.scheduled_at) : "");
  const [targets, setTargets] = useState<Record<string, string>>(Object.fromEntries(post?.social_post_targets.map((target) => [target.channel, target.integration_id]) ?? []));
  const [media, setMedia] = useState<Media[]>(post?.media ?? []);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const editable = canEditPost(post?.status ?? null);
  async function upload(file: File) {
    setError(""); setUploading(true);
    try {
      if (media.length >= 10) throw new Error("Cada post aceita até 10 arquivos.");
      const result = await prepareMediaUpload({ type: file.type, size: file.size });
      if (!result.path || !result.token) throw new Error(result.error ?? "Não foi possível enviar a mídia.");
      const { error: uploadError } = await createClient().storage.from("social-media").uploadToSignedUrl(result.path, result.token, file, { contentType: file.type });
      if (uploadError) throw new Error("Não foi possível enviar a mídia. Tente novamente.");
      setMedia((current) => [...current, { path: result.path!, type: file.type.startsWith("video/") ? "video" : "image" }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha no envio da mídia."); } finally { setUploading(false); }
  }
  function save(status: "draft" | "scheduled") {
    setError("");
    const payload = { postId: post?.id, status, post: { format, caption, hashtags: hashtags.split(/[\s,]+/).filter(Boolean), media, targets: Object.entries(targets).filter(([, id]) => id).map(([channel, integrationId]) => ({ channel, integrationId })), scheduledAt: date ? `${date}:00-03:00` : null } };
    start(async () => { const result = await savePostAction(payload); if (result.error) setError(result.error); else onClose(); });
  }
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="my-4 w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-2xl sm:p-6"><div className="mb-5 flex items-center justify-between gap-3"><h2 id="editor-title" className="text-xl font-semibold">{post ? "Detalhes do post" : "Novo post"}</h2><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
    {!editable && <p className="mb-4 text-sm text-muted-foreground">Este post está {statusLabel(post!.status).toLowerCase()} e não pode ser editado.</p>}
    <fieldset disabled={!editable || pending || uploading} className="space-y-4 disabled:opacity-60">
      <div className="space-y-1.5"><Label htmlFor="post-format">Formato</Label><select id="post-format" value={format} onChange={(e) => setFormat(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{FORMATS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
      <div className="space-y-2"><p className="text-sm font-medium">Canais e contas</p>{CHANNELS.map((channel) => <div key={channel.id}><Label htmlFor={`channel-${channel.id}`} className="mb-1 block">{channel.name}</Label><select id={`channel-${channel.id}`} value={targets[channel.id] ?? ""} onChange={(e) => setTargets({ ...targets, [channel.id]: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Não usar este canal</option>{accounts.filter((account) => account.provider === channel.provider).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}{targets[channel.id] && !accounts.some((account) => account.id === targets[channel.id]) && <option value={targets[channel.id]}>Conta indisponível — reconecte</option>}</select></div>)}<p className="text-xs text-muted-foreground">Não encontrou sua conta? <Link href="/integrations" className="text-primary underline">Conecte em Integrações</Link>.</p></div>
      <div className="space-y-1.5"><Label htmlFor="post-caption">Legenda</Label><Textarea id="post-caption" rows={4} maxLength={10000} value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="post-hashtags">Hashtags</Label><Input id="post-hashtags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#conteúdo #marca" /><p className="text-xs text-muted-foreground">Separe por espaços ou vírgulas.</p></div>
      <div className="space-y-1.5"><Label htmlFor="post-media">Mídia</Label><Input id="post-media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} /><p className="text-xs text-muted-foreground">JPEG, PNG, WebP ou MP4, até 50 MB por arquivo. {uploading && "Enviando…"}</p>{media.map((item, index) => <div key={item.path} className="flex items-center justify-between gap-2 text-sm"><span>{item.type === "image" ? "Imagem" : "Vídeo"} {index + 1}</span><Button type="button" variant="ghost" size="sm" onClick={() => setMedia(media.filter((_, i) => i !== index))}>Remover</Button></div>)}</div>
      <div className="space-y-1.5"><Label htmlFor="post-date">Data e horário de Brasília</Label><Input id="post-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {editable && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => save("draft")}>Salvar rascunho</Button><Button type="button" onClick={() => save("scheduled")}>Agendar post</Button></div>}
    </fieldset>
  </div></div>;
}
