"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateTelegramCodeAction } from "./actions";

const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function TelegramLinkPanel({ botUsername }: { botUsername: string | null }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof generateTelegramCodeAction>> | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const linked = result && "code" in result ? result : null;
  const command = linked ? `/vincular ${linked.code}` : "";

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant={linked ? "outline" : "default"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setCopied(false);
            setResult(await generateTelegramCodeAction());
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
        {linked ? "Gerar novo código" : "Gerar código"}
      </Button>

      {result && "error" in result && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}

      {linked && (
        <div role="status" className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <div>
            <p className="text-muted-foreground">Seu código de vínculo</p>
            <p className="font-mono text-2xl font-semibold tracking-[0.3em] text-primary">{linked.code}</p>
            <p className="text-xs text-muted-foreground">
              Válido até {timeFormat.format(new Date(linked.expiresAt))} e só pode ser usado uma vez.
            </p>
          </div>

          {botUsername && (
            <Button asChild>
              <a href={`https://t.me/${botUsername}?start=${linked.code}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden /> Abrir o Telegram e vincular
              </a>
            </Button>
          )}

          <div className="space-y-1.5">
            <p className="text-muted-foreground">
              {botUsername
                ? "Ou, se preferir, envie esta mensagem na conversa com o bot:"
                : "Abra a conversa com o bot do Hermes no Telegram e envie esta mensagem:"}
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded-md bg-secondary px-2 py-1 font-mono">{command}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(command);
                  setCopied(true);
                }}
              >
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
