import { Trash2 } from "lucide-react";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { deleteConversationAction } from "./actions";

export function DeleteConversationButton({ conversationId, title }: { conversationId: string; title: string }) {
  return (
    <ConfirmActionButton
      action={deleteConversationAction}
      fields={{ conversationId }}
      confirmMessage={`Excluir a conversa "${title}"? As mensagens serão apagadas e não poderão ser recuperadas.`}
      variant="ghost"
      size="icon"
      aria-label={`Excluir a conversa ${title}`}
      title="Excluir conversa"
      className="size-8 text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </ConfirmActionButton>
  );
}
