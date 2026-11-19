import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlan } from "@/config/plans";
import { serviceContext } from "@/lib/services/context";
import { getDefaultBoard } from "@/lib/services/crm";
import { requireWorkspace } from "@/lib/workspace";
import { KanbanBoard, type BoardStage } from "./board";
import { FunnelView } from "./funnel-view";

export const metadata: Metadata = { title: "CRM" };

const TABS = [
  { view: "quadro", label: "Quadro" },
  { view: "funil", label: "Funil" },
] as const;

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "funil" ? "funil" : "quadro";
  const workspace = await requireWorkspace();
  const board = await getDefaultBoard(serviceContext(workspace, "manual"));
  const isAdmin = workspace.role !== "member";
  const totalLeads = board.stages.reduce((sum, stage) => sum + stage.leads.length, 0);
  const limit = getPlan(workspace.organization.plan_id)?.limits.crmLeads;

  const stages: BoardStage[] = board.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color,
    kind: stage.kind,
    leads: stage.leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      company: lead.company,
      value: lead.value === null ? null : Number(lead.value),
      source: lead.source,
    })),
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">CRM</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Acompanhe cada oportunidade no {board.pipeline.name}. Arraste os cards pela alça ⋮⋮ (ou use o teclado: espaço e
            setas) para mudar a etapa — cada mudança fica registrada no histórico do lead.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {totalLeads.toLocaleString("pt-BR")}
            {limit ? ` de ${limit.toLocaleString("pt-BR")}` : ""} leads no CRM do seu plano.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hermes">
            <Bot className="size-4" /> Pedir ao Hermes
          </Link>
        </Button>
      </header>

      <nav aria-label="Visões do CRM" className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.view}
            href={tab.view === "quadro" ? "/crm" : `/crm?view=${tab.view}`}
            aria-current={view === tab.view ? "page" : undefined}
            className={
              view === tab.view
                ? "-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
                : "px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {view === "funil" ? (
        <FunnelView stages={stages} />
      ) : (
        <>
          {!isAdmin && (
            <p role="note" className="rounded-lg border border-border bg-secondary/50 p-3 text-sm text-muted-foreground">
              Você pode adicionar e mover leads. Apenas proprietários e administradores podem alterar as etapas do funil e
              excluir leads.
            </p>
          )}
          <KanbanBoard initialStages={stages} isAdmin={isAdmin} />
        </>
      )}
    </div>
  );
}
