import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPlan } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { limitFor, PlanLimitError } from "./usage";

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Informe uma cor hexadecimal válida.");
const assetPath = z.string().min(1).max(1000);
export const studioSlideSchema = z.strictObject({
  role: z.enum(["hook", "content", "cta"]), heading: z.string().trim().max(300),
  body: z.string().trim().max(3000), imagePath: assetPath.nullable(),
});
export const carouselSchema = z.strictObject({
  carouselId: z.uuid().optional(), title: z.string().trim().min(1).max(200), status: z.enum(["draft", "ready"]),
  theme: z.strictObject({ primaryColor: color.optional(), secondaryColor: color.optional(), backgroundColor: color.optional(), fontFamily: z.string().trim().min(1).max(100).optional() }),
  slides: z.array(studioSlideSchema).max(20), exportPaths: z.array(assetPath).max(20).optional(),
}).refine((value) => value.status !== "ready" || value.slides.length > 0, { message: "Adicione ao menos um slide para concluir o carrossel." });
const sectionSchema = z.strictObject({ type: z.enum(["hero", "content", "features", "testimonial", "cta", "form"]), heading: z.string().trim().max(300), body: z.string().trim().max(5000), imagePath: assetPath.nullable() });
export const landingPageSchema = z.strictObject({
  pageId: z.uuid().optional(), title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens no endereço."),
  sections: z.array(sectionSchema).max(30), pipelineId: z.uuid().nullable(), stageId: z.uuid().nullable(), published: z.boolean(),
}).refine((page) => (page.pipelineId === null) === (page.stageId === null), { message: "Escolha o funil e a etapa juntos." });
export const beginGenerationSchema = z.strictObject({ requestId: z.uuid(), carouselId: z.uuid(), kind: z.literal("carousel"), prompt: z.string().trim().min(1).max(5000) });
export const finishGenerationSchema = z.discriminatedUnion("status", [
  z.strictObject({ requestId: z.uuid(), status: z.literal("succeeded"), result: z.strictObject({ slides: z.array(studioSlideSchema).min(1).max(20) }) }),
  z.strictObject({ requestId: z.uuid(), status: z.literal("failed"), error: z.string().trim().min(1).max(1000) }),
]);

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ServiceError(issue?.code === "custom" || (issue?.code === "invalid_format" && !issue.message.startsWith("Invalid")) ? issue.message : "Confira os dados do Estúdio e tente novamente.");
  }
  return parsed.data;
}
function actor(ctx: ServiceContext) {
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para usar o Estúdio.");
  return ctx.userId;
}
function validateAsset(ctx: ServiceContext, path: string | null) {
  if (path && (!path.startsWith(`${ctx.organizationId}/`) || path.includes("..") || !/^[a-zA-Z0-9._-]+$/.test(path.slice(ctx.organizationId.length + 1))))
    throw new ServiceError("A imagem deve pertencer à sua empresa. Envie o arquivo novamente.");
}
function fail(error: { message: string; code?: string }, ctx: ServiceContext): never {
  if (error.message.includes("studio_limit_reached:")) throw new PlanLimitError("ai_credits", Number(error.message.match(/studio_limit_reached:(\d+)/)?.[1] ?? limitFor(ctx.planId, "ai_credits")), limitFor(ctx.planId, "ai_credits"), getPlan(ctx.planId)?.name ?? ctx.planId);
  if (error.message.includes("studio_forbidden")) throw new ServiceError("Você não tem acesso a esta empresa.");
  if (error.message.includes("studio_not_found")) throw new ServiceError("Não encontramos este projeto na sua empresa.");
  if (error.message.includes("studio_request_conflict")) throw new ServiceError("Esta solicitação de geração já foi usada com outros dados.");
  if (error.message.includes("studio_finished")) throw new ServiceError("Esta geração já foi finalizada.");
  if (error.code === "23505") throw new ServiceError("Este endereço já está em uso pela sua empresa.");
  if (error.code === "23503") throw new ServiceError("Confira o funil e a etapa escolhidos na sua empresa.");
  throw new Error(error.message);
}

export async function saveCarousel(ctx: ServiceContext, input: z.input<typeof carouselSchema>) {
  const data = parse(carouselSchema, input); const user = actor(ctx);
  data.slides.forEach((slide) => validateAsset(ctx, slide.imagePath));
  data.exportPaths?.forEach((path) => validateAsset(ctx, path));
  const { carouselId, ...payload } = data;
  const result = await createAdminClient().rpc("save_studio_carousel", { p_org: ctx.organizationId, p_user: user, p_id: carouselId ?? null, p_via: ctx.via, p_payload: payload });
  if (result.error) fail(result.error, ctx);
  return result.data;
}
export async function saveLandingPage(ctx: ServiceContext, input: z.input<typeof landingPageSchema>) {
  const data = parse(landingPageSchema, input); const user = actor(ctx);
  data.sections.forEach((section) => validateAsset(ctx, section.imagePath));
  const { pageId, ...payload } = data;
  const result = await createAdminClient().rpc("save_studio_landing", { p_org: ctx.organizationId, p_user: user, p_id: pageId ?? null, p_via: ctx.via, p_payload: payload });
  if (result.error) fail(result.error, ctx);
  return result.data;
}
export async function beginStudioGeneration(ctx: ServiceContext, input: z.input<typeof beginGenerationSchema>) {
  const data = parse(beginGenerationSchema, input); const user = actor(ctx);
  const result = await createAdminClient().rpc("begin_studio_generation", { p_org: ctx.organizationId, p_user: user, p_request_id: data.requestId, p_carousel: data.carouselId, p_kind: data.kind, p_prompt: data.prompt, p_via: ctx.via, p_limit: limitFor(ctx.planId, "ai_credits") });
  if (result.error) fail(result.error, ctx);
  return result.data;
}
export async function finishStudioGeneration(ctx: ServiceContext, input: z.input<typeof finishGenerationSchema>) {
  const data = parse(finishGenerationSchema, input); const user = actor(ctx);
  if (data.status === "succeeded") data.result.slides.forEach((slide) => validateAsset(ctx, slide.imagePath));
  const result = await createAdminClient().rpc("finish_studio_generation", { p_org: ctx.organizationId, p_user: user, p_request_id: data.requestId, p_status: data.status, p_result: data.status === "succeeded" ? data.result : null, p_error: data.status === "failed" ? data.error : null });
  if (result.error) fail(result.error, ctx);
  return result.data;
}

export async function listCarousels(ctx: ServiceContext) {
  await requireMember(ctx);
  const { data, error } = await ctx.supabase.from("carousels").select("*, studio_slides(*)").eq("organization_id", ctx.organizationId).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function listLandingPages(ctx: ServiceContext) {
  await requireMember(ctx);
  const { data, error } = await ctx.supabase.from("landing_pages").select("*").eq("organization_id", ctx.organizationId).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function listStudioGenerations(ctx: ServiceContext, carouselId: string) {
  const id = parse(z.uuid(), carouselId); await requireMember(ctx);
  const { data, error } = await ctx.supabase.from("studio_generations").select("*").eq("organization_id", ctx.organizationId).eq("carousel_id", id).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function requireMember(ctx: ServiceContext) {
  const user = actor(ctx);
  const { data, error } = await createAdminClient().from("organization_members").select("user_id").eq("organization_id", ctx.organizationId).eq("user_id", user).maybeSingle();
  if (error || !data) throw new ServiceError("Você não tem acesso a esta empresa.");
}
export async function prepareStudioAssetUpload(ctx: ServiceContext, input: { type: "image/jpeg" | "image/png" | "image/webp"; size: number }) {
  const { type } = parse(z.strictObject({ type: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().min(1).max(52_428_800) }), input);
  await requireMember(ctx);
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
  const path = `${ctx.organizationId}/${randomUUID()}.${extension}`;
  const { data, error } = await createAdminClient().storage.from("studio-assets").createSignedUploadUrl(path);
  if (error || !data) throw new ServiceError("Não foi possível preparar o envio da imagem. Tente novamente.");
  return { path, token: data.token };
}
export async function getStudioAssetUrl(ctx: ServiceContext, path: string) {
  const checked = parse(assetPath, path); validateAsset(ctx, checked); await requireMember(ctx);
  const { data, error } = await createAdminClient().storage.from("studio-assets").createSignedUrl(checked, 300);
  if (error || !data) throw new ServiceError("Não foi possível acessar esta imagem. Tente novamente.");
  return data.signedUrl;
}
