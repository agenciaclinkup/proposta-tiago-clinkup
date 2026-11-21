"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ShieldAlert, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminAuditLogRow, AdminGlobalOverview, AdminTenantSummary } from "@/lib/services/super-admin";
import { adminAdjustCreditsAction, adminUpdateSubscriptionAction } from "./actions";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
});

const STATUS_LABELS: Record<string, string> = {
  active: "Ativa",
  trialing: "Em teste",
  past_due: "Inadimplente",
  canceled: "Cancelada",
  incomplete: "Incompleta",
};

const ACTION_LABELS: Record<string, string> = {
  update_subscription: "Alteração de plano/assinatura",
  toggle_white_label: "Licença White-Label",
  adjust_ai_credits: "Ajuste de créditos de IA",
};

export function SuperAdminView({
  actorEmail,
  overview,
  auditLogs,
}: {
  actorEmail: string;
  overview: AdminGlobalOverview;
  auditLogs: AdminAuditLogRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedTenantId, setSelectedTenantId] = useState<string>(overview.tenants[0]?.id ?? "");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const filteredTenants = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overview.tenants.filter((tenant) => {
      if (planFilter !== "all" && tenant.planId !== planFilter) return false;
      if (statusFilter !== "all" && tenant.subscriptionStatus !== statusFilter) return false;
      if (q && !tenant.name.toLowerCase().includes(q) && !tenant.slug.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [overview.tenants, query, planFilter, statusFilter]);

  const selectedTenant: AdminTenantSummary | null =
    overview.tenants.find((t) => t.id === selectedTenantId) ?? filteredTenants[0] ?? null;

  const [editPlan, setEditPlan] = useState<"starter" | "growth" | "scale">(
    (selectedTenant?.planId as "starter" | "growth" | "scale") ?? "starter",
  );
  const [editStatus, setEditStatus] = useState<"trialing" | "active" | "past_due" | "canceled" | "incomplete">(
    (selectedTenant?.subscriptionStatus as "trialing" | "active" | "past_due" | "canceled" | "incomplete") ?? "active",
  );
  const [editWhiteLabel, setEditWhiteLabel] = useState<boolean>(selectedTenant?.isWhiteLabel ?? false);
  const [subReason, setSubReason] = useState("");

  const [creditDelta, setCreditDelta] = useState("500");
  const [creditReason, setCreditReason] = useState("");

  function selectTenant(tenant: AdminTenantSummary) {
    setSelectedTenantId(tenant.id);
    setEditPlan(tenant.planId as "starter" | "growth" | "scale");
    setEditStatus(tenant.subscriptionStatus as "trialing" | "active" | "past_due" | "canceled" | "incomplete");
    setEditWhiteLabel(tenant.isWhiteLabel);
    setFeedback(null);
  }

  function handleSaveSubscription(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTenant) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await adminUpdateSubscriptionAction({
        organizationId: selectedTenant.id,
        planId: editPlan,
        status: editStatus,
        isWhiteLabel: editWhiteLabel,
        reason: subReason,
      });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setSubReason("");
      setFeedback({ kind: "ok", text: `Assinatura e licença de "${selectedTenant.name}" atualizadas e registradas na auditoria.` });
      router.refresh();
    });
  }

  function handleAdjustCredits(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTenant) return;
    setFeedback(null);
    const delta = Number.parseInt(creditDelta, 10);
    if (!Number.isFinite(delta) || delta === 0) {
      setFeedback({ kind: "error", text: "Informe um número inteiro diferente de zero (ex.: 500 ou -100)." });
      return;
    }
    startTransition(async () => {
      const res = await adminAdjustCreditsAction({
        organizationId: selectedTenant.id,
        delta,
        reason: creditReason,
      });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setCreditReason("");
      setFeedback({
        kind: "ok",
        text: `Bônus de créditos de "${selectedTenant.name}" atualizado (bônus atual no mês: ${res.bonus.toLocaleString("pt-BR")}).`,
      });
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-primary">Operação Global SaaS · Acesso Restrito</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold">
            <ShieldAlert className="size-7 text-primary" aria-hidden /> Painel Super-Admin
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Monitore organizações clientes, consumo mensal de recursos e execute ajustes manuais com trilha de auditoria imutável.
          </p>
        </div>
        <Badge variant="outline">Operador: {actorEmail}</Badge>
      </header>

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

      {/* KPIs Globais */}
      <section aria-label="KPIs globais do SaaS" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Organizações cadastradas</CardDescription>
            <Building2 className="size-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">{overview.totalOrganizations.toLocaleString("pt-BR")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Starter: {overview.planDistribution.starter} · Growth: {overview.planDistribution.growth} · Scale: {overview.planDistribution.scale}
            </p>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Assinaturas</CardDescription>
            <Users className="size-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">{overview.activeSubscriptions.toLocaleString("pt-BR")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ativas · {overview.trialingSubscriptions} em teste · {overview.pastDueSubscriptions} inadimplente(s) · {overview.whiteLabelOrganizations} White-Label
            </p>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Créditos de IA no mês</CardDescription>
            <Sparkles className="size-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">{overview.totalAiCreditsUsedMonth.toLocaleString("pt-BR")}</p>
            <p className="mt-1 text-xs text-muted-foreground">Total consumido por todas as organizações</p>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Leads extraídos no mês</CardDescription>
            <Users className="size-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">{overview.totalScrapedLeadsMonth.toLocaleString("pt-BR")}</p>
            <p className="mt-1 text-xs text-muted-foreground">Volume mensal de prospecção B2B</p>
          </CardContent>
        </Card>
      </section>

      {/* Lista e inspeção de organizações */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <Label htmlFor="admin-search">Buscar organização</Label>
              <Input
                id="admin-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome ou slug…"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="admin-plan-filter">Plano</Label>
              <select
                id="admin-plan-filter"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">Todos</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="scale">Scale</option>
              </select>
            </div>
            <div>
              <Label htmlFor="admin-status-filter">Status</Label>
              <select
                id="admin-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">Todos</option>
                <option value="active">Ativa</option>
                <option value="trialing">Em teste</option>
                <option value="past_due">Inadimplente</option>
                <option value="canceled">Cancelada</option>
              </select>
            </div>
          </div>

          {filteredTenants.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
              Nenhuma organização encontrada com os filtros selecionados.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {filteredTenants.map((tenant) => {
                const isSelected = selectedTenant?.id === tenant.id;
                return (
                  <li key={tenant.id}>
                    <button
                      type="button"
                      onClick={() => selectTenant(tenant)}
                      className={`w-full rounded-xl border p-4 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card/50 hover:border-primary/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground">
                            /{tenant.slug} · Criada em {dateOnly.format(new Date(tenant.createdAt))} ·{" "}
                            {tenant.connectedIntegrations} conexão(ões)
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline">{tenant.planName}</Badge>
                          <Badge variant={tenant.subscriptionStatus === "past_due" ? "destructive" : "secondary"}>
                            {STATUS_LABELS[tenant.subscriptionStatus] ?? tenant.subscriptionStatus}
                          </Badge>
                          {tenant.isWhiteLabel && <Badge className="bg-primary/20 text-primary">White-Label</Badge>}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
                        <span>
                          IA: <strong className="text-foreground">{tenant.aiCreditsUsed}</strong>/{tenant.aiCreditsLimit}
                          {tenant.aiCreditsBonus > 0 ? ` (+${tenant.aiCreditsBonus})` : ""}
                        </span>
                        <span>
                          Leads: <strong className="text-foreground">{tenant.scrapedLeadsUsed}</strong>/{tenant.scrapedLeadsLimit}
                        </span>
                        <span>
                          Posts: <strong className="text-foreground">{tenant.scheduledPostsUsed}</strong>/{tenant.scheduledPostsLimit}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Painel de ações auditadas */}
        <div className="space-y-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">
                {selectedTenant ? `Gerenciar: ${selectedTenant.name}` : "Selecione uma organização"}
              </CardTitle>
              <CardDescription>
                Todas as alterações são gravadas em trilha de auditoria imutável.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {selectedTenant ? (
                <>
                  <form onSubmit={handleSaveSubscription} className="space-y-3">
                    <h3 className="text-sm font-medium">Plano, assinatura e White-Label</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="edit-plan">Plano</Label>
                        <select
                          id="edit-plan"
                          value={editPlan}
                          onChange={(e) => setEditPlan(e.target.value as typeof editPlan)}
                          disabled={pending}
                          className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="starter">Starter</option>
                          <option value="growth">Growth</option>
                          <option value="scale">Scale</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor="edit-status">Status</Label>
                        <select
                          id="edit-status"
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as typeof editStatus)}
                          disabled={pending}
                          className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="active">Ativa</option>
                          <option value="trialing">Em teste</option>
                          <option value="past_due">Inadimplente</option>
                          <option value="canceled">Cancelada</option>
                          <option value="incomplete">Incompleta</option>
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editWhiteLabel}
                        onChange={(e) => setEditWhiteLabel(e.target.checked)}
                        disabled={pending}
                      />
                      <span>Licença White-Label liberada</span>
                    </label>
                    <div>
                      <Label htmlFor="sub-reason">Motivo (auditoria obrigatória)</Label>
                      <Input
                        id="sub-reason"
                        value={subReason}
                        onChange={(e) => setSubReason(e.target.value)}
                        placeholder="Ex.: Cortesia de implantação / Contrato enterprise"
                        disabled={pending}
                        className="mt-1"
                        required
                      />
                    </div>
                    <Button type="submit" size="sm" className="w-full" disabled={pending || subReason.trim().length < 3}>
                      Salvar plano e licença
                    </Button>
                  </form>

                  <form onSubmit={handleAdjustCredits} className="space-y-3 border-t border-border pt-4">
                    <h3 className="text-sm font-medium">Bônus / ajuste de créditos de IA (mês atual)</h3>
                    <div>
                      <Label htmlFor="credit-delta">Quantidade (positivo concede bônus, negativo reduz)</Label>
                      <Input
                        id="credit-delta"
                        type="number"
                        value={creditDelta}
                        onChange={(e) => setCreditDelta(e.target.value)}
                        disabled={pending}
                        className="mt-1"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="credit-reason">Motivo (auditoria obrigatória)</Label>
                      <Input
                        id="credit-reason"
                        value={creditReason}
                        onChange={(e) => setCreditReason(e.target.value)}
                        placeholder="Ex.: Compensação de suporte técnico"
                        disabled={pending}
                        className="mt-1"
                        required
                      />
                    </div>
                    <Button type="submit" size="sm" variant="secondary" className="w-full" disabled={pending || creditReason.trim().length < 3}>
                      Aplicar ajuste de créditos
                    </Button>
                  </form>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Clique em uma organização à esquerda para inspecionar e gerenciar.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Trilha de auditoria imutável */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Trilha de auditoria imutável</h2>
        {auditLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação administrativa registrada ainda.</p>
        ) : (
          <ul className="space-y-2">
            {auditLogs.map((log) => (
              <li key={log.id} className="rounded-lg border border-border bg-card/40 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {ACTION_LABELS[log.action] ?? log.action} · <span className="text-muted-foreground">{log.actor_email}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{dateTime.format(new Date(log.created_at))}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Motivo: {log.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
