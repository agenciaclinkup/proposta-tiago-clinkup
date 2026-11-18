"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import { AlertTriangle, ArrowUp, Bot, Check, Loader2, MessageSquarePlus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_MESSAGE_LENGTH } from "@/lib/hermes/chat";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  get_brand_context: { running: "Consultando a memória da marca…", done: "Consultei a memória da marca" },
  update_brand_context: { running: "Atualizando a memória da marca…", done: "Atualizei a memória da marca" },
  get_plan_and_usage: { running: "Verificando seu plano e consumo…", done: "Verifiquei seu plano e consumo" },
  list_recent_activity: { running: "Buscando as atividades recentes…", done: "Busquei as atividades recentes" },
};

const SUGGESTIONS = [
  "O que você sabe sobre a minha empresa?",
  "Quanto do meu plano eu já usei este mês?",
  "Me dê 5 ideias de posts para esta semana com o tom da minha marca.",
  "Quais foram as últimas ações feitas na minha conta?",
];

function errorMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // resposta não-JSON: usa a mensagem padrão abaixo
  }
  return "Não consegui falar com o Hermes agora. Verifique sua conexão e tente novamente.";
}

export function HermesChat({
  conversationId,
  initialMessages,
  userFirstName,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
  userFirstName: string | null;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/hermes",
        // Envia só a mensagem nova; o servidor carrega o histórico do banco.
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { conversationId: id, message: messages[messages.length - 1] } }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, stop, clearError } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: () => router.refresh(),
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (messages.length === 0) window.history.replaceState(null, "", `/hermes?c=${conversationId}`);
    clearError();
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <section aria-label="Conversa com o Hermes" className="glass flex min-h-[70svh] flex-col rounded-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary to-brand-secondary text-primary-foreground">
            <Bot className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-base font-semibold">Agente Hermes</h1>
            <p className="text-xs text-muted-foreground">Seu assistente de marketing, vendas e automação</p>
          </div>
        </div>
        <Button asChild variant="ghost" size="sm" className="lg:hidden">
          <Link href="/hermes">
            <MessageSquarePlus className="size-4" /> Nova
          </Link>
        </Button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6" aria-live="polite">
        {messages.length === 0 && (
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-2xl font-semibold">
              Olá{userFirstName ? `, ${userFirstName}` : ""}! Como posso ajudar hoje?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Converse comigo como falaria com alguém da sua equipe. Eu já conheço a sua marca pelo onboarding e uso
              essas informações em todas as respostas.
            </p>
            <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-primary">O que já posso fazer</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>Consultar e ajustar a memória da sua marca</li>
                  <li>Mostrar seu plano e o consumo do mês</li>
                  <li>Listar as últimas ações da conta</li>
                  <li>Criar ideias e textos com o tom da sua marca</li>
                </ul>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium">Chegando em breve</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>Agendar posts no Instagram, Facebook e Google</li>
                  <li>Organizar leads no CRM</li>
                  <li>Criar carrosséis e campanhas de anúncios</li>
                  <li>Conversar pelo Telegram</li>
                </ul>
              </div>
            </div>
            <p className="mt-6 text-xs tracking-wide text-muted-foreground uppercase">Experimente perguntar</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            aria-label={message.role === "user" ? "Você" : "Hermes"}
            className={cn("flex gap-3", message.role === "user" && "justify-end")}
          >
            {message.role === "assistant" && (
              <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <Bot className="size-4" aria-hidden />
              </span>
            )}
            <div
              className={cn(
                "max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm leading-relaxed",
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary",
              )}
            >
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <p key={index} className="whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                }
                if (isToolUIPart(part)) {
                  const name = getToolName(part);
                  const label = TOOL_LABELS[name] ?? { running: "Executando uma ação…", done: "Ação executada" };
                  const output = part.state === "output-available" ? (part.output as { ok?: boolean } | undefined) : undefined;
                  const failed = part.state === "output-error" || output?.ok === false;
                  const running = part.state === "input-streaming" || part.state === "input-available";
                  return (
                    <p key={index} className="flex items-center gap-2 text-xs text-muted-foreground">
                      {running ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : failed ? (
                        <AlertTriangle className="size-3.5 text-amber-400" aria-hidden />
                      ) : (
                        <Check className="size-3.5 text-primary" aria-hidden />
                      )}
                      {running ? label.running : failed ? "Não consegui concluir esta ação" : label.done}
                    </p>
                  );
                }
                return null;
              })}
            </div>
          </article>
        ))}

        {status === "submitted" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> O Hermes está pensando…
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(error)}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="border-t border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="hermes-input" className="sr-only">
          Mensagem para o Hermes
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            id="hermes-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            placeholder="Escreva sua mensagem… (Enter envia, Shift+Enter quebra linha)"
            className="max-h-40 min-h-12 resize-none"
          />
          {busy ? (
            <Button type="button" size="icon" variant="outline" onClick={() => stop()} aria-label="Parar resposta">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Enviar mensagem">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada mensagem usa 1 crédito de IA do seu plano. O Hermes pode cometer erros: confira informações importantes.
        </p>
      </form>
    </section>
  );
}
