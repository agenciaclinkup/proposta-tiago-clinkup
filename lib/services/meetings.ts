import "server-only";
import { z } from "zod";
import { getGoogleAccessToken } from "@/lib/integrations/google";
import type { ServiceContext } from "./context";
import { getLead } from "./crm";
import { ServiceError } from "./errors";
import { listIntegrations } from "./integrations";

export const meetingSchema = z.object({
  leadId: z.uuid(),
  title: z.string().trim().min(1, "Informe o título da reunião.").max(200),
  startAt: z.iso.datetime({ offset: true, message: "Informe data e horário com fuso." }),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  description: z.string().trim().max(5000).optional(),
});

export async function scheduleLeadMeeting(ctx: ServiceContext, input: z.infer<typeof meetingSchema>) {
  const start = new Date(input.startAt);
  if (start.getTime() <= Date.now()) throw new ServiceError("Escolha uma data e um horário futuros para a reunião.");
  const lead = await getLead(ctx, input.leadId);
  if (!lead.email || !z.email().safeParse(lead.email).success) {
    throw new ServiceError("Cadastre um e-mail válido na ficha do lead para enviar o convite.");
  }
  const integrations = await listIntegrations(ctx);
  const calendar = integrations.find((item) => item.provider === "google_calendar" && item.status === "connected");
  if (!calendar) throw new ServiceError("Conecte o Google Calendar em /integrations antes de agendar a reunião.");

  const token = await getGoogleAccessToken(ctx.organizationId, calendar.id);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  let response: Response;
  try {
    response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.external_account_id)}/events?sendUpdates=all`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ summary: input.title, description: input.description, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, attendees: [{ email: lead.email }] }),
    signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ServiceError("Não foi possível confirmar a resposta do Google. Confira sua agenda antes de tentar novamente para evitar duplicar a reunião.");
  }
  if (!response.ok) {
    if (response.status >= 500) throw new ServiceError("O Google não confirmou o agendamento. Confira sua agenda antes de tentar novamente para evitar duplicar a reunião.");
    throw new ServiceError("O Google Calendar não aceitou o agendamento. Confira a conexão em /integrations e tente novamente.");
  }
  const event = await response.json().catch(() => ({})) as { id?: string };
  if (!event.id) throw new ServiceError("O Google recebeu o pedido, mas não confirmou o evento. Confira sua agenda antes de tentar novamente.");

  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(start);
  try {
    const activity = await ctx.supabase.from("crm_activities").insert({
      organization_id: ctx.organizationId, lead_id: lead.id, type: "meeting", content: `Reunião “${input.title}” agendada para ${when} (horário de Brasília).`,
      metadata: { google_event_id: event.id, start_at: start.toISOString(), duration_minutes: input.durationMinutes },
      created_by: ctx.userId, created_via: ctx.via,
    });
    const updated = await ctx.supabase.from("crm_leads").update({ next_meeting_at: start.toISOString(), google_event_id: event.id }).eq("id", lead.id).eq("organization_id", ctx.organizationId).select("id").maybeSingle();
    if (activity.error || updated.error || !updated.data) throw new Error(`activity: ${activity.error?.message ?? "ok"}; lead: ${updated.error?.message ?? (updated.data ? "ok" : "não encontrado")}`);
  } catch (error) {
    console.error("[crm] evento criado, falha ao registrar no CRM", error);
    throw new ServiceError("A reunião foi criada no Google Calendar, mas não foi possível salvar todos os dados no CRM. Confira a agenda antes de tentar novamente.");
  }
  return { eventId: event.id, startAt: start.toISOString(), durationMinutes: input.durationMinutes, attendee: lead.email };
}
