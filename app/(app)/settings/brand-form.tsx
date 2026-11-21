"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Paintbrush } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveOrganizationBrandAction } from "./actions";

type InitialBrand = {
  name: string;
  logoUrl: string;
  faviconUrl: string;
  primary: string;
  secondary: string;
  supportEmail: string;
  supportWhatsapp: string;
  hideClinkup: boolean;
};

export function WhiteLabelBrandForm({
  canEdit,
  isAdmin,
  planName,
  isWhiteLabel,
  initial,
}: {
  canEdit: boolean;
  isAdmin: boolean;
  planName: string;
  isWhiteLabel: boolean;
  initial: InitialBrand;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initial.faviconUrl);
  const [primary, setPrimary] = useState(initial.primary);
  const [secondary, setSecondary] = useState(initial.secondary);
  const [supportEmail, setSupportEmail] = useState(initial.supportEmail);
  const [supportWhatsapp, setSupportWhatsapp] = useState(initial.supportWhatsapp);
  const [hideClinkup, setHideClinkup] = useState(initial.hideClinkup);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await saveOrganizationBrandAction({
        name,
        logoUrl,
        faviconUrl,
        primary,
        secondary,
        supportEmail,
        supportWhatsapp,
        hideClinkup,
      });
      if ("error" in res) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setFeedback({ kind: "ok", text: "Identidade White-Label salva e aplicada no painel da organização." });
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-primary">Marca Própria & Suporte</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold">
            <Paintbrush className="size-7 text-primary" aria-hidden /> Identidade White-Label
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Personalize nome da plataforma, logotipo, favicon, cores, contato de WhatsApp de suporte e ocultação da marca Clinkup.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Plano {planName}</Badge>
          {isWhiteLabel && <Badge className="bg-primary/20 text-primary">White-Label ativo</Badge>}
        </div>
      </header>

      {!canEdit && (
        <section
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5"
        >
          <div className="space-y-1">
            <p className="font-medium text-amber-200">
              {!isAdmin ? "Permissão restrita a administradores" : "Recurso disponível no plano Scale ou licença White-Label"}
            </p>
            <p className="text-sm text-amber-100/80">
              {!isAdmin
                ? "Apenas proprietários e administradores podem alterar a identidade visual da organização."
                : "Faça upgrade para o plano Scale ou solicite a liberação da licença White-Label para personalizar a plataforma."}
            </p>
          </div>
          {isAdmin && (
            <Button asChild>
              <Link href="/billing">Ver planos</Link>
            </Button>
          )}
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

      <Card className="glass">
        <CardHeader>
          <CardTitle>Configurações da marca</CardTitle>
          <CardDescription>
            As alterações valem imediatamente para todos os membros desta organização no painel autenticado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="wl-name">Nome da plataforma</Label>
                <Input
                  id="wl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canEdit || pending}
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="wl-email">E-mail de suporte</Label>
                <Input
                  id="wl-email"
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  disabled={!canEdit || pending}
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="wl-whatsapp">WhatsApp de suporte (DDI + DDD + número)</Label>
                <Input
                  id="wl-whatsapp"
                  value={supportWhatsapp}
                  onChange={(e) => setSupportWhatsapp(e.target.value)}
                  placeholder="Ex.: +5511999998888"
                  disabled={!canEdit || pending}
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="wl-logo">URL do logotipo (HTTPS, opcional)</Label>
                <Input
                  id="wl-logo"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://suamarca.com.br/logo.png"
                  disabled={!canEdit || pending}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="wl-favicon">URL do favicon (HTTPS, opcional)</Label>
                <Input
                  id="wl-favicon"
                  value={faviconUrl}
                  onChange={(e) => setFaviconUrl(e.target.value)}
                  placeholder="https://suamarca.com.br/favicon.ico"
                  disabled={!canEdit || pending}
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="wl-primary">Cor primária</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Seletor de cor primária"
                      value={/^#[0-9a-fA-F]{6}$/.test(primary) ? primary : "#00D4FF"}
                      onChange={(e) => setPrimary(e.target.value)}
                      disabled={!canEdit || pending}
                      className="h-10 w-10 cursor-pointer rounded border border-input bg-transparent"
                    />
                    <Input
                      id="wl-primary"
                      value={primary}
                      onChange={(e) => setPrimary(e.target.value)}
                      disabled={!canEdit || pending}
                      required
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="wl-secondary">Cor secundária</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Seletor de cor secundária"
                      value={/^#[0-9a-fA-F]{6}$/.test(secondary) ? secondary : "#2563EB"}
                      onChange={(e) => setSecondary(e.target.value)}
                      disabled={!canEdit || pending}
                      className="h-10 w-10 cursor-pointer rounded border border-input bg-transparent"
                    />
                    <Input
                      id="wl-secondary"
                      value={secondary}
                      onChange={(e) => setSecondary(e.target.value)}
                      disabled={!canEdit || pending}
                      required
                    />
                  </div>
                </div>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-border bg-card/40 p-3.5 text-sm">
              <input
                type="checkbox"
                checked={hideClinkup}
                onChange={(e) => setHideClinkup(e.target.checked)}
                disabled={!canEdit || pending}
                className="mt-1"
              />
              <span>
                <strong className="block">Ocultar referências da marca Clinkup</strong>
                <span className="text-xs text-muted-foreground">
                  Remove a assinatura &quot;Clinkup&quot; do rodapé e exibe exclusivamente a identidade da sua empresa.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-block size-4 rounded-full" style={{ backgroundColor: primary }} />
                <span className="inline-block size-4 rounded-full" style={{ backgroundColor: secondary }} />
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="size-3.5" aria-hidden /> Suporte WhatsApp exibido no menu lateral
                </span>
              </div>
              <Button type="submit" disabled={!canEdit || pending}>
                {pending ? "Salvando…" : "Salvar identidade White-Label"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
