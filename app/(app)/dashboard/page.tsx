import type { Metadata } from "next";
import Link from "next/link";
import { Bot, CalendarDays, KanbanSquare, Megaphone, PlugZap, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlan } from "@/config/plans";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Dashboard" };

// KPIs zerados até os módulos das próximas fases gravarem dados.
const KPIS = [
  { label: "Leads extraídos", icon: Users },
  { label: "Oportunidades no funil", icon: KanbanSquare },
  { label: "Posts agendados", icon: CalendarDays },
  { label: "Investimento em Meta Ads", icon: Megaphone },
];

export default async function DashboardPage() {
  const { organization, subscription, profile } = await requireWorkspace();
  const plan = getPlan(subscription?.plan_id ?? organization.plan_id);
  const trialDaysLeft =
    subscription?.status === "trialing" && subscription.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86_400_000))
      : null;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{organization.name}</p>
          <h1 className="text-3xl font-semibold">
            Olá{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}! <span className="text-gradient">Vamos crescer?</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Plano {plan?.name}</Badge>
          {trialDaysLeft !== null && (
            <Badge className="bg-primary/15 text-primary">
              {trialDaysLeft === 1 ? "Último dia de teste" : `${trialDaysLeft} dias de teste`}
            </Badge>
          )}
        </div>
      </header>

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map(({ label, icon: Icon }) => (
          <Card key={label} className="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-primary" aria-hidden />
            </CardHeader>
            <CardContent>
              <p className="font-heading text-3xl font-semibold">0</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5 text-primary" aria-hidden /> Agente Hermes
            </CardTitle>
            <CardDescription>
              A memória da sua marca está pronta e o Hermes já pode conversar com você. Peça ideias de conteúdo,
              ajustes na memória da marca ou um resumo do seu plano. Agendamento de posts, CRM e campanhas chegam em
              breve.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/hermes">Conversar com o Hermes</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="size-5 text-primary" aria-hidden /> Próximos passos
            </CardTitle>
            <CardDescription>Prepare sua conta para tirar o máximo da plataforma.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal space-y-2 pl-4 text-muted-foreground">
              <li className="text-foreground">Memória da marca configurada ✓</li>
              <li>Conectar Instagram, Facebook e Google Meu Negócio</li>
              <li>Vincular o Hermes ao seu Telegram</li>
            </ol>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/billing">Ver planos e assinatura</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
