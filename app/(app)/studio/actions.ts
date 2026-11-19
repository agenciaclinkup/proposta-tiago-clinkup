"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit, type RateRule } from "@/lib/rate-limit";
import { serviceContext, type ServiceContext } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { carouselSchema, getStudioAssetUrl, landingPageSchema, prepareStudioAssetUpload, saveCarousel, saveLandingPage } from "@/lib/services/studio";
import { exportCarouselSchema, exportCarouselToCalendar, generateCarousel, generateCarouselSchema, type GenerateCarouselResult } from "@/lib/services/studio-workflows";
import { requireWorkspace } from "@/lib/workspace";

type Failure = { error: string };

// Zod + sessão + rate limit + mensagens seguras: mesmo padrão das ações do calendário.
async function run<S extends z.ZodType, T>(schema: S, input: unknown, rule: RateRule, bucket: string, failure: string, task: (ctx: ServiceContext, data: z.output<S>) => Promise<T>): Promise<T | Failure> {
  const workspace = await requireWorkspace();
  if (!(await rateLimit(`studio:${bucket}:${workspace.user.id}`, rule))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.code === "custom" || (issue?.code === "invalid_format" && !issue.message.startsWith("Invalid")) ? issue.message : "Confira os dados do Estúdio e tente novamente." };
  }
  try {
    return await task(serviceContext(workspace, "manual"), parsed.data);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error(`[studio] ${failure}`, error);
    return { error: `${failure} Tente novamente em alguns instantes.` };
  }
}

export async function saveCarouselAction(input: unknown): Promise<{ id: string } | Failure> {
  return run(carouselSchema, input, RATE_LIMITS.studioUser, "user", "Não foi possível salvar o carrossel.", async (ctx, data) => {
    const saved = (await saveCarousel(ctx, data)) as { id: string };
    revalidatePath("/studio");
    return { id: saved.id };
  });
}

export async function saveLandingPageAction(input: unknown): Promise<{ id: string } | Failure> {
  return run(landingPageSchema, input, RATE_LIMITS.studioUser, "user", "Não foi possível salvar a landing page.", async (ctx, data) => {
    const saved = (await saveLandingPage(ctx, data)) as { id: string };
    revalidatePath("/studio");
    return { id: saved.id };
  });
}

export async function generateCarouselAction(input: unknown): Promise<GenerateCarouselResult | Failure> {
  return run(generateCarouselSchema, input, RATE_LIMITS.studioGenerateUser, "generate", "Não foi possível gerar os slides.", async (ctx, data) => {
    const result = await generateCarousel(ctx, data);
    revalidatePath("/studio");
    return result;
  });
}

export async function exportCarouselAction(input: unknown): Promise<{ postId: string } | Failure> {
  return run(exportCarouselSchema, input, RATE_LIMITS.studioUser, "user", "Não foi possível enviar o carrossel ao calendário.", async (ctx, data) => {
    const { post } = await exportCarouselToCalendar(ctx, data);
    revalidatePath("/calendar");
    revalidatePath("/studio");
    return { postId: (post as { id: string }).id };
  });
}

const uploadSchema = z.strictObject({ type: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.int().min(1).max(52_428_800) });
export async function prepareStudioUploadAction(input: unknown): Promise<{ path: string; token: string } | Failure> {
  return run(uploadSchema, input, RATE_LIMITS.studioUser, "user", "Não foi possível preparar o envio da imagem.", (ctx, data) => prepareStudioAssetUpload(ctx, data));
}

export async function studioAssetUrlsAction(input: unknown): Promise<{ urls: Record<string, string> } | Failure> {
  return run(z.array(z.string().min(1).max(1000)).max(20), input, RATE_LIMITS.studioUser, "user", "Não foi possível carregar as imagens.", async (ctx, paths) => {
    const unique = [...new Set(paths)];
    const urls = await Promise.all(unique.map((path) => getStudioAssetUrl(ctx, path)));
    return { urls: Object.fromEntries(unique.map((path, index) => [path, urls[index]!])) };
  });
}
