"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExecutiveDashboardData } from "@/lib/services/dashboard";

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};

export function DashboardCharts({ data }: { data: ExecutiveDashboardData }) {
  const operationsData = [
    { label: "Publicados", total: data.content.publishedInPeriod },
    { label: "Agendados", total: data.content.scheduledCount },
    { label: "Rascunhos", total: data.content.draftCount },
    { label: "Prospects", total: data.prospectingStudio.prospectsCapturedInPeriod },
    { label: "No CRM", total: data.prospectingStudio.prospectsSentToCrm },
  ];
  const hasOperations = operationsData.some((item) => item.total > 0);
  const hasFunnel = data.crm.stages.some((stage) => stage.count > 0);
  const hasAdsTrend = data.metaAds.trend.length > 0;

  return (
    <section aria-label="Gráficos executivos" className="grid gap-4 lg:grid-cols-2">
      {/* Funil de vendas */}
      <Card className="glass">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Distribuição no funil de vendas</CardTitle>
            <CardDescription>Quantidade de leads por etapa atual do CRM.</CardDescription>
          </div>
          <Link href="/crm?view=funil" className="text-xs text-primary hover:underline">
            Abrir funil
          </Link>
        </CardHeader>
        <CardContent>
          {!hasFunnel ? (
            <div className="flex h-60 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Ainda não há leads distribuídos nas etapas do funil.</p>
              <Link href="/crm" className="mt-2 text-xs text-primary hover:underline">
                Cadastrar ou importar primeiros leads no CRM
              </Link>
            </div>
          ) : (
            <div className="h-60 w-full" role="img" aria-label="Gráfico de barras com a quantidade de leads em cada etapa do funil">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.crm.stages} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 8 }} barCategoryGap={8}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={125} tick={{ fill: "var(--foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--accent)", opacity: 0.35 }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
                    formatter={(value, _name, item) => {
                      const row = item.payload as ExecutiveDashboardData["crm"]["stages"][number];
                      const pass = row.passRate === null ? "" : ` · ${pct.format(row.passRate)} avançam`;
                      return [`${Number(value).toLocaleString("pt-BR")} leads${pass}`, "Na etapa"];
                    }}
                  />
                  <Bar dataKey="count" fill="#00D4FF" radius={[0, 4, 4, 0]} maxBarSize={24}>
                    <LabelList dataKey="count" position="right" fill="var(--muted-foreground)" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Investimento e leads em Meta Ads */}
      <Card className="glass">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Investimento em Meta Ads ({data.periodLabel.toLowerCase()})</CardTitle>
            <CardDescription>Evolução diária de investimento e leads sincronizados.</CardDescription>
          </div>
          <Link href="/meta-ads" className="text-xs text-primary hover:underline">
            Abrir Meta Ads
          </Link>
        </CardHeader>
        <CardContent>
          {!hasAdsTrend ? (
            <div className="flex h-60 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Nenhum snapshot de métricas Meta Ads neste período.</p>
              <Link href="/meta-ads" className="mt-2 text-xs text-primary hover:underline">
                Vincular conta e sincronizar campanhas
              </Link>
            </div>
          ) : (
            <div className="h-60 w-full" role="img" aria-label="Gráfico de área com a evolução do investimento em Meta Ads no período">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.metaAds.trend} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="adsSpendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#00D4FF" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
                    formatter={(value, name) =>
                      name === "spendBRL"
                        ? [brl.format(Number(value)), "Investimento"]
                        : [Number(value).toLocaleString("pt-BR"), "Leads"]
                    }
                  />
                  <Area type="monotone" dataKey="spendBRL" stroke="#00D4FF" strokeWidth={2} fill="url(#adsSpendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conteúdo & Prospecção */}
      <Card className="glass lg:col-span-2">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Ritmo de conteúdo e prospecção ({data.periodLabel.toLowerCase()})</CardTitle>
            <CardDescription>Comparativo entre posts no calendário editorial e empresas prospectadas.</CardDescription>
          </div>
          <div className="flex gap-3 text-xs">
            <Link href="/calendar" className="text-primary hover:underline">
              Calendário
            </Link>
            <Link href="/leads-ads" className="text-primary hover:underline">
              Prospecção
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {!hasOperations ? (
            <div className="flex h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Ainda não há posts nem empresas prospectadas neste período.
              </p>
              <div className="mt-2 flex gap-4 text-xs">
                <Link href="/calendar" className="text-primary hover:underline">
                  Agendar primeiro post
                </Link>
                <Link href="/leads-ads" className="text-primary hover:underline">
                  Iniciar prospecção B2B
                </Link>
              </div>
            </div>
          ) : (
            <div className="h-52 w-full" role="img" aria-label="Gráfico de barras com volume de posts e prospecção B2B">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={operationsData} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} barCategoryGap={24}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "var(--foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    cursor={{ fill: "var(--accent)", opacity: 0.35 }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
                    formatter={(value) => [Number(value).toLocaleString("pt-BR"), "Total"]}
                  />
                  <Bar dataKey="total" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={48}>
                    <LabelList dataKey="total" position="top" fill="var(--muted-foreground)" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
