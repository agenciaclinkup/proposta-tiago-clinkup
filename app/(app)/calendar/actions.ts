"use server";

import { revalidatePath } from "next/cache";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { serviceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { saveSocialPost, saveSocialPostSchema } from "@/lib/services/social-posts";
import { requireWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { z } from "zod";

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
