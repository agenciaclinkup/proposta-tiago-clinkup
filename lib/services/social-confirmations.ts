import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { getSocialPost, socialPostPayload, socialPostSchema, validateSocialPost } from "./social-posts";
import { limitFor } from "./usage";
import { runClaim } from "./social-publish-worker";

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
type Binding = { conversationId: string | null };

async function createConfirmation(ctx: ServiceContext, binding: Binding, operation: "weekly" | "publish_now" | "schedule_post", payload: unknown) {
  if (!ctx.userId || !["web", "telegram"].includes(ctx.channel)) throw new ServiceError("Entre na sua conta para confirmar esta ação.");
  const admin = createAdminClient();
  const membership = await admin.from("organization_members").select("user_id").eq("organization_id", ctx.organizationId).eq("user_id", ctx.userId).maybeSingle();
  if (membership.error || !membership.data) throw new ServiceError("Você não tem acesso a esta empresa.");
  const code = randomBytes(16).toString("hex");
  const result = await admin.from("social_confirmations").insert({ organization_id: ctx.organizationId, user_id: ctx.userId, channel: ctx.channel, conversation_id: binding.conversationId, operation, payload, proof_hash: hash(code) });
  if (result.error?.message.includes("social_integration_invalid")) throw new ServiceError("Confira as contas conectadas em Integrações antes de continuar.");
  if (result.error) throw new Error(result.error.message);
  return code;
}

export async function proposeSocialWeek(ctx: ServiceContext, binding: Binding, posts: z.output<typeof socialPostSchema>[]) {
  if (posts.length < 1 || posts.length > 7) throw new ServiceError("Escolha de um a sete posts para a proposta.");
  const payload = posts.map((post) => socialPostPayload(validateSocialPost(ctx, { status: "scheduled", post }).post));
  return createConfirmation(ctx, binding, "weekly", payload);
}

export async function proposePublishNow(ctx: ServiceContext, binding: Binding, postId: string) {
  const post = await getSocialPost(ctx, postId);
  if (!["draft", "scheduled"].includes(post.status) || post.social_post_targets.some((target: { attempt_count: number }) => target.attempt_count > 0)) throw new ServiceError("Este post não pode ser publicado imediatamente. Confira o status e os canais.");
  validateSocialPost(ctx, { status: "scheduled", post: {
    format: post.format, caption: post.caption, hashtags: post.hashtags, media: post.media,
    targets: post.social_post_targets.map((target: { channel: "instagram" | "facebook" | "google_business"; integration_id: string }) => ({ channel: target.channel, integrationId: target.integration_id })),
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
  } });
  const code = await createConfirmation(ctx, binding, "publish_now", { postId, updatedAt: post.updated_at });
  return { code, post };
}

// Agendar um rascunho existente (ex.: exportado do Estúdio) sem criar outro post; vincula a versão aprovada.
export async function proposeScheduledPost(ctx: ServiceContext, binding: Binding, input: { postId: string; scheduledAt: string; targets: z.input<typeof socialPostSchema>["targets"] }) {
  const post = await getSocialPost(ctx, input.postId);
  if (post.status !== "draft") throw new ServiceError("Somente rascunhos podem ser agendados por esta confirmação.");
  const checked = validateSocialPost(ctx, { status: "scheduled", post: { format: post.format, caption: post.caption, hashtags: post.hashtags, media: post.media, targets: input.targets ?? [], scheduledAt: input.scheduledAt } });
  const code = await createConfirmation(ctx, binding, "schedule_post", { postId: post.id, updatedAt: post.updated_at, post: socialPostPayload(checked.post) });
  return { code, post: checked.post };
}

export async function confirmSocialAction(ctx: ServiceContext, binding: Binding, proof: string) {
  if (!ctx.userId || !/^[0-9a-f]{32}$/.test(proof)) throw new ServiceError("Confirmação inválida. Solicite uma nova proposta.");
  const { data, error } = await createAdminClient().rpc("confirm_social_action", { p_org: ctx.organizationId, p_user: ctx.userId, p_channel: ctx.channel, p_conversation: binding.conversationId, p_hash: hash(proof), p_limit: limitFor(ctx.planId, "scheduled_posts") });
  if (error) {
    if (error.message.includes("social_limit_reached")) throw new ServiceError("O limite mensal de posts do plano foi atingido.");
    if (error.message.includes("confirmation_post_changed")) throw new ServiceError("O post ou seus canais mudaram. Confira os dados e solicite uma nova confirmação.");
    if (error.message.includes("confirmation_invalid")) throw new ServiceError("Esta confirmação expirou, já foi usada ou pertence a outra conversa. Solicite uma nova proposta.");
    if (error.message.includes("social_integration_invalid")) throw new ServiceError("Uma conta foi desconectada. Confira suas integrações e solicite outra proposta.");
    if (error.message.includes("social_schedule_invalid")) throw new ServiceError("Uma data da proposta já passou. Solicite uma nova proposta.");
    throw new Error(error.message);
  }
  if (data.operation === "schedule_post") return { operation: "schedule_post" as const, post: data.post };
  if (data.operation === "publish_now") {
    const processed = await runClaim({ id: data.postId, organizationId: data.organizationId, leaseToken: data.leaseToken }, data.integrationSnapshot);
    return { operation: "publish_now" as const, postId: data.postId, processed };
  }
  return { operation: "weekly" as const, posts: data.posts };
}
