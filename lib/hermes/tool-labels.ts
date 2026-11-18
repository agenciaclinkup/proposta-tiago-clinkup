import type { HermesChannel } from "@/lib/services/context";

// Rótulos pt-BR das Tools para o chat e o feed de atividades. Toda Tool nova em tools.ts precisa de entrada aqui.
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
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
