import type { Metadata } from "next";
import { PricingTable } from "@/components/pricing-table";
import { UsageCard } from "@/components/usage-card";
import { listOrganizationInvoices } from "@/lib/services/asaas-billing";
import { serviceContext } from "@/lib/services/context";
import { getUsageSummary } from "@/lib/services/usage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPlan, type PlanId } from "@/config/plans";
import { requireWorkspace } from "@/lib/workspace";
import { openBillingPortal, startCheckout } from "./actions";
import { AsaasBillingPanel } from "./asaas-panel";

export const metadata: Metadata = { title: "Planos e assinatura" };

const STATUS_LABEL: Record<string, string> = {
  trialing: "Em teste",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  incomplete: "Incompleta",
};

const NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  success: { tone: "ok", text: "Pagamento confirmado! Sua assinatura será atualizada em alguns instantes." },
  canceled: { tone: "error", text: "O checkout foi cancelado. Nenhuma cobrança foi feita." },
  unavailable: { tone: "error", text: "Este plano ainda não está disponível para contratação online. Fale com nosso time." },
  forbidden: { tone: "error", text: "Apenas proprietários e administradores podem alterar a assinatura." },
  rate_limited: { tone: "error", text: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente." },
};

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" });

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const workspace = await requireWorkspace();
  const { organization, subscription, user, profile, role } = workspace;
  const ctx = serviceContext(workspace, "manual");
  const [usage, invoices] = await Promise.all([getUsageSummary(ctx), listOrganizationInvoices(ctx)]);
  const planId = (subscription?.plan_id ?? organization.plan_id) as PlanId;
  const plan = getPlan(planId);
  const notice = status ? NOTICES[status] : undefined;
  const renewal = subscription?.status === "trialing" ? subscription.trial_ends_at : subscription?.current_period_end;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">Planos e assinatura</h1>
        <p className="mt-1 text-muted-foreground">Escolha o plano ideal para o momento da sua empresa.</p>
      </header>

      {notice && (
        <p
          role="status"
          className={
            notice.tone === "ok"
              ? "rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm text-primary"
              : "rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          }
        >
          {notice.text}
        </p>
      )}

      <section className="glass flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Assinatura atual</p>
          <p className="mt-1 flex items-center gap-2 text-xl font-semibold">
            {plan?.name}
            {subscription && <Badge variant="outline">{STATUS_LABEL[subscription.status] ?? subscription.status}</Badge>}
          </p>
          {renewal && (
            <p className="mt-1 text-sm text-muted-foreground">
              {subscription?.status === "trialing"
                ? "Teste gratuito até "
                : subscription?.cancel_at_period_end
                  ? "Acesso até "
                  : "Próxima renovação em "}
              {dateFormat.format(new Date(renewal))}
            </p>
          )}
        </div>
        {subscription?.provider === "stripe" && subscription.provider_customer_id && (
          <form action={openBillingPortal}>
            <Button type="submit" variant="outline">
              Gerenciar pagamento e faturas
            </Button>
          </form>
        )}
      </section>

      <UsageCard usage={usage} planName={plan?.name ?? planId} />

      <PricingTable
        currentPlanId={subscription?.status === "active" ? planId : undefined}
        renderAction={(id) => (
          <form action={startCheckout}>
            <input type="hidden" name="planId" value={id} />
            <Button type="submit" className="w-full">
              Assinar {getPlan(id)?.name} (Cartão)
            </Button>
          </form>
        )}
      />

      <AsaasBillingPanel
        isAdmin={role !== "member"}
        defaultEmail={user.email ?? ""}
        defaultName={profile.full_name ?? organization.name}
        currentPlanId={planId}
        invoices={invoices}
      />
    </div>
  );
}
