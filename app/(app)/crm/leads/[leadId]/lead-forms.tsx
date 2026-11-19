"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addLeadNoteAction, moveLeadAction, updateLeadAction, scheduleLeadMeetingAction } from "../../actions";

export function MeetingForm({ leadId, email }: { leadId: string; email: string | null }) {
  const [state, action, pending] = useActionState(scheduleLeadMeetingAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="leadId" value={leadId} />
      <p className="text-sm text-muted-foreground">O convite será enviado para {email || "o e-mail cadastrado na ficha do lead"}. Conecte o Google Calendar em <a href="/integrations" className="text-primary underline">Integrações</a>.</p>
      <div className="space-y-1.5"><Label htmlFor="meeting-title">Título</Label><Input id="meeting-title" name="title" required maxLength={200} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="meeting-start">Data e horário de Brasília</Label><Input id="meeting-start" name="startAt" type="datetime-local" required /></div>
        <div className="space-y-1.5"><Label htmlFor="meeting-duration">Duração (minutos)</Label><Input id="meeting-duration" name="durationMinutes" type="number" min={5} max={480} defaultValue={30} required /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="meeting-description">Descrição</Label><Textarea id="meeting-description" name="description" rows={3} maxLength={5000} /></div>
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state?.success && <p role="status" className="text-sm text-primary">{state.success}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Agendando…" : "Agendar e enviar convite"}</Button>
    </form>
  );
}

type EditableLead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  website: string | null;
  value: number | null;
  notes: string | null;
};

const FIELDS: { name: keyof EditableLead; label: string; type?: string; placeholder?: string; inputMode?: "tel" | "decimal" }[] = [
  { name: "name", label: "Nome *" },
  { name: "company", label: "Empresa" },
  { name: "whatsapp", label: "WhatsApp", inputMode: "tel", placeholder: "(11) 98765-4321" },
  { name: "phone", label: "Telefone", inputMode: "tel" },
  { name: "email", label: "E-mail", type: "email" },
  { name: "instagram", label: "Instagram", placeholder: "@perfil" },
  { name: "website", label: "Site", type: "url", placeholder: "https://" },
  { name: "value", label: "Valor estimado (R$)", type: "number", inputMode: "decimal" },
];

export function LeadEditForm({ lead }: { lead: EditableLead }) {
  const [state, action, pending] = useActionState(updateLeadAction, undefined);
  useEffect(() => {
    if (state?.success) toast.success(state.success);
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="leadId" value={lead.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={`lead-${field.name}`}>{field.label}</Label>
            <Input
              id={`lead-${field.name}`}
              name={field.name}
              type={field.type ?? "text"}
              inputMode={field.inputMode}
              min={field.type === "number" ? 0 : undefined}
              step={field.type === "number" ? "0.01" : undefined}
              placeholder={field.placeholder}
              defaultValue={lead[field.name] ?? ""}
              required={field.name === "name"}
            />
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lead-notes">Observações</Label>
        <Textarea id="lead-notes" name="notes" rows={3} maxLength={5000} defaultValue={lead.notes ?? ""} />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar dados
      </Button>
    </form>
  );
}

export function LeadStageSelect({
  leadId,
  currentStageId,
  stages,
}: {
  leadId: string;
  currentStageId: string;
  stages: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(currentStageId);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="lead-stage" className="sr-only">
        Etapa do lead
      </label>
      <select
        id="lead-stage"
        value={value}
        disabled={pending}
        onChange={(event) => {
          const stageId = event.target.value;
          const previous = value;
          setValue(stageId);
          startTransition(async () => {
            // Índice alto = fim da coluna (o service limita ao tamanho real).
            const result = await moveLeadAction({ leadId, stageId, index: 100_000 });
            if (result.error) {
              setValue(previous);
              toast.error(`Não foi possível mudar a etapa: ${result.error}`);
            } else {
              toast.success("Etapa atualizada.");
            }
          });
        }}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id} className="bg-card">
            {stage.name}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Salvando" />}
    </div>
  );
}

export function NoteForm({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState(addLeadNoteAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <Label htmlFor="new-note">Nova anotação</Label>
      <Textarea id="new-note" name="content" rows={3} maxLength={5000} placeholder="Ex.: Pediu proposta com parcelamento. Retornar na sexta." required />
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Adicionar anotação
      </Button>
    </form>
  );
}
