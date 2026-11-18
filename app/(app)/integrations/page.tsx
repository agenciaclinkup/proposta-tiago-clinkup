import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  CalendarDays,
  Camera,
  ChevronDown,
  Clock,
  Megaphone,
  Newspaper,
  Send,
  Store,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { INTEGRATION_CATALOG, type IntegrationProvider } from "@/lib/integrations/catalog";
import { serviceContext } from "@/lib/services/context";
import { listIntegrations, summarizeIntegrations } from "@/lib/services/integrations";
import { requireWorkspace } from "@/lib/workspace";
import { disconnectIntegrationAction, unlinkTelegramAction } from "./actions";
import { TelegramLinkPanel } from "./telegram-link";

export const metadata: Metadata = { title: "Integrações" };

const ICONS: Record<IntegrationProvider, LucideIcon> = {
  instagram: Camera,
  facebook_page: Newspaper,
  meta_ads: Megaphone,
  google_business: Store,
  google_calendar: CalendarDays,
  telegram: Send,
};

// Conexão automática chega nas próximas entregas (Meta: 3.4, Google: 3.5). Telegram já usa código de vínculo.
const CONNECT: Record<Exclude<IntegrationProvider, "telegram">, { label: string; notice: string }> = {
  instagram: { label: "Conectar com a Meta", notice: "A conexão com a Meta será liberada em breve." },
  facebook_page: { label: "Conectar com a Meta", notice: "A conexão com a Meta será liberada em breve." },
  meta_ads: { label: "Conectar com a Meta", notice: "A conexão com a Meta será liberada em breve." },
  google_business: { label: "Conectar com o Google", notice: "A conexão com o Google será liberada em breve." },
  google_calendar: { label: "Conectar com o Google", notice: "A conexão com o Google será liberada em breve." },
};

// Validado aqui porque vira parte de uma URL t.me no navegador.
const rawBotUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
const TELEGRAM_BOT_USERNAME = rawBotUsername && /^[A-Za-z0-9_]{5,32}$/.test(rawBotUsername) ? rawBotUsername : null;

const STATUS = {
  connected: { label: "Conectado", className: "border-primary/40 bg-primary/10 text-primary" },
  needs_attention: { label: "Precisa de atenção", className: "border-amber-400/40 bg-amber-400/10 text-amber-400" },
  not_connected: { label: "Não conectado", className: "border-border text-muted-foreground" },
} as const;

export default async function IntegrationsPage() {
  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  const rows = await listIntegrations(ctx);
  // A UI só esconde o botão; quem garante a regra é o RLS de admin no banco.
  const isAdmin = workspace.role !== "member";
  const summary = Object.fromEntries(summarizeIntegrations(rows).map((item) => [item.provider, item]));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Integrações</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Conecte suas redes sociais, anúncios, agenda e o Telegram para que o Hermes possa publicar, agendar e
            atender por você. Cada card traz um passo a passo para deixar sua conta pronta antes de conectar.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hermes">
            <Bot className="size-4" /> Pedir ajuda ao Hermes
          </Link>
        </Button>
      </header>

      {!isAdmin && (
        <p role="note" className="rounded-lg border border-border bg-secondary/50 p-3 text-sm text-muted-foreground">
          Você pode acompanhar as integrações da empresa e vincular ou desvincular o seu próprio Telegram. Apenas
          proprietários e administradores podem conectar ou desconectar as demais contas.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {INTEGRATION_CATALOG.map((guide) => {
          const Icon = ICONS[guide.provider];
          const status = STATUS[summary[guide.provider].status as keyof typeof STATUS];
          const accounts = rows.filter((row) => row.provider === guide.provider && row.status !== "disconnected");

          return (
            <Card key={guide.provider} className="glass">
              <CardHeader className="flex flex-row items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{guide.name}</CardTitle>
                    <Badge variant="outline" className={status.className}>
                      {status.label}
                    </Badge>
                  </div>
                  <CardDescription className="mt-1">{guide.description}</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {accounts.length > 0 && (
                  <ul className="divide-y divide-border rounded-lg border border-border" aria-label={`Contas conectadas em ${guide.name}`}>
                    {accounts.map((account) => (
                      <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                          {account.display_name ?? account.external_account_id}
                          {account.status === "needs_attention" && (
                            <span className="ml-2 text-xs text-amber-400">reconecte para continuar usando</span>
                          )}
                        </span>
                        {(account.metadata as { user_id?: string } | null)?.user_id === workspace.user.id ? (
                          <ConfirmActionButton
                            action={unlinkTelegramAction}
                            fields={{ integrationId: account.id }}
                            confirmMessage="Desvincular o seu Telegram? O Hermes deixará de responder neste chat até você gerar um novo código e vincular de novo."
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Unplug className="size-4" /> Desvincular meu Telegram
                          </ConfirmActionButton>
                        ) : isAdmin && (
                          <ConfirmActionButton
                            action={disconnectIntegrationAction}
                            fields={{ integrationId: account.id }}
                            confirmMessage={`Desconectar "${account.display_name ?? account.external_account_id}" de ${guide.name}? O Hermes deixará de publicar e consultar dados desta conta até você conectá-la novamente.`}
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Unplug className="size-4" /> Desconectar
                          </ConfirmActionButton>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {guide.provider === "telegram" ? (
                  <TelegramLinkPanel botUsername={TELEGRAM_BOT_USERNAME} />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button type="button" disabled aria-describedby={`${guide.provider}-connect-notice`}>
                      {CONNECT[guide.provider].label}
                    </Button>
                    <p id={`${guide.provider}-connect-notice`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>
                        {CONNECT[guide.provider].notice} Enquanto isso, siga o passo a passo abaixo para deixar tudo
                        pronto: quando o botão for ativado, a conexão leva menos de um minuto.
                      </span>
                    </p>
                  </div>
                )}

                <details className="group rounded-lg border border-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    Ver passo a passo
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="space-y-4 border-t border-border px-3 py-4 text-sm">
                    <div>
                      <p className="font-medium">Antes de começar, você vai precisar de:</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                        {guide.requirements.map((requirement) => (
                          <li key={requirement}>{requirement}</li>
                        ))}
                      </ul>
                    </div>
                    <ol className="space-y-3">
                      {guide.steps.map((step, index) => (
                        <li key={step.title} className="flex gap-3">
                          <span
                            className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
                            aria-hidden
                          >
                            {index + 1}
                          </span>
                          <div>
                            <p className="font-medium">{step.title}</p>
                            <p className="mt-0.5 text-muted-foreground">{step.detail}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {guide.tips.length > 0 && (
                      <div className="rounded-lg bg-secondary/60 p-3">
                        <p className="text-xs font-medium tracking-wide text-primary uppercase">Dica</p>
                        {guide.tips.map((tip) => (
                          <p key={tip} className="mt-1 text-muted-foreground">
                            {tip}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
