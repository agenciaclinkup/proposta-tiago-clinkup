import "server-only";
import type { UIMessage } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

type Ctx = Pick<ServiceContext, "supabase" | "organizationId">;

export const HISTORY_LIMIT = 40;

export async function listConversations(ctx: Ctx) {
  const { data, error } = await ctx.supabase
    .from("hermes_conversations")
    .select("id, title, updated_at")
    .eq("organization_id", ctx.organizationId)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return data;
}

// Conversa nova é criada com o id gerado no navegador; id de outra pessoa cai no RLS/PK e vira "não encontrada".
export async function ensureConversation(ctx: Ctx, conversationId: string, title: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("hermes_conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return;

  const { error: insertError } = await ctx.supabase
    .from("hermes_conversations")
    .insert({ id: conversationId, organization_id: ctx.organizationId, title });
  if (insertError) throw new ServiceError("Não encontramos esta conversa. Comece uma nova conversa para continuar.");
}

// RLS só deixa o dono excluir; 0 linhas = conversa alheia ou inexistente. Mensagens caem em cascata.
export async function deleteConversation(ctx: Ctx, conversationId: string): Promise<void> {
  const { data, error } = await ctx.supabase.from("hermes_conversations").delete().eq("id", conversationId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ServiceError("Não encontramos esta conversa. Ela pode já ter sido excluída.");
}

// Histórico confiável (gravado pelo servidor), limitado às mensagens mais recentes.
export async function loadConversationMessages(ctx: Ctx, conversationId: string): Promise<UIMessage[]> {
  const { data, error } = await ctx.supabase
    .from("hermes_messages")
    .select("message_id, role, parts")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .reverse()
    .map((row) => ({ id: row.message_id, role: row.role as UIMessage["role"], parts: row.parts as UIMessage["parts"] }));
}

export async function saveConversationMessages(ctx: Ctx, conversationId: string, messages: UIMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin.from("hermes_messages").upsert(
    messages.map((message) => ({
      conversation_id: conversationId,
      organization_id: ctx.organizationId,
      message_id: message.id,
      role: message.role,
      parts: message.parts,
    })),
    { onConflict: "conversation_id,message_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  await admin.from("hermes_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
}
