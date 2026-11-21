import type { HermesChannel } from "@/lib/services/context";

// Rótulos pt-BR das Tools para o chat e o feed de atividades. Toda Tool nova em tools.ts precisa de entrada aqui.
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  list_prospect_searches: { running: "Consultando pesquisas de prospecção…", done: "Consultou pesquisas de prospecção" },
  list_prospect_results: { running: "Consultando resultados de prospecção…", done: "Consultou resultados de prospecção" },
  lookup_cnpj_prospects: { running: "Consultando CNPJs autorizados…", done: "Consultou CNPJs autorizados" },
  search_commercial_prospects: { running: "Buscando empresas B2B…", done: "Buscou empresas B2B" },
  propose_send_prospects_to_crm: { running: "Preparando envio de leads ao CRM…", done: "Preparou envio de leads ao CRM" },
  confirm_prospect_transfer: { running: "Confirmando envio de leads ao CRM…", done: "Enviou leads da prospecção ao CRM" },
  check_ads_readiness: { running: "Verificando prontidão do Meta Ads…", done: "Verificou prontidão do Meta Ads" },
  list_ad_accounts: { running: "Consultando contas de anúncios…", done: "Consultou contas de anúncios" },
  list_ad_campaigns: { running: "Consultando campanhas Meta Ads…", done: "Consultou campanhas Meta Ads" },
  list_ad_action_logs: { running: "Consultando auditoria de Meta Ads…", done: "Consultou auditoria de Meta Ads" },
  sync_ad_campaigns: { running: "Sincronizando campanhas e métricas…", done: "Sincronizou campanhas e métricas" },
  pause_ad_campaign: { running: "Pausando campanha no Meta Ads…", done: "Pausou campanha no Meta Ads" },
  propose_ad_campaign: { running: "Preparando proposta de campanha…", done: "Preparou proposta de campanha" },
  propose_activate_ad_campaign: { running: "Preparando ativação de campanha…", done: "Preparou ativação de campanha" },
  propose_update_ad_budget: { running: "Preparando ajuste de orçamento…", done: "Preparou ajuste de orçamento" },
  confirm_ad_action: { running: "Confirmando ação no Meta Ads…", done: "Confirmou ação no Meta Ads" },
  publish_post_now: { running: "Preparando publicação imediata…", done: "Preparou publicação imediata" },
  confirm_calendar_action: { running: "Confirmando ação do calendário…", done: "Confirmou ação do calendário" },
  list_posts: { running: "Consultando o calendário…", done: "Consultou o calendário" },
  list_calendar_accounts: { running: "Consultando contas conectadas…", done: "Consultou contas do calendário" },
  create_post: { running: "Salvando post…", done: "Salvou post" },
  update_post: { running: "Atualizando post…", done: "Atualizou post" },
  reschedule_post: { running: "Reagendando post…", done: "Reagendou post" },
  cancel_post: { running: "Cancelando agendamento…", done: "Cancelou agendamento" },
  plan_week_with_ai: { running: "Preparando proposta da semana…", done: "Preparou proposta da semana" },
  list_studio_projects: { running: "Consultando projetos do Estúdio…", done: "Consultou projetos do Estúdio" },
  get_studio_project: { running: "Abrindo projeto do Estúdio…", done: "Abriu projeto do Estúdio" },
  save_carousel: { running: "Salvando carrossel…", done: "Salvou carrossel" },
  save_landing_page: { running: "Salvando landing page…", done: "Salvou landing page" },
  generate_carousel: { running: "Gerando slides com IA…", done: "Gerou slides com IA" },
  export_carousel_to_calendar: { running: "Enviando carrossel ao calendário…", done: "Enviou carrossel ao calendário" },
  schedule_lead_meeting:{ running: "Agendando reunião…", done: "Agendou reunião" },
  list_leads: { running: "Buscando leads…", done: "Buscou leads" },
  create_lead: { running: "Cadastrando lead…", done: "Cadastrou lead" },
  update_lead: { running: "Atualizando lead…", done: "Atualizou lead" },
  move_lead_to_stage: { running: "Movendo lead no funil…", done: "Moveu lead no funil" },
  add_lead_note: { running: "Adicionando anotação…", done: "Adicionou anotação" },
  get_funnel_metrics: { running: "Consultando o funil…", done: "Consultou o funil" },
  get_brand_context: { running: "Consultando a memória da marca…", done: "Consultou a memória da marca" },
  update_brand_context: { running: "Atualizando a memória da marca…", done: "Atualizou a memória da marca" },
  get_plan_and_usage: { running: "Verificando o plano e o consumo…", done: "Verificou o plano e o consumo" },
  list_recent_activity: { running: "Buscando as atividades recentes…", done: "Buscou as atividades recentes" },
  list_integrations: { running: "Verificando as integrações…", done: "Verificou as integrações" },
  get_integration_setup_guide: { running: "Preparando o passo a passo…", done: "Consultou o passo a passo de conexão" },
};

const FALLBACK = { running: "Executando uma ação…", done: "Ação executada" };

export function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? FALLBACK;
}

export const CHANNEL_LABELS: Record<HermesChannel, string> = {
  web: "Painel",
  telegram: "Telegram",
  webhook: "Integração externa",
  system: "Automação",
};
