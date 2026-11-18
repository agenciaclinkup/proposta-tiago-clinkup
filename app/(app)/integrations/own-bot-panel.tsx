"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Bot, Loader2, Trash2 } from "lucide-react";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectOwnBotAction, disconnectOwnBotAction } from "./actions";

// Só renderizado para owner/admin. A regra real (papel e plano) é aplicada no servidor.
export function OwnBotPanel({ eligible, botUsername }: { eligible: boolean; botUsername: string | null }) {
  const [state, action, pending] = useActionState(connectOwnBotAction, undefined);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Bot className="size-4 text-primary" aria-hidden /> Bot próprio da empresa
      </p>

      {!eligible ? (
        <p className="text-muted-foreground">
          Use um bot com o nome e a foto da sua marca no Telegram. Disponível nos planos Scale e White-Label.{" "}
          <Link href="/billing" className="text-primary hover:underline">
            Conhecer os planos
          </Link>
          .
        </p>
      ) : botUsername ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground">
            A equipe conversa com o Hermes pelo bot <span className="font-medium text-foreground">@{botUsername}</span>. Os
            códigos de vínculo já apontam para ele.
          </p>
          <ConfirmActionButton
            action={disconnectOwnBotAction}
            fields={{}}
            confirmMessage={`Remover o bot @${botUsername}? Os vínculos feitos por ele serão desfeitos e a equipe voltará a usar o bot da plataforma.`}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" /> Remover bot próprio
          </ConfirmActionButton>
        </div>
      ) : (
        <form action={action} className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>No Telegram, abra o @BotFather e envie /newbot.</li>
            <li>Escolha o nome e o usuário do bot (o usuário precisa terminar em “bot”).</li>
            <li>Copie o token que o @BotFather enviar e cole abaixo. Ele fica guardado com criptografia.</li>
          </ol>
          <div className="space-y-1.5">
            <Label htmlFor="botToken">Token do bot</Label>
            <Input
              id="botToken"
              name="botToken"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="123456789:ABC..."
              required
              aria-invalid={Boolean(state?.error)}
              aria-describedby={state?.error ? "botToken-error" : undefined}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Conectar bot próprio
          </Button>
        </form>
      )}

      {state?.error && (
        <p id="botToken-error" role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p role="status" className="text-primary">
          {state.success}
        </p>
      )}
    </div>
  );
}
