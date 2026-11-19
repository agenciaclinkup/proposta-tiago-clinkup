import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tenantBrand } from "@/config/tenant-brand";
import { funnelMetrics } from "@/lib/crm/funnel";
import { FunnelChartLazy } from "./funnel-chart-lazy";

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function FunnelView({
  stages,
}: {
  stages: { id: string; name: string; kind: string; leads: { value: number | null }[] }[];
}) {
  const metrics = funnelMetrics(
    stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      kind: stage.kind,
      count: stage.leads.length,
      value: stage.leads.reduce((sum, lead) => sum + (lead.value ?? 0), 0),
    })),
  );

  if (metrics.total === 0) {
    return (
      <Card className="glass">
        <CardContent className="py-12 text-center">
          <p className="font-medium">Seu funil ainda está vazio.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Adicione leads no quadro (ou peça ao Hermes) e acompanhe aqui quantos avançam de uma etapa para a outra.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-label="Resumo do funil" className="grid gap-4 sm:grid-cols-3">
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardDescription>Leads no funil</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">{metrics.total.toLocaleString("pt-BR")}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardDescription>Conversão geral</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">{metrics.conversion === null ? "—" : pct.format(metrics.conversion)}</p>
            <p className="text-xs text-muted-foreground">
              {metrics.conversion === null
                ? "Marque uma etapa como “ganho” para medir a conversão."
                : `${metrics.wonCount.toLocaleString("pt-BR")} leads chegaram à etapa de fechamento`}
            </p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardDescription>Valor em oportunidades</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">{brl.format(metrics.totalValue)}</p>
          </CardContent>
        </Card>
      </section>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Leads por etapa</CardTitle>
          <CardDescription>
            Passe o mouse em uma barra para ver a taxa de passagem. Um lead em uma etapa conta como tendo passado pelas
            anteriores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FunnelChartLazy
            color={tenantBrand.colors.primary}
            rows={metrics.stages.map((stage) => ({ name: stage.name, count: stage.count, reached: stage.reached, passRate: stage.passRate }))}
          />

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Funil de vendas por etapa: quantidade, participação, leads que chegaram e taxa de passagem</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Etapa</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Leads</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">% do total</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Chegaram aqui</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Passam para a próxima</th>
                  <th scope="col" className="py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {metrics.stages.map((stage) => (
                  <tr key={stage.id} className="border-b border-border/60">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{stage.name}</th>
                    <td className="py-2 pr-4 text-right tabular-nums">{stage.count.toLocaleString("pt-BR")}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{pct.format(stage.share)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{stage.reached.toLocaleString("pt-BR")}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{stage.passRate === null ? "—" : pct.format(stage.passRate)}</td>
                    <td className="py-2 text-right tabular-nums">{brl.format(stage.value)}</td>
                  </tr>
                ))}
                {metrics.lost.map((stage) => (
                  <tr key={stage.id} className="border-b border-border/60 text-muted-foreground">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{stage.name} (perdidos)</th>
                    <td className="py-2 pr-4 text-right tabular-nums">{stage.count.toLocaleString("pt-BR")}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{pct.format(stage.share)}</td>
                    <td className="py-2 pr-4 text-right">—</td>
                    <td className="py-2 pr-4 text-right">—</td>
                    <td className="py-2 text-right tabular-nums">{brl.format(stage.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            As taxas usam a situação atual do funil. Relatórios por período chegam em uma próxima atualização.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
