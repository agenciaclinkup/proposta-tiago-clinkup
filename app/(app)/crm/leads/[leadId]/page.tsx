import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  CalendarClock,
  Globe,
  AtSign,
  Mail,
  MessageCircle,
  MessageSquareText,
  Phone,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { activityAuthor, contactLinks, type ContactLink } from "@/lib/crm/lead-view";
import { serviceContext } from "@/lib/services/context";
import { getLead, listLeadActivities, listStages, memberNames } from "@/lib/services/crm";
import { ServiceError } from "@/lib/services/errors";
import { requireWorkspace } from "@/lib/workspace";
import { deleteLeadAction } from "../../actions";
import { LeadEditForm, LeadStageSelect, NoteForm, MeetingForm } from "./lead-forms";

export const metadata: Metadata = { title: "Ficha do lead" };

const CONTACT_ICON: Record<ContactLink["kind"], LucideIcon> = {
  whatsapp: MessageCircle,
  email: Mail,
  phone: Phone,
  website: Globe,
  instagram: AtSign,
};
const ACTIVITY_ICON: Record<string, LucideIcon> = {
  note: MessageSquareText,
  stage_change: ArrowRightLeft,
  meeting: CalendarClock,
  message: MessageCircle,
  ai_action: Sparkles,
};
const SOURCE_LABEL: Record<string, string> = {
  manual: "Cadastro manual",
  hermes: "Criado pelo Hermes",
  scraping: "Extrator de leads",
  landing_page: "Landing page",
  webhook: "Integração externa",
};
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  if (!z.uuid().safeParse(leadId).success) notFound();

  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  let lead: Awaited<ReturnType<typeof getLead>>;
  try {
    lead = await getLead(ctx, leadId);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  const [activities, stages] = await Promise.all([listLeadActivities(ctx, leadId), listStages(ctx)]);
  const names = await memberNames(ctx, [lead.owner_id, ...activities.map((a) => a.created_by)].filter((id): id is string => Boolean(id)));
  const isAdmin = workspace.role !== "member";
  const links = contactLinks(lead);
  const owner = lead.owner_id ? (lead.owner_id === workspace.user.id ? "Você" : names.get(lead.owner_id) ?? "Membro da equipe") : "Sem responsável";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Voltar para o CRM
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">{lead.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {lead.company ?? "Sem empresa informada"}
            {lead.value !== null && <> · {brl.format(Number(lead.value))}</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {lead.stage && <Badge variant="outline">{lead.stage.name}</Badge>}
            <Badge variant="outline">{SOURCE_LABEL[lead.source] ?? lead.source}</Badge>
            <Badge variant="outline">Responsável: {owner}</Badge>
          </div>
        </div>
        {isAdmin && (
          <ConfirmActionButton
            action={deleteLeadAction}
            fields={{ leadId: lead.id, redirectTo: "board" }}
            confirmMessage={`Excluir o lead “${lead.name}”? O histórico dele também será apagado e não poderá ser recuperado.`}
            variant="outline"
            className="text-destructive"
          >
            <Trash2 className="size-4" /> Excluir lead
          </ConfirmActionButton>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <Card className="glass">
            <CardHeader><CardTitle>Agendar reunião</CardTitle><CardDescription>Crie o evento no Google Calendar e envie o convite ao lead.</CardDescription></CardHeader>
            <CardContent><MeetingForm leadId={lead.id} email={lead.email} /></CardContent>
          </Card>
          <Card className="glass">
            <CardHeader>
              <CardTitle>Contato rápido</CardTitle>
              <CardDescription>Fale com o lead em um clique. Os atalhos aparecem conforme os dados preenchidos.</CardDescription>
            </CardHeader>
            <CardContent>
              {links.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum contato preenchido ainda. Adicione WhatsApp, e-mail, site ou Instagram nos dados abaixo.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {links.map((link) => {
                    const Icon = CONTACT_ICON[link.kind];
                    return (
                      <li key={link.kind}>
                        <a
                          href={link.href}
                          target={link.kind === "email" || link.kind === "phone" ? undefined : "_blank"}
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/50 hover:text-primary"
                        >
                          <Icon className="size-4" aria-hidden /> {link.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle>Etapa do funil</CardTitle>
              <CardDescription>Mudar a etapa aqui é o mesmo que arrastar o card no quadro e fica no histórico.</CardDescription>
            </CardHeader>
            <CardContent>
              <LeadStageSelect
                leadId={lead.id}
                currentStageId={lead.stage_id}
                stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
              />
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle>Dados do lead</CardTitle>
              <CardDescription>Campos em branco ficam sem informação.</CardDescription>
            </CardHeader>
            <CardContent>
              <LeadEditForm
                lead={{
                  id: lead.id,
                  name: lead.name,
                  company: lead.company,
                  email: lead.email,
                  phone: lead.phone,
                  whatsapp: lead.whatsapp,
                  instagram: lead.instagram,
                  website: lead.website,
                  value: lead.value === null ? null : Number(lead.value),
                  notes: lead.notes,
                }}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="glass h-fit">
          <CardHeader>
            <CardTitle>Linha do tempo</CardTitle>
            <CardDescription>Tudo o que aconteceu com este lead, de quem fez e quando.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <NoteForm leadId={lead.id} />
            <ol className="relative space-y-5 border-l border-border pl-5">
              {activities.map((activity) => {
                const Icon = activity.created_via === "hermes" ? Bot : (ACTIVITY_ICON[activity.type] ?? MessageSquareText);
                return (
                  <li key={activity.id} className="relative">
                    <span className="absolute top-0.5 -left-[1.95rem] grid size-6 place-items-center rounded-full border border-border bg-card text-primary">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <p className="text-sm whitespace-pre-wrap">{activity.content}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {activityAuthor(activity, workspace.user.id, names)} ·{" "}
                      <time dateTime={activity.created_at}>{dateTime.format(new Date(activity.created_at))}</time>
                    </p>
                  </li>
                );
              })}
              <li className="relative">
                <span className="absolute top-0.5 -left-[1.95rem] grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground">
                  <Sparkles className="size-3.5" aria-hidden />
                </span>
                <p className="text-sm">Lead cadastrado ({SOURCE_LABEL[lead.source]?.toLowerCase() ?? lead.source})</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <time dateTime={lead.created_at}>{dateTime.format(new Date(lead.created_at))}</time>
                </p>
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
