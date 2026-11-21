"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACTION_LOG_LABELS,
  aggregateCampaignMetrics,
  computeCampaignMetrics,
  formatCentsBRL,
  formatPercentBR,
  OBJECTIVE_LABELS,
  parseBRLToCents,
  STATUS_LABELS,
} from "@/lib/meta-ads/metrics";
import {
  confirmMetaAdsAction,
  linkMetaAdAccountAction,
  pauseCampaignAction,
  proposeActivateCampaignAction,
  proposeCreateCampaignAction,
  proposeUpdateBudgetAction,
  syncMetaAdsAction,
  updateBudgetCapsAction,
  type PendingProposal,
} from "./actions";

export type MetaIntegrationView = {
  id: string;
  displayName: string;
  externalAccountId: string;
  status: string;
};

export type AdAccountView = {
  id: string;
  integration_id: string;
  external_ad_account_id: string;
  name: string;
  currency: string;
  account_status: number;
  business_id: string | null;
  pixel_id: string | null;
  daily_budget_cap_cents: number;
  monthly_budget_cap_cents: number;
  last_synced_at: string | null;
};

export type AdCampaignView = {
  id: string;
  ad_account_id: string;
  external_campaign_id: string | null;
  name: string;
  objective: string;
  daily_budget_cents: number;
  status: string;
  metrics: Record<string, unknown>;
  last_synced_at: string | null;
};

export type AdActionLogView = {
  id: string;
  ad_account_id: string;
  campaign_id: string | null;
  action: string;
  via: string;
  status: string;
  error: string | null;
  created_at: string;
};

type Props = {
  planName: string;
  isAdmin: boolean;
  readiness: {
    ready: boolean;
    planEnabled: boolean;
    maxActiveAdCampaigns: number;
    issues: string[];
  };
  integrations: MetaIntegrationView[];
  accounts: AdAccountView[];
  campaigns: AdCampaignView[];
  logs: AdActionLogView[];
};

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function MetaAdsView({ planName, isAdmin, readiness, integrations, accounts, campaigns, logs }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id ?? "");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [proposal, setProposal] = useState<PendingProposal | null>(null);
  const [confirmedCheck, setConfirmedCheck] = useState(false);

  const selectedAccount = accounts.find((acc) => acc.id === selectedAccountId) ?? accounts[0] ?? null;

  const [dailyCapInput, setDailyCapInput] = useState(
    selectedAccount ? (selectedAccount.daily_budget_cap_cents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [monthlyCapInput, setMonthlyCapInput] = useState(
    selectedAccount ? (selectedAccount.monthly_budget_cap_cents / 100).toFixed(2).replace(".", ",") : "",
  );

  // Formulário de nova campanha
  const [newName, setNewName] = useState("");
  const [newObjective, setNewObjective] = useState<
    "OUTCOME_LEADS" | "OUTCOME_TRAFFIC" | "OUTCOME_ENGAGEMENT" | "OUTCOME_AWARENESS" | "OUTCOME_SALES"
  >("OUTCOME_LEADS");
  const [newDailyBudget, setNewDailyBudget] = useState("50,00");
  const [newInitialStatus, setNewInitialStatus] = useState<"paused" | "active">("paused");

  // Ajustes de orçamento inline por campanha
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});

  const unlinkedIntegrations = useMemo(() => {
    const linkedIds = new Set(accounts.map((acc) => acc.integration_id));
    return integrations.filter((item) => !linkedIds.has(item.id));
  }, [accounts, integrations]);

  const accountCampaigns = useMemo(
    () => (selectedAccount ? campaigns.filter((c) => c.ad_account_id === selectedAccount.id) : []),
    [campaigns, selectedAccount],
  );

  const totals = useMemo(() => aggregateCampaignMetrics(accountCampaigns), [accountCampaigns]);
  const capConfigured = Boolean(selectedAccount && selectedAccount.daily_budget_cap_cents > 0);
  const canOperate = readiness.planEnabled && isAdmin && Boolean(selectedAccount) && capConfigured;

  function handleAccountChange(nextId: string) {
    setSelectedAccountId(nextId);
    const next = accounts.find((acc) => acc.id === nextId);
    if (next) {
      setDailyCapInput((next.daily_budget_cap_cents / 100).toFixed(2).replace(".", ","));
      setMonthlyCapInput((next.monthly_budget_cap_cents / 100).toFixed(2).replace(".", ","));
    }
    setProposal(null);
    setConfirmedCheck(false);
  }

  function handleLinkIntegration(integrationId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await linkMetaAdAccountAction({ integrationId });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setSelectedAccountId(res.accountId);
      setFeedback({ kind: "ok", text: "Conta de anúncios vinculada. Configure o teto diário antes de operar campanhas pagas." });
      router.refresh();
    });
  }

  function handleSaveCaps(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAccount) return;
    setFeedback(null);
    const dailyCents = parseBRLToCents(dailyCapInput);
    const monthlyCents = parseBRLToCents(monthlyCapInput || "0");
    if (dailyCents === null || monthlyCents === null) {
      setFeedback({ kind: "error", text: "Informe valores válidos em reais (ex.: 150,00)." });
      return;
    }
    startTransition(async () => {
      const res = await updateBudgetCapsAction({
        adAccountId: selectedAccount.id,
        dailyBudgetCapCents: dailyCents,
        monthlyBudgetCapCents: monthlyCents,
      });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setFeedback({ kind: "ok", text: "Tetos de orçamento atualizados com sucesso." });
      router.refresh();
    });
  }

  function handleSync() {
    if (!selectedAccount) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await syncMetaAdsAction({ adAccountId: selectedAccount.id });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setFeedback({
        kind: "ok",
        text: `Sincronização concluída: ${res.campaignsSynced} campanha(s) e ${res.snapshotsSynced} registro(s) de métricas atualizados.`,
      });
      router.refresh();
    });
  }

  function handleProposeCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAccount) return;
    setFeedback(null);
    const dailyBudgetCents = parseBRLToCents(newDailyBudget);
    if (dailyBudgetCents === null || dailyBudgetCents < 100) {
      setFeedback({ kind: "error", text: "Informe um orçamento diário válido de pelo menos R$ 1,00." });
      return;
    }
    startTransition(async () => {
      const res = await proposeCreateCampaignAction({
        adAccountId: selectedAccount.id,
        requestId: crypto.randomUUID(),
        name: newName,
        objective: newObjective,
        dailyBudgetCents,
        initialStatus: newInitialStatus,
      });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setProposal(res.proposal);
      setConfirmedCheck(false);
    });
  }

  function handleProposeActivate(campaignId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await proposeActivateCampaignAction({ campaignId });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setProposal(res.proposal);
      setConfirmedCheck(false);
    });
  }

  function handleProposeBudget(campaignId: string) {
    setFeedback(null);
    const raw = budgetDrafts[campaignId] ?? "";
    const cents = parseBRLToCents(raw);
    if (cents === null || cents < 100) {
      setFeedback({ kind: "error", text: "Informe um novo orçamento diário de pelo menos R$ 1,00." });
      return;
    }
    startTransition(async () => {
      const res = await proposeUpdateBudgetAction({ campaignId, dailyBudgetCents: cents });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setProposal(res.proposal);
      setConfirmedCheck(false);
    });
  }

  function handleConfirmProposal() {
    if (!proposal || !confirmedCheck) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await confirmMetaAdsAction({ code: proposal.code, confirmed: true });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setProposal(null);
      setConfirmedCheck(false);
      setNewName("");
      setFeedback({ kind: "ok", text: "Ação confirmada e executada com sucesso na conta Meta Ads." });
      router.refresh();
    });
  }

  function handlePause(campaignId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await pauseCampaignAction({ campaignId });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setFeedback({ kind: "ok", text: "Campanha pausada com segurança." });
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-primary">Tráfego Pago · Proteção Financeira</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold">
            <TrendingUp className="size-7 text-primary" aria-hidden /> Gestor Meta Ads
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Sincronize campanhas, defina tetos obrigatórios de orçamento e aprove alterações financeiras com trilha de auditoria.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card/60 px-5 py-4 backdrop-blur-sm">
          <p className="text-xs text-muted-foreground">Plano {planName} · Campanhas ativas</p>
          <p className="mt-1 text-2xl font-semibold">
            {totals.activeCount}{" "}
            <span className="text-sm font-normal text-muted-foreground">de {readiness.maxActiveAdCampaigns}</span>
          </p>
        </div>
      </header>

      {!readiness.planEnabled && (
        <section
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5"
        >
          <div className="space-y-1">
            <p className="font-medium text-amber-200">Meta Ads disponível nos planos Growth e Scale</p>
            <p className="text-sm text-amber-100/80">
              Seu plano atual ({planName}) não inclui gestão ativa de tráfego pago. Faça upgrade para sincronizar campanhas, definir tetos e publicar anúncios.
            </p>
          </div>
          <Button asChild>
            <Link href="/billing">Ver planos</Link>
          </Button>
        </section>
      )}

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={
            feedback.kind === "error"
              ? "rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
              : "rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary"
          }
        >
          {feedback.text}
        </p>
      )}

      {/* Prontidão e vínculo de conta */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border bg-card/50 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Prontidão da conta</h2>
            <span
              className={
                readiness.ready
                  ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300"
                  : "inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300"
              }
            >
              {readiness.ready ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              {readiness.ready ? "Pronta para operar" : "Pendências encontradas"}
            </span>
          </div>

          {readiness.issues.length > 0 ? (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {readiness.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Permissões Meta Ads, conta ativa e tetos de orçamento verificados para a sua organização.
            </p>
          )}

          {unlinkedIntegrations.length > 0 && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">Contas conectadas prontas para vincular</p>
              <div className="flex flex-wrap gap-2">
                {unlinkedIntegrations.map((item) => (
                  <Button
                    key={item.id}
                    size="sm"
                    variant="outline"
                    disabled={pending || !isAdmin || !readiness.planEnabled}
                    onClick={() => handleLinkIntegration(item.id)}
                  >
                    Vincular {item.displayName}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="meta-ad-account">Conta de anúncios</Label>
              <select
                id="meta-ad-account"
                value={selectedAccount?.id ?? ""}
                onChange={(e) => handleAccountChange(e.target.value)}
                disabled={accounts.length === 0}
                className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {accounts.length === 0 ? (
                  <option value="">Nenhuma conta vinculada</option>
                ) : (
                  accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.external_ad_account_id})
                    </option>
                  ))
                )}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!selectedAccount || pending || !readiness.planEnabled}
              onClick={handleSync}
            >
              <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} aria-hidden />
              Sincronizar agora
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/integrations">Gerenciar integrações</Link>
            </Button>
          </div>
          {selectedAccount?.last_synced_at && (
            <p className="text-xs text-muted-foreground">
              Última sincronização: {dateTimeFormat.format(new Date(selectedAccount.last_synced_at))} (Brasília)
            </p>
          )}
        </div>

        {/* Tetos financeiros */}
        <form onSubmit={handleSaveCaps} className="space-y-4 rounded-xl border border-border bg-card/50 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="size-5 text-primary" aria-hidden /> Tetos de orçamento
            </h2>
            <span className="text-xs text-muted-foreground">
              Comprometido ativo: {formatCentsBRL(totals.activeDailyBudgetCents)}/dia
            </span>
          </div>

          {!capConfigured && selectedAccount && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              O teto diário está zerado. Nenhuma criação, ativação ou ajuste de orçamento é permitido até configurar um teto acima de R$ 0,00.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="daily-cap">Teto diário (R$)</Label>
              <Input
                id="daily-cap"
                value={dailyCapInput}
                onChange={(e) => setDailyCapInput(e.target.value)}
                placeholder="Ex.: 200,00"
                disabled={!selectedAccount || !isAdmin || !readiness.planEnabled || pending}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="monthly-cap">Teto mensal (R$, opcional)</Label>
              <Input
                id="monthly-cap"
                value={monthlyCapInput}
                onChange={(e) => setMonthlyCapInput(e.target.value)}
                placeholder="Ex.: 5000,00"
                disabled={!selectedAccount || !isAdmin || !readiness.planEnabled || pending}
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "Somente proprietários e administradores podem alterar os tetos financeiros."
                : "Você está como membro: solicite a um administrador para configurar os tetos."}
            </p>
            <Button type="submit" disabled={!selectedAccount || !isAdmin || !readiness.planEnabled || pending}>
              Salvar tetos
            </Button>
          </div>
        </form>
      </section>

      {/* Painel de métricas */}
      <section aria-label="Métricas consolidadas" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {[
          { label: "Investimento", value: formatCentsBRL(totals.spendCents) },
          { label: "Impressões", value: totals.impressions.toLocaleString("pt-BR") },
          { label: "Cliques", value: totals.clicks.toLocaleString("pt-BR") },
          { label: "Leads / Resultados", value: totals.leads.toLocaleString("pt-BR") },
          { label: "CTR", value: formatPercentBR(totals.ctrPercent) },
          { label: "CPC médio", value: formatCentsBRL(totals.cpcCents) },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur-sm">
            <p className="text-xs text-muted-foreground">{kpi.label}</p>
            <p className="mt-2 text-xl font-semibold">{kpi.value}</p>
          </div>
        ))}
      </section>

      {/* Painel de confirmação explícita */}
      {proposal && (
        <section
          role="dialog"
          aria-label="Confirmação financeira obrigatória"
          className="space-y-4 rounded-xl border border-primary/50 bg-primary/10 p-6"
        >
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Aprovação financeira explícita</p>
            <h2 className="text-xl font-semibold">{proposal.title}</h2>
            <p className="text-sm text-muted-foreground">{proposal.details}</p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmedCheck}
              onChange={(e) => setConfirmedCheck(e.target.checked)}
              className="mt-1"
            />
            <span>Confirmo que revisei o impacto financeiro e autorizo a execução desta ação na conta Meta Ads.</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={!confirmedCheck || pending} onClick={handleConfirmProposal}>
              {pending ? "Executando…" : "Confirmar e executar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setProposal(null);
                setConfirmedCheck(false);
              }}
            >
              Cancelar proposta
            </Button>
          </div>
        </section>
      )}

      {/* Criar nova campanha */}
      <section className="rounded-xl border border-border bg-card/50 p-6 backdrop-blur-sm">
        <h2 className="text-lg font-semibold">Nova campanha (com aprovação explícita)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Toda criação gera primeiro uma proposta validada contra os tetos da conta e só é enviada à Meta após sua confirmação explícita.
        </p>
        <form onSubmit={handleProposeCreate} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="camp-name">Nome da campanha</Label>
            <Input
              id="camp-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex.: Captação Leads Novembro"
              disabled={!canOperate || pending}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="camp-objective">Objetivo</Label>
            <select
              id="camp-objective"
              value={newObjective}
              onChange={(e) => setNewObjective(e.target.value as typeof newObjective)}
              disabled={!canOperate || pending}
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Object.entries(OBJECTIVE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="camp-budget">Orçamento diário (R$)</Label>
            <Input
              id="camp-budget"
              value={newDailyBudget}
              onChange={(e) => setNewDailyBudget(e.target.value)}
              placeholder="50,00"
              disabled={!canOperate || pending}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="camp-status">Status inicial</Label>
            <select
              id="camp-status"
              value={newInitialStatus}
              onChange={(e) => setNewInitialStatus(e.target.value as "paused" | "active")}
              disabled={!canOperate || pending}
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="paused">Pausada (recomendado)</option>
              <option value="active">Ativa imediatamente</option>
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={!canOperate || pending || !newName.trim()}>
              Preparar proposta de campanha
            </Button>
          </div>
        </form>
      </section>

      {/* Listagem de campanhas */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Campanhas</h2>
            <p className="text-sm text-muted-foreground">
              Pausar interrompe o gasto imediatamente; ativar ou alterar orçamento exige confirmação explícita.
            </p>
          </div>
        </div>

        {accountCampaigns.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
            Nenhuma campanha sincronizada ou criada nesta conta ainda.
          </p>
        ) : (
          <ul className="space-y-3">
            {accountCampaigns.map((campaign) => {
              const m = computeCampaignMetrics(campaign.metrics);
              return (
                <li
                  key={campaign.id}
                  className="space-y-3 rounded-xl border border-border bg-card/50 p-5 backdrop-blur-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{campaign.name}</p>
                        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                          {STATUS_LABELS[campaign.status] ?? campaign.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {OBJECTIVE_LABELS[campaign.objective] ?? campaign.objective}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Orçamento diário: <strong className="text-foreground">{formatCentsBRL(campaign.daily_budget_cents)}</strong>
                      </p>
                    </div>

                    {isAdmin && readiness.planEnabled && (
                      <div className="flex flex-wrap items-center gap-2">
                        {campaign.status === "active" ? (
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => handlePause(campaign.id)}>
                            <Pause className="size-3.5" aria-hidden /> Pausar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending || !capConfigured}
                            onClick={() => handleProposeActivate(campaign.id)}
                          >
                            <Play className="size-3.5" aria-hidden /> Ativar
                          </Button>
                        )}
                        <Input
                          aria-label={`Novo orçamento diário de ${campaign.name}`}
                          placeholder="Novo R$/dia"
                          value={budgetDrafts[campaign.id] ?? ""}
                          onChange={(e) => setBudgetDrafts((cur) => ({ ...cur, [campaign.id]: e.target.value }))}
                          disabled={pending || !capConfigured}
                          className="h-9 w-28 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending || !capConfigured || !(budgetDrafts[campaign.id] ?? "").trim()}
                          onClick={() => handleProposeBudget(campaign.id)}
                        >
                          Propor verba
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs sm:grid-cols-6">
                    <div>
                      <span className="text-muted-foreground">Investimento</span>
                      <p className="font-medium">{formatCentsBRL(m.spendCents)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Impressões</span>
                      <p className="font-medium">{m.impressions.toLocaleString("pt-BR")}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cliques</span>
                      <p className="font-medium">{m.clicks.toLocaleString("pt-BR")}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Leads</span>
                      <p className="font-medium">{m.leads.toLocaleString("pt-BR")}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">CTR</span>
                      <p className="font-medium">{formatPercentBR(m.ctrPercent)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">CPC</span>
                      <p className="font-medium">{formatCentsBRL(m.cpcCents)}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Histórico de auditoria */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Histórico de auditoria</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/40 px-4 py-3 text-sm">
                <div>
                  <span className="font-medium">{ACTION_LOG_LABELS[log.action] ?? log.action}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    via {log.via === "hermes" ? "Hermes" : log.via === "system" ? "Sistema" : "Painel"}
                  </span>
                  {log.error && <p className="mt-0.5 text-xs text-destructive">{log.error}</p>}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className={log.status === "succeeded" ? "text-emerald-400" : "text-destructive"}>
                    {log.status === "succeeded" ? "Concluída" : "Falhou"}
                  </span>
                  <span>{dateTimeFormat.format(new Date(log.created_at))}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
