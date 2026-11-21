import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  Check,
  CircleDollarSign,
  KanbanSquare,
  Megaphone,
  Palette,
  Percent,
  PlugZap,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { UsageCard } from "@/components/usage-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlan } from "@/config/plans";
import { CHANNEL_LABELS, toolLabel } from "@/lib/hermes/tool-labels";
import { formatCentsBRL, formatPercentBR } from "@/lib/meta-ads/metrics";
import { listRecentActivity } from "@/lib/services/activity";
import { serviceContext, type HermesChannel } from "@/lib/services/context";
import {
  DASHBOARD_PERIODS,
  getExecutiveDashboard,
  parseDashboardPeriod,
  PERIOD_LABELS,
} from "@/lib/services/dashboard";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/lib/workspace";
import { DashboardCharts } from "./charts";

export const metadata: Metadata = { title: "Dashboard" };

const activityTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const params = await searchParams;
  const period = parseDashboardPeriod(params.period);
  const workspace = await requireWorkspace();
  const { organization, subscription, profile } = workspace;
  const ctx = serviceContext(workspace, "manual");

  const [{ metrics, usage }, activity] = await Promise.all([
    getExecutiveDashboard(ctx, period),
    listRecentActivity(ctx, 6),
  ]);

  const plan = getPlan(subscription?.plan_id ?? organization.plan_id);
  const trialDaysLeft =
    subscription?.status === "trialing" && subscription.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86_400_000))
      : null;

  const kpiCards = [
    {
      label: "Leads no CRM",
      value: metrics.crm.totalLeads.toLocaleString("pt-BR"),
      detail: `+${metrics.crm.newLeadsInPeriod.toLocaleString("pt-BR")} em ${metrics.periodLabel.toLowerCase()} · ${metrics.crm.openOpportunities.toLocaleString("pt-BR")} em aberto`,
      icon: KanbanSquare,
      href: "/crm",
      linkText: "Abrir CRM",
    },
    {
      label: "Conversão e valor no funil",
      value: metrics.crm.conversionRate === null ? "—" : pct.format(metrics.crm.conversionRate),
      detail: `Valor total no funil: ${brl.format(metrics.crm.totalValue)}`,
      icon: Percent,
      href: "/crm?view=funil",
      linkText: "Ver funil",
    },
    {
      label: "Conteúdo & redes",
      value: `${metrics.content.publishedInPeriod.toLocaleString("pt-BR")} pub. · ${metrics.content.scheduledCount.toLocaleString("pt-BR")} ag.`,
      detail: `${metrics.content.connectedAccounts} conta(s) conectada(s)${metrics.content.needsAttentionAccounts ? ` · ${metrics.content.needsAttentionAccounts} requer(em) atenção` : ""}`,
      icon: CalendarDays,
      href: "/calendar",
      linkText: "Abrir calendário",
    },
    {
      label: "Prospecção B2B",
      value: metrics.prospectingStudio.prospectsCapturedInPeriod.toLocaleString("pt-BR"),
      detail: `${metrics.prospectingStudio.prospectsSentToCrm.toLocaleString("pt-BR")} de ${metrics.prospectingStudio.prospectsTotal.toLocaleString("pt-BR")} enviados ao CRM (${pct.format(metrics.prospectingStudio.prospectToCrmRate)})`,
      icon: Users,
      href: "/leads-ads",
      linkText: "Abrir prospecção",
    },
    {
      label: "Estúdio & créditos IA",
      value: `${Math.max(metrics.prospectingStudio.aiCreditsLimit - metrics.prospectingStudio.aiCreditsUsed, 0).toLocaleString("pt-BR")}`,
      detail: `Créditos livres · ${metrics.prospectingStudio.carouselsCount} carrossel(is) · ${metrics.prospectingStudio.publishedLandingsCount} LP(s) publicada(s)`,
      icon: Sparkles,
      href: "/studio",
      linkText: "Abrir Estúdio",
    },
    {
      label: "Investimento Meta Ads",
      value: formatCentsBRL(metrics.metaAds.spendCents),
      detail: `${metrics.metaAds.leads.toLocaleString("pt-BR")} lead(s) · CPL ${formatCentsBRL(metrics.metaAds.cplCents)}`,
      icon: CircleDollarSign,
      href: "/meta-ads",
      linkText: "Abrir Meta Ads",
    },
    {
      label: "Eficiência Meta Ads",
      value: formatPercentBR(metrics.metaAds.ctrPercent),
      detail: `CTR médio · CPC ${formatCentsBRL(metrics.metaAds.cpcCents)} · ${metrics.metaAds.clicks.toLocaleString("pt-BR")} clique(s)`,
      icon: TrendingUp,
      href: "/meta-ads",
      linkText: "Ver campanhas",
    },
    {
      label: "Integrações ativas",
      value: metrics.content.connectedAccounts.toLocaleString("pt-BR"),
      detail:
        metrics.content.needsAttentionAccounts > 0
          ? `${metrics.content.needsAttentionAccounts} integração(ões) precisa(m) de reconexão`
          : "Canais e automações monitorados",
      icon: PlugZap,
      href: "/integrations",
      linkText: "Gerenciar conexões",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{organization.name}</p>
          <h1 className="text-3xl font-semibold">
            Olá{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}!{" "}
            <span className="text-gradient">Painel Executivo</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Filtro de período" className="flex items-center rounded-lg border border-border bg-card/60 p-1">
            {DASHBOARD_PERIODS.map((item) => (
              <Link
                key={item}
                href={`/dashboard?period=${item}`}
                aria-current={period === item ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  period === item ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {PERIOD_LABELS[item].replace("Últimos ", "")}
              </Link>
            ))}
          </nav>
          <Badge variant="outline">Plano {plan?.name}</Badge>
          {trialDaysLeft !== null && (
            <Badge className="bg-primary/15 text-primary">
              {trialDaysLeft === 1 ? "Último dia de teste" : `${trialDaysLeft} dias de teste`}
            </Badge>
          )}
        </div>
      </header>

      <section aria-label="Indicadores executivos" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map(({ label, value, detail, icon: Icon, href, linkText }) => (
          <Card key={label} className="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-primary" aria-hidden />
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="font-heading text-2xl font-semibold">{value}</p>
              <p className="text-xs text-muted-foreground">{detail}</p>
              <Link href={href} className="inline-block text-xs text-primary hover:underline">
                {linkText}
              </Link>
            </CardContent>
          </Card>
        ))}
      </section>

      <DashboardCharts data={metrics} />

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5 text-primary" aria-hidden /> Agente Hermes
            </CardTitle>
            <CardDescription>
              A memória da sua marca está ativa. Peça ao Hermes para gerenciar leads no CRM, criar carrosséis no Estúdio,
              planejar o calendário editorial, prospectar empresas B2B ou revisar e propor campanhas de Meta Ads.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/hermes">Conversar com o Hermes</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/studio">
                  <Palette className="size-4" aria-hidden /> Estúdio
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/meta-ads">
                  <Megaphone className="size-4" aria-hidden /> Meta Ads
                </Link>
              </Button>
            </div>

            <div>
              <h3 className="text-sm font-medium">Atividades recentes</h3>
              {activity.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nenhuma atividade ainda. Quando você pedir algo ao Hermes, cada ação executada aparecerá aqui.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {activity.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 py-2.5 text-sm">
                      {item.status === "success" ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Concluída" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" aria-label="Não concluída" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p>
                          {toolLabel(item.tool_name).done}
                          {item.status !== "success" && <span className="text-muted-foreground"> (não concluída)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.via === "hermes" ? "Pelo Hermes" : "Manual"} ·{" "}
                          {CHANNEL_LABELS[item.channel as HermesChannel] ?? item.channel}
                        </p>
                      </div>
                      <time dateTime={item.created_at} className="shrink-0 text-xs text-muted-foreground">
                        {activityTime.format(new Date(item.created_at))}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <UsageCard usage={usage} planName={plan?.name ?? organization.plan_id} />

          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="size-5 text-primary" aria-hidden /> Atalhos rápidos
              </CardTitle>
              <CardDescription>Acesse cada operação da sua empresa em um clique.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/crm">CRM</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/calendar">Calendário</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/leads-ads">Prospecção</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/meta-ads">Meta Ads</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/integrations">Integrações</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/billing">Planos</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
