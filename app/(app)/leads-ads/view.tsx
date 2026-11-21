"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { recoverSearchAction, sendProspectsAction } from "./actions";

export type Search = { id: string; niche: string; location: string; status: string; results_count: number; created_at: string };
export type Prospect = { id: string; name: string; category: string | null; city: string | null; address: string | null; phone: string | null; website: string | null; status: string; crm_lead_id: string | null };
export type Stage = { id: string; name: string };

export function ProspectingView({ searches, prospects, stages, credits }: { searches: Search[]; prospects: Prospect[]; stages: Stage[]; credits: { used: number; limit: number } }) {
  const router = useRouter(); const [selected, setSelected] = useState<string[]>([]); const [stage, setStage] = useState(stages[0]?.id ?? "");
  const [message, setMessage] = useState(""); const [pending, start] = useTransition();
  function submit() {
    setMessage(""); start(async () => {
      const result = await sendProspectsAction({ prospectIds: selected, stageId: stage });
      if ("error" in result) setMessage(result.error);
      else { setMessage(`${result.sent} lead(s) enviado(s).${result.errors.length ? ` ${result.errors[0]}` : ""}`); setSelected([]); router.refresh(); }
    });
  }
  function recover(id: string) {
    setMessage(""); start(async () => {
      const result = await recoverSearchAction(id);
      if ("error" in result) setMessage(result.error);
      else { setMessage(result.status === "running" ? "A busca ainda está em andamento. Aguarde e confira novamente." : "Situação da busca atualizada."); router.refresh(); }
    });
  }
  return <main className="mx-auto max-w-7xl space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm text-muted-foreground">Leads & Ads</p><h1 className="text-3xl font-semibold">Prospecção</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Revise as empresas encontradas e envie oportunidades para o seu funil.</p></div><div className="rounded-xl border border-border bg-card/50 px-5 py-4"><p className="text-sm text-muted-foreground">Extrações disponíveis neste mês</p><p className="mt-1 text-2xl font-semibold">{Math.max(credits.limit - credits.used, 0).toLocaleString("pt-BR")} <span className="text-sm font-normal text-muted-foreground">de {credits.limit.toLocaleString("pt-BR")}</span></p></div></header>
    <section className="rounded-xl border border-border bg-card/40 p-5"><h2 className="text-lg font-semibold">Encontrar empresas</h2><p className="mt-2 text-sm text-muted-foreground">A busca de novas empresas está indisponível enquanto a fonte de dados é configurada. Você pode trabalhar com os resultados já existentes abaixo.</p></section>
    <section className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-semibold">Resultados encontrados</h2><p className="text-sm text-muted-foreground">Mostrando até 100 resultados da sua empresa.</p></div><div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="prospect-stage">Etapa de destino</Label><select id="prospect-stage" value={stage} onChange={(event) => setStage(event.target.value)} className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm">{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><Button disabled={!selected.length || !stage || pending} onClick={submit}>{pending ? "Enviando…" : `Enviar ao CRM (${selected.length})`}</Button></div></div>
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      {prospects.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">Ainda não há resultados para revisar.</p> : <ul className="space-y-2">{prospects.map((prospect) => <li key={prospect.id} className="flex items-start gap-3 rounded-lg border border-border bg-card/40 p-4"><input type="checkbox" className="mt-1" aria-label={`Selecionar ${prospect.name}`} checked={selected.includes(prospect.id)} disabled={prospect.status !== "new" || pending} onChange={(event) => setSelected((current) => event.target.checked ? [...current, prospect.id] : current.filter((id) => id !== prospect.id))} /><div className="min-w-0 flex-1"><p className="font-medium">{prospect.name}</p><p className="text-sm text-muted-foreground">{[prospect.category, prospect.city, prospect.address, prospect.phone].filter(Boolean).join(" · ")}</p></div><span className="text-xs text-muted-foreground">{prospect.crm_lead_id ? "Enviado ao CRM" : prospect.status === "new" ? "Disponível" : "Indisponível"}</span></li>)}</ul>}
    </section>
    <section><h2 className="text-xl font-semibold">Buscas anteriores</h2>{searches.length ? <ul className="mt-3 space-y-2">{searches.map((search) => <li key={search.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"><span><span className="font-medium">{search.niche}</span> em {search.location} · {search.results_count} resultado(s) · {search.status === "succeeded" ? "Concluída" : search.status === "running" ? "Em andamento" : "Não concluída"}</span>{search.status === "running" && <Button variant="outline" size="sm" disabled={pending} onClick={() => recover(search.id)}>Verificar busca</Button>}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Nenhuma busca registrada ainda.</p>}</section>
  </main>;
}
