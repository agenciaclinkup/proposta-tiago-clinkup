"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, QrCode, Receipt } from "lucide-react";
import { PLANS, formatBRL, type PlanId } from "@/config/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingInvoiceRow } from "@/lib/services/asaas-billing";
import { startAsaasSubscriptionAction } from "./actions";

const INVOICE_STATUS: Record<string, string> = {
  pending: "Aguardando pagamento",
  confirmed: "Confirmada",
  overdue: "Vencida",
  canceled: "Cancelada",
  refunded: "Estornada",
};

const dateBr = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

export function AsaasBillingPanel({
  isAdmin,
  defaultEmail,
  defaultName,
  currentPlanId,
  invoices,
}: {
  isAdmin: boolean;
  defaultEmail: string;
  defaultName: string;
  currentPlanId: PlanId;
  invoices: BillingInvoiceRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [planId, setPlanId] = useState<PlanId>(currentPlanId);
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO">("PIX");
  const [customerName, setCustomerName] = useState(defaultName);
  const [customerEmail, setCustomerEmail] = useState(defaultEmail);
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [activeInvoice, setActiveInvoice] = useState<BillingInvoiceRow | null>(invoices[0] ?? null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await startAsaasSubscriptionAction({
        planId,
        billingType,
        customerName,
        customerEmail,
        cpfCnpj,
      });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setActiveInvoice(res.invoice);
      setFeedback({
        kind: "ok",
        text: "Fatura gerada! Assim que o pagamento for confirmado pela Asaas, seu plano será ativado automaticamente.",
      });
      router.refresh();
    });
  }

  async function copyCode(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFeedback({ kind: "error", text: "Não foi possível copiar automaticamente. Selecione o código manualmente." });
    }
  }

  return (
    <section aria-label="Assinatura via Pix ou Boleto" className="space-y-6">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-primary" aria-hidden /> Assinar via Pix ou Boleto (Asaas)
          </CardTitle>
          <CardDescription>
            Assinatura mensal recorrente com confirmação automática por webhook.{" "}
            {!isAdmin && "Apenas proprietários e administradores podem gerar ou alterar cobranças."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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

          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label htmlFor="asaas-plan">Plano</Label>
              <select
                id="asaas-plan"
                value={planId}
                onChange={(e) => setPlanId(e.target.value as PlanId)}
                disabled={!isAdmin || pending}
                className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatBRL(p.priceMonthlyBRL)}/mês)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="asaas-method">Forma de pagamento</Label>
              <select
                id="asaas-method"
                value={billingType}
                onChange={(e) => setBillingType(e.target.value as "PIX" | "BOLETO")}
                disabled={!isAdmin || pending}
                className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="PIX">Pix (confirmação imediata)</option>
                <option value="BOLETO">Boleto bancário</option>
              </select>
            </div>

            <div>
              <Label htmlFor="asaas-name">Nome ou razão social</Label>
              <Input
                id="asaas-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                disabled={!isAdmin || pending}
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="asaas-email">E-mail financeiro</Label>
              <Input
                id="asaas-email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                disabled={!isAdmin || pending}
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="asaas-doc">CPF ou CNPJ</Label>
              <Input
                id="asaas-doc"
                value={cpfCnpj}
                onChange={(e) => setCpfCnpj(e.target.value)}
                placeholder="00.000.000/0001-00"
                disabled={!isAdmin || pending}
                className="mt-1"
                required
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-5">
              <Button type="submit" disabled={!isAdmin || pending}>
                {pending ? "Gerando cobrança…" : `Gerar assinatura via ${billingType === "PIX" ? "Pix" : "Boleto"}`}
              </Button>
            </div>
          </form>

          {activeInvoice && (activeInvoice.pix_copy_paste || activeInvoice.boleto_identification_field) && (
            <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  Fatura {activeInvoice.billing_type === "PIX" ? "Pix" : "Boleto"} ·{" "}
                  {formatBRL(activeInvoice.amount_cents / 100)}
                </p>
                <Badge variant="outline">{INVOICE_STATUS[activeInvoice.status] ?? activeInvoice.status}</Badge>
              </div>

              {activeInvoice.pix_copy_paste && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Pix Copia e Cola</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-background/80 p-2.5 text-xs">
                      {activeInvoice.pix_copy_paste}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => copyCode(activeInvoice.pix_copy_paste!)}
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copiado" : "Copiar Pix"}
                    </Button>
                  </div>
                </div>
              )}

              {activeInvoice.boleto_identification_field && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Linha digitável do boleto</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-background/80 p-2.5 text-xs">
                      {activeInvoice.boleto_identification_field}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => copyCode(activeInvoice.boleto_identification_field!)}
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copiado" : "Copiar código"}
                    </Button>
                  </div>
                </div>
              )}

              {(activeInvoice.invoice_url || activeInvoice.bank_slip_url) && (
                <div className="flex flex-wrap gap-3 pt-1 text-xs">
                  {activeInvoice.invoice_url && (
                    <a
                      href={activeInvoice.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Abrir fatura <ExternalLink className="size-3.5" />
                    </a>
                  )}
                  {activeInvoice.bank_slip_url && (
                    <a
                      href={activeInvoice.bank_slip_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Baixar PDF do boleto <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {invoices.length > 0 && (
            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Receipt className="size-4 text-primary" aria-hidden /> Faturas recentes
              </h3>
              <ul className="divide-y divide-border text-sm">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <span className="font-medium uppercase">{inv.billing_type}</span> · Plano {inv.plan_id} ·{" "}
                      {formatBRL(inv.amount_cents / 100)}
                      {inv.due_date && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Vencimento: {dateBr.format(new Date(`${inv.due_date}T12:00:00Z`))}
                        </span>
                      )}
                    </div>
                    <Badge variant={inv.status === "overdue" ? "destructive" : "outline"}>
                      {INVOICE_STATUS[inv.status] ?? inv.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
