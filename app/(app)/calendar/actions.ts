"use server";

import { revalidatePath } from "next/cache";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { requestSocialRetry, requestSocialRetrySchema, saveSocialPost, saveSocialPostSchema } from "@/lib/services/social-posts";
import { requireWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { confirmSocialAction, proposePublishNow } from "@/lib/services/social-confirmations";

export async function preparePublishNowAction(input: unknown): Promise<{ code?: string; preview?: { format: string; caption: string; hashtags: string[]; mediaCount: number; channels: string[] }; error?: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`calendar:user:${workspace.user.id}`, RATE_LIMITS.calendarUser))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = z.object({ postId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Confira o post selecionado." };
  try {
    const proposal = await proposePublishNow(serviceContext(workspace, "manual"), { conversationId: null }, parsed.data.postId);
    return { code: proposal.code, preview: { format: proposal.post.format, caption: proposal.post.caption, hashtags: proposal.post.hashtags, mediaCount: proposal.post.media.length, channels: proposal.post.social_post_targets.map((target: { channel: string }) => target.channel) } };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[calendar] falha ao preparar publicação", error);
    return { error: "Não foi possível preparar a publicação. Tente novamente." };
  }
}

export async function confirmPublishNowAction(input: unknown): Promise<{ success?: boolean; error?: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`calendar:user:${workspace.user.id}`, RATE_LIMITS.calendarUser))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = z.object({ code: z.string().regex(/^[0-9a-f]{32}$/) }).safeParse(input);
  if (!parsed.success) return { error: "Confirmação inválida. Prepare a publicação novamente." };
  try {
    await confirmSocialAction(serviceContext(workspace, "manual"), { conversationId: null }, parsed.data.code);
    revalidatePath("/calendar");
    return { success: true };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[calendar] falha ao confirmar publicação", error);
    return { error: "Não foi possível concluir a publicação. Confira o estado do post antes de tentar novamente." };
  }
}

export async function savePostAction(input: unknown): Promise<{ success?: boolean; error?: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`calendar:user:${workspace.user.id}`, RATE_LIMITS.calendarUser))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = saveSocialPostSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.code === "custom" ? issue.message : "Confira os dados do post e tente novamente." };
  }
  try {
    await saveSocialPost(serviceContext(workspace, "manual"), parsed.data);
    revalidatePath("/calendar");
    return { success: true };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[calendar] falha ao salvar post", error);
    return { error: "Não foi possível salvar o post. Tente novamente em alguns instantes." };
  }
}

export async function retryPostAction(input: unknown): Promise<{ success?: boolean; error?: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`calendar:user:${workspace.user.id}`, RATE_LIMITS.calendarUser))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = requestSocialRetrySchema.safeParse(input);
  if (!parsed.success) return { error: "Confira o canal e confirme que o post não foi publicado." };
  try {
    await requestSocialRetry(serviceContext(workspace, "manual"), parsed.data);
    revalidatePath("/calendar");
    return { success: true };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[calendar] falha ao solicitar nova tentativa", error);
    return { error: "Não foi possível solicitar nova tentativa. Tente novamente em instantes." };
  }
}

const uploadSchema = z.object({ type: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4"]), size: z.number().int().min(1).max(52_428_800) });
export async function prepareMediaUpload(input: unknown): Promise<{ path?: string; token?: string; error?: string }> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`calendar:upload:${workspace.user.id}`, RATE_LIMITS.calendarUser))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { error: "Escolha uma imagem JPEG, PNG ou WebP ou um vídeo MP4 de até 50 MB." };
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4" }[parsed.data.type];
  const path = `${workspace.organization.id}/${randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from("social-media").createSignedUploadUrl(path);
  if (error || !data) return { error: "Não foi possível preparar o envio da mídia. Tente novamente." };
  return { path, token: data.token };
}
