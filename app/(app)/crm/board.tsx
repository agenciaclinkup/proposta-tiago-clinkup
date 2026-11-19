"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, ArrowRight, Check, GripVertical, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { moveCardInBoard } from "@/lib/crm/board";
import { cn } from "@/lib/utils";
import {
  createLeadAction,
  createStageAction,
  deleteLeadAction,
  deleteStageAction,
  moveLeadAction,
  reorderStagesAction,
  updateStageAction,
} from "./actions";

export type BoardLead = {
  id: string;
  name: string;
  company: string | null;
  value: number | null;
  source: string;
};
export type BoardStage = { id: string; name: string; color: string; kind: string; leads: BoardLead[] };

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  hermes: "Hermes",
  scraping: "Extrator",
  landing_page: "Landing page",
  webhook: "Integração",
};
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const COLUMN_PREFIX = "column:";

export function KanbanBoard({ initialStages, isAdmin }: { initialStages: BoardStage[]; isAdmin: boolean }) {
  // Estado local para a atualização otimista; quando o servidor revalida, a nova lista substitui o estado.
  const [stages, setStages] = useState(initialStages);
  const [synced, setSynced] = useState(initialStages);
  if (synced !== initialStages) {
    setSynced(initialStages);
    setStages(initialStages);
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const leadName = (id: string | number) => stages.flatMap((s) => s.leads).find((l) => l.id === id)?.name ?? "lead";
  const stageOf = (id: string | number) => {
    const key = String(id);
    if (key.startsWith(COLUMN_PREFIX)) return stages.find((s) => s.id === key.slice(COLUMN_PREFIX.length));
    return stages.find((s) => s.leads.some((l) => l.id === key));
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Lead ${leadName(active.id)} selecionado. Use as setas para escolher a nova etapa e a posição.`,
    onDragOver: ({ active, over }) =>
      over ? `Lead ${leadName(active.id)} sobre a etapa ${stageOf(over.id)?.name ?? ""}.` : `Lead ${leadName(active.id)} fora das etapas.`,
    onDragEnd: ({ active, over }) =>
      over ? `Lead ${leadName(active.id)} solto na etapa ${stageOf(over.id)?.name ?? ""}.` : `Lead ${leadName(active.id)} voltou ao lugar.`,
    onDragCancel: ({ active }) => `Movimento cancelado. O lead ${leadName(active.id)} voltou ao lugar.`,
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    const leadId = String(active.id);
    const target = stageOf(over.id);
    if (!target) return;

    const columnWithout = target.leads.filter((l) => l.id !== leadId);
    const overIsColumn = String(over.id).startsWith(COLUMN_PREFIX);
    const overIndex = columnWithout.findIndex((l) => l.id === over.id);
    const index = overIsColumn || overIndex === -1 ? columnWithout.length : overIndex;

    const previous = stages;
    const next = moveCardInBoard(previous, leadId, target.id, index);
    if (next === previous) return;
    const before = previous.find((s) => s.leads.some((l) => l.id === leadId));
    if (before?.id === target.id && before.leads.findIndex((l) => l.id === leadId) === index) return;

    setStages(next);
    startTransition(async () => {
      const result = await moveLeadAction({ leadId, stageId: target.id, index });
      if (result.error) {
        setStages(previous);
        toast.error(`Não foi possível mover o lead: ${result.error}`);
      }
    });
  }

  const activeLead = activeId ? stages.flatMap((s) => s.leads).find((l) => l.id === activeId) : null;

  return (
    <DndContext
      // id estável: evita divergência de ids de acessibilidade entre servidor e navegador (hydration).
      id="crm-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active }: DragStartEvent) => setActiveId(String(active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Para mover um lead, pressione espaço ou Enter na alça. Use as setas para escolher a etapa e a posição e pressione espaço ou Enter de novo para soltar. Esc cancela.",
        },
      }}
    >
      <div className="flex gap-4 overflow-x-auto pb-4" role="list" aria-label="Etapas do funil">
        {stages.map((stage, index) => (
          <Column
            key={stage.id}
            stage={stage}
            isAdmin={isAdmin}
            canMoveLeft={index > 0}
            canMoveRight={index < stages.length - 1}
            onMove={(direction) => {
              const order = stages.map((s) => s.id);
              const swap = index + direction;
              [order[index], order[swap]] = [order[swap], order[index]];
              const previous = stages;
              setStages(order.map((id) => previous.find((s) => s.id === id)!));
              startTransition(async () => {
                const result = await reorderStagesAction(order);
                if (result.error) {
                  setStages(previous);
                  toast.error(result.error);
                }
              });
            }}
          />
        ))}
        {isAdmin && <NewStageColumn />}
      </div>
      <DragOverlay>{activeLead ? <LeadCardView lead={activeLead} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  isAdmin,
  canMoveLeft,
  canMoveRight,
  onMove,
}: {
  stage: BoardStage;
  isAdmin: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${stage.id}` });
  const [editing, setEditing] = useState(false);
  const total = stage.leads.reduce((sum, lead) => sum + (lead.value ?? 0), 0);

  return (
    <section
      role="listitem"
      aria-label={`Etapa ${stage.name}, ${stage.leads.length} leads`}
      className={cn("glass flex w-72 shrink-0 flex-col rounded-2xl", isOver && "ring-2 ring-primary/60")}
    >
      <header className="border-b border-border px-3 py-3">
        {editing ? (
          <StageEditForm stage={stage} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{stage.name}</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{stage.leads.length}</span>
            {isAdmin && (
              <div className="flex items-center">
                <Button variant="ghost" size="icon" className="size-7" onClick={() => onMove(-1)} disabled={!canMoveLeft} aria-label={`Mover a etapa ${stage.name} para a esquerda`}>
                  <ArrowLeft className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => onMove(1)} disabled={!canMoveRight} aria-label={`Mover a etapa ${stage.name} para a direita`}>
                  <ArrowRight className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(true)} aria-label={`Editar a etapa ${stage.name}`}>
                  <Pencil className="size-3.5" />
                </Button>
                <ConfirmActionButton
                  action={deleteStageAction}
                  fields={{ stageId: stage.id }}
                  confirmMessage={`Excluir a etapa “${stage.name}”? Só é possível excluir etapas sem leads.`}
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Excluir a etapa ${stage.name}`}
                >
                  <Trash2 className="size-3.5" />
                </ConfirmActionButton>
              </div>
            )}
          </div>
        )}
        {total > 0 && <p className="mt-1 text-xs text-muted-foreground">{brl.format(total)} em oportunidades</p>}
      </header>

      <SortableContext items={stage.leads.map((lead) => lead.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 p-3" aria-label={`Leads em ${stage.name}`}>
          {stage.leads.length === 0 && (
            <li className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Arraste um lead para cá ou adicione um novo abaixo.
            </li>
          )}
          {stage.leads.map((lead) => (
            <SortableLead key={lead.id} lead={lead} isAdmin={isAdmin} />
          ))}
        </ul>
      </SortableContext>

      <QuickAddLead stageId={stage.id} stageName={stage.name} />
    </section>
  );
}

function SortableLead({ lead, isAdmin }: { lead: BoardLead; isAdmin: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-40")}>
      <LeadCardView
        lead={lead}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
            aria-label={`Mover o lead ${lead.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        }
        actions={
          isAdmin && (
            <ConfirmActionButton
              action={deleteLeadAction}
              fields={{ leadId: lead.id }}
              confirmMessage={`Excluir o lead “${lead.name}”? O histórico dele também será apagado e não poderá ser recuperado.`}
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              aria-label={`Excluir o lead ${lead.name}`}
            >
              <Trash2 className="size-3.5" />
            </ConfirmActionButton>
          )
        }
      />
    </li>
  );
}

function LeadCardView({
  lead,
  handle,
  actions,
  dragging,
}: {
  lead: BoardLead;
  handle?: React.ReactNode;
  actions?: React.ReactNode;
  dragging?: boolean;
}) {
  return (
    <article className={cn("rounded-xl border border-border bg-card p-3 text-sm shadow-sm", dragging && "rotate-1 shadow-xl ring-2 ring-primary/50")}>
      <div className="flex items-start gap-1.5">
        {handle}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{lead.name}</p>
          {lead.company && <p className="truncate text-xs text-muted-foreground">{lead.company}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{SOURCE_LABEL[lead.source] ?? lead.source}</span>
        {lead.value ? <span className="font-medium text-primary">{brl.format(lead.value)}</span> : null}
      </div>
    </article>
  );
}

function QuickAddLead({ stageId, stageName }: { stageId: string; stageName: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createLeadAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      toast.success(state.success);
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    return (
      <div className="border-t border-border p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Adicionar lead
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-2 border-t border-border p-3" aria-label={`Novo lead em ${stageName}`}>
      <input type="hidden" name="stageId" value={stageId} />
      <Input name="name" placeholder="Nome do lead *" required maxLength={200} aria-label="Nome do lead" autoFocus />
      <Input name="company" placeholder="Empresa (opcional)" maxLength={200} aria-label="Empresa" />
      <Input name="value" type="number" min={0} step="0.01" placeholder="Valor estimado em R$ (opcional)" aria-label="Valor estimado em reais" />
      {state?.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Adicionar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function StageEditForm({ stage, onDone }: { stage: BoardStage; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateStageAction, undefined);
  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="stageId" value={stage.id} />
      <div className="flex items-center gap-2">
        <input
          type="color"
          name="color"
          defaultValue={stage.color}
          aria-label="Cor da etapa"
          className="h-8 w-9 shrink-0 cursor-pointer rounded border border-input bg-transparent"
        />
        <Input name="name" defaultValue={stage.name} maxLength={60} required aria-label="Nome da etapa" className="h-8" autoFocus />
      </div>
      {state?.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          <X className="size-3.5" /> Cancelar
        </Button>
      </div>
    </form>
  );
}

function NewStageColumn() {
  const [state, action, pending] = useActionState(createStageAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) {
      toast.success(state.success);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex w-64 shrink-0 flex-col gap-2 self-start rounded-2xl border border-dashed border-border p-3">
      <p className="text-sm font-medium">Nova etapa</p>
      <div className="flex items-center gap-2">
        <input type="color" name="color" defaultValue="#7C9CFF" aria-label="Cor da nova etapa" className="h-9 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent" />
        <Input name="name" placeholder="Ex.: Negociação" maxLength={60} required aria-label="Nome da nova etapa" />
      </div>
      {state?.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Adicionar etapa
      </Button>
    </form>
  );
}
