"use client";

import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteConversationAction } from "./actions";

export function DeleteConversationButton({ conversationId, title }: { conversationId: string; title: string }) {
  const [state, action, pending] = useActionState(deleteConversationAction, undefined);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Excluir a conversa "${title}"? As mensagens serão apagadas e não poderão ser recuperadas.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={`Excluir a conversa ${title}`}
        title="Excluir conversa"
        className="size-8 text-muted-foreground hover:text-destructive"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </Button>
      {state?.error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
