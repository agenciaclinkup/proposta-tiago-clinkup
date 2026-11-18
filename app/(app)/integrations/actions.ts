"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { createTelegramLinkCode, disconnectIntegration, unlinkOwnTelegram } from "@/lib/services/integrations";
import { connectOwnTelegramBot, disconnectOwnTelegramBot } from "@/lib/services/telegram-bot";
import { requireWorkspace } from "@/lib/workspace";

export type IntegrationActionState = { error?: string; success?: string } | undefined;

// Sem payload: o código é sempre do usuário logado na org atual.
export async function generateTelegramCodeAction(): Promise<{ code: string; expiresAt: string } | { error: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`telegram-code:user:${workspace.user.id}`, RATE_LIMITS.telegramCodeUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }
  try {
    return await createTelegramLinkCode(serviceContext(workspace, "manual"));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[integrations] falha ao gerar código do Telegram", error);
    return { error: "Não consegui gerar o código agora. Tente novamente em alguns instantes." };
  }
}

export async function disconnectIntegrationAction(_: IntegrationActionState, formData: FormData): Promise<IntegrationActionState> {
  const parsed = z.uuid().safeParse(formData.get("integrationId"));
  if (!parsed.success) return { error: "Não consegui identificar a integração. Recarregue a página e tente novamente." };

  const workspace = await requireWorkspace();
  if (!(await rateLimit(`integrations:user:${workspace.user.id}`, RATE_LIMITS.integrationsUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  try {
    await disconnectIntegration(serviceContext(workspace, "manual"), parsed.data);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[integrations] falha ao desconectar", error);
    return { error: "Não consegui desconectar agora. Tente novamente em alguns instantes." };
  }

  revalidatePath("/integrations");
  return { success: "Integração desconectada. Você pode conectá-la de novo quando quiser." };
}

const botTokenSchema = z
  .string()
  .trim()
  .regex(/^\d{5,15}:[A-Za-z0-9_-]{30,}$/, "Esse não parece um token do @BotFather. Ele tem o formato 123456789:ABC... — copie a mensagem inteira do token.");

export async function connectOwnBotAction(_: IntegrationActionState, formData: FormData): Promise<IntegrationActionState> {
  const parsed = botTokenSchema.safeParse(formData.get("botToken"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const workspace = await requireWorkspace();
  if (!(await rateLimit(`telegram-bot:user:${workspace.user.id}`, RATE_LIMITS.telegramBotUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  try {
    const { username } = await connectOwnTelegramBot(serviceContext(workspace, "manual"), parsed.data, workspace.organization);
    revalidatePath("/integrations");
    return { success: `Bot @${username} conectado! A equipe já pode vincular o Telegram por ele.` };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[integrations] falha ao conectar bot próprio", error);
    return { error: "Não consegui conectar o bot agora. Tente novamente em alguns instantes." };
  }
}

export async function disconnectOwnBotAction(): Promise<IntegrationActionState> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`telegram-bot:user:${workspace.user.id}`, RATE_LIMITS.telegramBotUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }
  try {
    await disconnectOwnTelegramBot(serviceContext(workspace, "manual"));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[integrations] falha ao remover bot próprio", error);
    return { error: "Não consegui remover o bot agora. Tente novamente em alguns instantes." };
  }
  revalidatePath("/integrations");
  return { success: "Bot próprio removido. A equipe volta a usar o bot da plataforma." };
}

export async function unlinkTelegramAction(_: IntegrationActionState, formData: FormData): Promise<IntegrationActionState> {
  const parsed = z.uuid().safeParse(formData.get("integrationId"));
  if (!parsed.success) return { error: "Não consegui identificar o vínculo. Recarregue a página e tente novamente." };

  const workspace = await requireWorkspace();
  if (!(await rateLimit(`integrations:user:${workspace.user.id}`, RATE_LIMITS.integrationsUser))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  try {
    await unlinkOwnTelegram(serviceContext(workspace, "manual"), parsed.data);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[integrations] falha ao desvincular Telegram", error);
    return { error: "Não consegui desvincular agora. Tente novamente em alguns instantes." };
  }

  revalidatePath("/integrations");
  return { success: "Seu Telegram foi desvinculado. Para usar de novo, gere um novo código." };
}
