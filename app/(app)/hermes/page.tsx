import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { serviceContext } from "@/lib/services/context";
import { listConversations, loadConversationMessages } from "@/lib/services/conversations";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/lib/workspace";
import { HermesChat } from "./chat";

export const metadata: Metadata = { title: "Agente Hermes" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short" });

export default async function HermesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  const conversations = await listConversations(ctx);

  // Só abre conversa que o RLS devolveu na lista; qualquer outro id vira conversa nova.
  const selected = z.uuid().safeParse(c).success ? conversations.find((conv) => conv.id === c) : undefined;
  const conversationId = selected?.id ?? crypto.randomUUID();
  const initialMessages = selected ? await loadConversationMessages(ctx, selected.id) : [];

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[240px_1fr]">
      <aside aria-label="Conversas" className="hidden lg:block">
        <Button asChild className="w-full">
          <Link href="/hermes">
            <MessageSquarePlus className="size-4" /> Nova conversa
          </Link>
        </Button>
        <nav className="mt-4 space-y-1">
          {conversations.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">Suas conversas com o Hermes aparecerão aqui.</p>
          )}
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/hermes?c=${conv.id}`}
              aria-current={conv.id === selected?.id ? "page" : undefined}
              className={cn(
                "block rounded-lg px-3 py-2 text-sm transition-colors",
                conv.id === selected?.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="block truncate">{conv.title}</span>
              <span className="text-xs opacity-70">{dateFormat.format(new Date(conv.updated_at))}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <HermesChat
        key={conversationId}
        conversationId={conversationId}
        initialMessages={initialMessages}
        userFirstName={workspace.profile.full_name?.split(" ")[0] ?? null}
      />
    </div>
  );
}
