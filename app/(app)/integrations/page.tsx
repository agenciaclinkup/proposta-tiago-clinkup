import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  CalendarDays,
  Camera,
  ChevronDown,
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
import { canUseOwnBot, getOwnTelegramBot } from "@/lib/services/telegram-bot";
import { requireWorkspace } from "@/lib/workspace";
import { disconnectIntegrationAction, unlinkTelegramAction } from "./actions";
import { OwnBotPanel } from "./own-bot-panel";
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

// Um único login com a Meta conecta os três tipos de conta. Google chega na 3.5.
const META_PROVIDERS: IntegrationProvider[] = ["instagram", "facebook_page", "meta_ads"];

const META_RESULT: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Pronto! Suas contas da Meta foram conectadas. Confira abaixo o que foi encontrado." },
  none: {
    tone: "error",
    text: "O login com a Meta funcionou, mas nenhuma Página, conta do Instagram ou conta de anúncios foi autorizada. Conecte de novo e marque as contas que deseja usar.",
  },
  cancelled: { tone: "error", text: "A conexão com a Meta foi cancelada. Nenhuma alteração foi feita." },
  invalid_state: {
    tone: "error",
    text: "Por segurança, não concluímos a conexão: o pedido expirou ou veio de outra sessão. Clique em Conectar com a Meta novamente.",
  },
  forbidden: { tone: "error", text: "Apenas proprietários e administradores podem conectar contas da Meta." },
  unavailable: { tone: "error", text: "A conexão com a Meta ainda não está disponível nesta plataforma. Fale com o suporte." },
  rate_limited: { tone: "error", text: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente." },
  error: { tone: "error", text: "Não conseguimos concluir a conexão com a Meta agora. Tente novamente em alguns minutos." },
};

const GOOGLE_RESULT: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Pronto! Sua conta Google foi conectada. Confira abaixo o que foi encontrado." },
  none: {
    tone: "error",
    text: "O login com o Google funcionou, mas não encontramos um Perfil da Empresa ou agenda nessa conta. Confira se você entrou com a conta certa e tente de novo.",
  },
  no_refresh: {
    tone: "error",
    text: "O Google não liberou o acesso contínuo à conta. Clique em Conectar com o Google novamente e aceite todas as permissões pedidas.",
  },
  cancelled: { tone: "error", text: "A conexão com o Google foi cancelada. Nenhuma alteração foi feita." },
  invalid_state: {
    tone: "error",
    text: "Por segurança, não concluímos a conexão: o pedido expirou ou veio de outra sessão. Clique em Conectar com o Google novamente.",
  },
  invalid: { tone: "error", text: "Não identificamos qual serviço do Google conectar. Use o botão do card desejado." },
  forbidden: { tone: "error", text: "Apenas proprietários e administradores podem conectar contas do Google." },
  unavailable: { tone: "error", text: "A conexão com o Google ainda não está disponível nesta plataforma. Fale com o suporte." },
  rate_limited: { tone: "error", text: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente." },
  error: {
    tone: "error",
    text: "Não conseguimos concluir a conexão com o Google agora. Se for o Google Meu Negócio, confira se o perfil está verificado e tente novamente em alguns minutos.",
  },
};

// Validado aqui porque vira parte de uma URL t.me no navegador.
const botUsernameOrNull = (raw: string | null | undefined) => {
  const value = raw?.replace(/^@/, "");
  return value && /^[A-Za-z0-9_]{5,32}$/.test(value) ? value : null;
};
const PLATFORM_BOT_USERNAME = botUsernameOrNull(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME);

const STATUS = {
  connected: { label: "Conectado", className: "border-primary/40 bg-primary/10 text-primary" },
  needs_attention: { label: "Precisa de atenção", className: "border-amber-400/40 bg-amber-400/10 text-amber-400" },
  not_connected: { label: "Não conectado", className: "border-border text-muted-foreground" },
} as const;

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ meta?: string; google?: string }> }) {
  const { meta, google } = await searchParams;
  const oauthResult = (meta ? META_RESULT[meta] : undefined) ?? (google ? GOOGLE_RESULT[google] : undefined);
  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  const [rows, ownBot] = await Promise.all([listIntegrations(ctx), getOwnTelegramBot(workspace.organization.id)]);
  // Com bot próprio configurado, o vínculo rápido aponta para ele (o webhook dele só atende esta empresa).
  const ownBotUsername = botUsernameOrNull(ownBot?.username);
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

      {oauthResult && (
        <p
          role="status"
          className={
            oauthResult.tone === "ok"
              ? "rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm text-primary"
              : "rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          }
        >
          {oauthResult.text}
        </p>
      )}

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
                  <div className="space-y-4">
                    <TelegramLinkPanel botUsername={ownBotUsername ?? PLATFORM_BOT_USERNAME} />
                    {isAdmin && (
                      <OwnBotPanel eligible={canUseOwnBot(workspace.organization)} botUsername={ownBotUsername} />
                    )}
                  </div>
                ) : META_PROVIDERS.includes(guide.provider) ? (
                  <div className="space-y-2">
                    {isAdmin ? (
                      <Button asChild>
                        {/* Navegação completa (não Link): a rota redireciona para o login da Meta. */}
                        <a href="/api/integrations/meta/start">Conectar com a Meta</a>
                      </Button>
                    ) : (
                      <Button type="button" disabled>
                        Conectar com a Meta
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {isAdmin
                        ? "Um único login conecta o Instagram, as Páginas e as contas de anúncios que você autorizar na Meta. Para incluir contas novas depois, é só conectar de novo."
                        : "Peça a um proprietário ou administrador da empresa para fazer a conexão."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {isAdmin ? (
                      <Button asChild>
                        <a
                          href={`/api/integrations/google/start?product=${guide.provider === "google_business" ? "business" : "calendar"}`}
                        >
                          Conectar com o Google
                        </a>
                      </Button>
                    ) : (
                      <Button type="button" disabled>
                        Conectar com o Google
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {isAdmin
                        ? guide.provider === "google_business"
                          ? "Entre com a conta Google que administra o Perfil da Empresa. Todos os locais autorizados aparecem aqui."
                          : "Entre com a conta Google da agenda que vai receber as reuniões marcadas pelo CRM."
                        : "Peça a um proprietário ou administrador da empresa para fazer a conexão."}
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
