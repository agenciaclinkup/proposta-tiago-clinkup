export type PlanId = "starter" | "growth" | "scale";

export type PlanLimits = {
  scrapedLeadsPerMonth: number;
  scheduledPostsPerMonth: number;
  aiCreditsPerMonth: number;
  connections: number;
  seats: number;
  // Total de leads ativos no CRM (não é mensal).
  crmLeads: number;
};

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  priceMonthlyBRL: number;
  highlighted?: boolean;
  limits: PlanLimits;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Para quem está começando a organizar marketing e vendas com IA.",
    priceMonthlyBRL: 197,
    limits: {
      scrapedLeadsPerMonth: 300,
      scheduledPostsPerMonth: 30,
      aiCreditsPerMonth: 500,
      connections: 3,
      seats: 1,
      crmLeads: 1000,
    },
    features: [
      "Agente Hermes no painel e no Telegram",
      "CRM com Kanban e funil de vendas",
      "Calendário editorial com agendamento",
      "Criador de carrosséis",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    description: "Para empresas que querem escalar a captação e a produção de conteúdo.",
    priceMonthlyBRL: 497,
    highlighted: true,
    limits: {
      scrapedLeadsPerMonth: 2000,
      scheduledPostsPerMonth: 150,
      aiCreditsPerMonth: 3000,
      connections: 8,
      seats: 5,
      crmLeads: 10000,
    },
    features: [
      "Tudo do Starter",
      "Extrator de leads por nicho e região",
      "Gestor de campanhas Meta Ads",
      "Gerador de landing pages conectadas ao CRM",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    description: "Para agências e operações com vários clientes ou marca própria.",
    priceMonthlyBRL: 1297,
    limits: {
      scrapedLeadsPerMonth: 10000,
      scheduledPostsPerMonth: 1000,
      aiCreditsPerMonth: 15000,
      connections: 30,
      seats: 20,
      crmLeads: 100000,
    },
    features: [
      "Tudo do Growth",
      "Gestão de múltiplas empresas",
      "Opção de instalação White-Label",
      "Suporte prioritário",
    ],
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

// Price IDs vêm do painel Stripe, por ambiente.
export function stripePriceId(planId: PlanId): string | undefined {
  return process.env[`STRIPE_PRICE_${planId.toUpperCase()}`];
}

export function planIdFromStripePrice(priceId: string): PlanId | undefined {
  return PLANS.find((plan) => stripePriceId(plan.id) === priceId)?.id;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}
