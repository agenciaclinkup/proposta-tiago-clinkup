import Link from "next/link";
import { AlertTriangle, Gauge } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { usageLevel, type getUsageSummary } from "@/lib/services/usage";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("pt-BR");

export function UsageCard({
  usage,
  planName,
  className,
}: {
  usage: Awaited<ReturnType<typeof getUsageSummary>>;
  planName: string;
  className?: string;
}) {
  return (
    <Card className={cn("glass", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-5 text-primary" aria-hidden /> Uso do plano {planName}
        </CardTitle>
        <CardDescription>Consumo deste mês. Os limites renovam no dia 1º.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {usage.map(({ metric, label, used, limit }) => {
          const level = usageLevel(used, limit);
          return (
            <div key={metric} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="first-letter:uppercase">{label}</span>
                <span className={cn("tabular-nums", level.warning ? "text-amber-400" : "text-muted-foreground")}>
                  {nf.format(used)} de {nf.format(limit)}
                </span>
              </div>
              <Progress
                value={level.percent}
                aria-label={`${label}: ${level.percent}% do limite usado`}
                className={cn(
                  "h-2",
                  level.exhausted
                    ? "[&_[data-slot=progress-indicator]]:bg-destructive"
                    : level.warning && "[&_[data-slot=progress-indicator]]:bg-amber-400",
                )}
              />
              {level.warning && (
                <p role="status" className="flex items-start gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    {level.exhausted
                      ? `Você atingiu o limite de ${label} deste mês. `
                      : `Você já usou ${level.percent}% dos ${label} deste mês. `}
                    <Link href="/billing" className="underline underline-offset-2">
                      Conheça os planos com limites maiores
                    </Link>
                    .
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
