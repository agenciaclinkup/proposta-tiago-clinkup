import "server-only";
import { z } from "zod";
import { getPlan } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { limitFor, PlanLimitError } from "./usage";

const targetSchema = z.object({ channel: z.enum(["instagram", "facebook", "google_business"]), integrationId: z.uuid() });
export const socialPostSchema = z.object({
  format: z.enum(["feed", "reels", "stories", "carousel", "gmb_update"]),
  caption: z.string().trim().max(10000).default(""),
  hashtags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  media: z.array(z.object({ path: z.string().trim().min(1).max(1000), type: z.enum(["image", "video"]) })).max(10).default([]),
  targets: z.array(targetSchema).max(3).default([]),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).refine((post) => new Set(post.targets.map((target) => target.channel)).size === post.targets.length, { message: "Escolha apenas uma conta por canal.", path: ["targets"] });

export const saveSocialPostSchema = z.object({
  postId: z.uuid().optional(),
  status: z.enum(["draft", "scheduled"]),
  post: socialPostSchema,
}).superRefine(({ status, post }, ctx) => {
  if (status === "scheduled" && (!post.scheduledAt || new Date(post.scheduledAt).getTime() <= Date.now()))
    ctx.addIssue({ code: "custom", message: "Escolha data e horário futuros para agendar.", path: ["post", "scheduledAt"] });
  if (status === "scheduled" && post.targets.length === 0)
    ctx.addIssue({ code: "custom", message: "Escolha ao menos um canal para agendar.", path: ["post", "targets"] });
});

export async function saveSocialPost(ctx: ServiceContext, input: z.infer<typeof saveSocialPostSchema>) {
  const parsed = saveSocialPostSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "Dados do post inválidos.");
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para salvar um post.");
  const { post, postId, status } = parsed.data;
  if (post.media.some((item) => !item.path.startsWith(`${ctx.organizationId}/`) || item.path.includes(".."))) {
    throw new ServiceError("A mídia precisa pertencer à sua empresa. Envie o arquivo novamente.");
  }
  if (status === "scheduled") {
    for (const target of post.targets) {
      if (target.channel === "instagram") {
        const one = post.media.length === 1;
        const valid = (post.format === "feed" && one && post.media[0].type === "image") || (post.format === "reels" && one && post.media[0].type === "video") || (post.format === "stories" && one && !post.caption && post.hashtags.length === 0) || (post.format === "carousel" && post.media.length >= 2);
        if (!valid) throw new ServiceError("Confira o Instagram: Feed exige uma imagem, Reels um vídeo, Carrossel ao menos duas mídias e Stories uma mídia sem legenda ou hashtags.");
      }
      if (target.channel === "facebook") {
        const images = post.media.every((item) => item.type === "image");
        const valid = (post.format === "feed" && (post.media.length === 0 || images || (post.media.length === 1 && post.media[0].type === "video"))) || (post.format === "carousel" && post.media.length >= 2 && images) || (post.format === "reels" && post.media.length === 1 && post.media[0].type === "video");
        if (!valid) throw new ServiceError("No Facebook, escolha Feed, Carrossel com imagens ou Reels com um vídeo; Stories ainda não está disponível para publicação automática.");
      }
      if (target.channel === "google_business" && (!['feed', 'gmb_update'].includes(post.format) || post.media.length > 1 || post.media.some((item) => item.type !== "image") || (!post.caption && !post.hashtags.length))) {
        throw new ServiceError("No Google, escolha Feed ou Atualização Google, informe uma legenda e use no máximo uma imagem.");
      }
    }
  }
  const limit = limitFor(ctx.planId, "scheduled_posts");
  const { data, error } = await createAdminClient().rpc("save_social_post", {
    p_organization_id: ctx.organizationId, p_user_id: ctx.userId, p_post_id: postId ?? null,
    p_via: ctx.via, p_status: status, p_limit: limit,
    p_payload: { format: post.format, caption: post.caption, hashtags: post.hashtags, media: post.media,
      scheduled_at: post.scheduledAt ?? null, targets: post.targets.map((target) => ({ channel: target.channel, integration_id: target.integrationId })) },
  });
  if (error) {
    if (error.message.includes("social_limit_reached:")) {
      const used = Number(error.message.match(/social_limit_reached:(\d+)/)?.[1] ?? limit);
      throw new PlanLimitError("scheduled_posts", used, limit, getPlan(ctx.planId)?.name ?? ctx.planId);
    }
    if (error.message.includes("social_integration_invalid")) throw new ServiceError("Uma integração escolhida não está conectada ou não pertence à empresa. Verifique em Integrações.");
    if (error.message.includes("social_not_found")) throw new ServiceError("Não encontramos este post.");
    if (error.message.includes("social_forbidden")) throw new ServiceError("Você não tem acesso a esta empresa.");
    if (error.message.includes("social_state_invalid")) throw new ServiceError("Este post não pode ser alterado no status atual.");
    if (error.message.includes("social_schedule_invalid")) throw new ServiceError("Escolha canais e um horário futuro para agendar.");
    throw new Error(error.message);
  }
  return data;
}

export async function listSocialPosts(ctx: ServiceContext, options: { from?: string; to?: string; limit?: number; offset?: number } = {}) {
  const filter = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }).parse(options);
  let query = ctx.supabase.from("social_posts").select("*, social_post_targets(channel, integration_id, publish_state, publish_error, external_id)").eq("organization_id", ctx.organizationId).order("scheduled_at", { ascending: true, nullsFirst: false }).order("id").range(filter.offset, filter.offset + filter.limit - 1);
  if (filter.from) query = query.gte("scheduled_at", filter.from);
  if (filter.to) query = query.lt("scheduled_at", filter.to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
