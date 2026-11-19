import { Check } from "lucide-react";
import { formatBRL, PLANS, type PlanId } from "@/config/plans";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("pt-BR");

// Usado na página pública (CTA = cadastro) e em /billing (CTA = checkout). O botão vem de quem renderiza.
export function PricingTable({
  currentPlanId,
  renderAction,
}: {
  currentPlanId?: PlanId;
  renderAction: (planId: PlanId) => React.ReactNode;
}) {
  return (
    <div><div className="grid gap-6 lg:grid-cols-3">
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          className={cn(
            "glass relative flex flex-col rounded-2xl p-6",
            plan.highlighted && "border-primary/50 shadow-xl shadow-primary/10",
          )}
        >
          {plan.highlighted && (
            <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
              Mais escolhido
            </span>
          )}
          <h3 className="text-xl font-semibold">{plan.name}</h3>
          <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
          <p className="mt-6">
            <span className="font-heading text-4xl font-semibold">{formatBRL(plan.priceMonthlyBRL)}</span>
            <span className="text-sm text-muted-foreground">/mês</span>
          </p>

          <ul className="mt-6 space-y-2 text-sm">
            {plan.features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {feature}
              </li>
            ))}
          </ul>

          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 text-xs">
            <dt className="text-muted-foreground">Leads no CRM</dt>
            <dd className="text-right">{nf.format(plan.limits.crmLeads)}</dd>
            <dt className="text-muted-foreground">Leads extraídos/mês</dt>
            <dd className="text-right">{nf.format(plan.limits.scrapedLeadsPerMonth)}</dd>
            <dt className="text-muted-foreground">Posts agendados/mês</dt>
            <dd className="text-right">{nf.format(plan.limits.scheduledPostsPerMonth)}</dd>
            <dt className="text-muted-foreground">Créditos de IA/mês</dt>
            <dd className="text-right">{nf.format(plan.limits.aiCreditsPerMonth)}</dd>
            <dt className="text-muted-foreground">Conexões</dt>
            <dd className="text-right">{plan.limits.connections}</dd>
            <dt className="text-muted-foreground">Usuários</dt>
            <dd className="text-right">{plan.limits.seats}</dd>
          </dl>

          <div className="mt-auto pt-6">
            {currentPlanId === plan.id ? (
              <p className="rounded-lg border border-primary/40 py-2 text-center text-sm text-primary">Seu plano atual</p>
            ) : (
              renderAction(plan.id)
            )}
          </div>
        </div>
      ))}
    </div><p className="mt-4 text-sm text-muted-foreground">Ao gerar conteúdo com IA pelo Hermes, a conversa usa 1 crédito e a geração usa mais 1 crédito. Quando o Estúdio usa a estrutura-base local sem provedor de IA, a geração não consome crédito adicional.</p></div>
  );
}
