import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { studioGenerator, type GeneratedSlide, type StudioGenerator } from "@/lib/studio/generator";
import type { RenderSlideInput } from "@/lib/studio/render";
import { getBrandContext } from "./brand";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { saveSocialPost, socialPostSchema } from "./social-posts";
import { beginStudioGeneration, finishStudioGeneration, getCarousel, getStudioAssetUrl, saveCarousel } from "./studio";

// Geração "started" mais antiga que isso foi interrompida (deploy, timeout): encerra com estorno.
export const STALE_GENERATION_MS = 5 * 60_000;
export const generateCarouselSchema = z.strictObject({
  requestId: z.uuid(), carouselId: z.uuid(), prompt: z.string().trim().min(1).max(5000), slideCount: z.int().min(1).max(10).default(5),
});
export const exportCarouselSchema = z.strictObject({
  carouselId: z.uuid(),
  schedule: z.strictObject({ scheduledAt: z.iso.datetime({ offset: true }), targets: socialPostSchema.shape.targets }).nullable(),
});

type SlideRow = { position: number; role: GeneratedSlide["role"]; heading: string; body: string; image_path: string | null };
type CarouselRow = { id: string; title: string; status: string; theme: Record<string, string>; studio_slides: SlideRow[] };
type GenerationRow = { status: "started" | "succeeded" | "failed"; created_at: string; result: { slides: GeneratedSlide[] } | null };
export type GenerateCarouselResult = { status: GenerationRow["status"]; slides: GeneratedSlide[]; charged: boolean; message?: string };

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ServiceError("Confira os dados do Estúdio e tente novamente.");
  return parsed.data;
}
const ordered = (carousel: CarouselRow) => [...carousel.studio_slides].sort((a, b) => a.position - b.position);

async function applySlides(ctx: ServiceContext, carousel: CarouselRow, slides: GeneratedSlide[]) {
  const previous = ordered(carousel);
  await saveCarousel(ctx, {
    carouselId: carousel.id, title: carousel.title, status: "draft", theme: carousel.theme,
    slides: slides.map((slide, index) => ({ ...slide, imagePath: slide.imagePath ?? previous[index]?.image_path ?? null })),
  });
}

export async function generateCarousel(ctx: ServiceContext, input: z.input<typeof generateCarouselSchema>, generator: StudioGenerator = studioGenerator()): Promise<GenerateCarouselResult> {
  const { requestId, carouselId, prompt, slideCount } = parse(generateCarouselSchema, input);
  const carousel = (await getCarousel(ctx, carouselId)) as CarouselRow;
  const brandContext = (await getBrandContext(ctx))?.master_context ?? null;
  const request = { prompt, brandContext, slideCount };

  if (!generator.billable) {
    const slides = await generator.generate(request);
    await applySlides(ctx, carousel, slides);
    return { status: "succeeded", slides, charged: false };
  }

  const begun = (await beginStudioGeneration(ctx, { requestId, carouselId, kind: "carousel", prompt })) as { created: boolean; generation: GenerationRow };
  if (!begun.created) {
    const { generation } = begun;
    if (generation.status === "started" && Date.now() - Date.parse(generation.created_at) > STALE_GENERATION_MS) {
      await finishStudioGeneration(ctx, { requestId, status: "failed", error: "Geração interrompida antes de concluir." });
      return { status: "failed", slides: [], charged: false, message: "A geração anterior foi interrompida e o crédito foi devolvido. Gere novamente." };
    }
    // Mesma solicitação: nunca chama o provedor de novo nem cobra outra vez.
    return { status: generation.status, slides: generation.result?.slides ?? [], charged: false };
  }

  let slides: GeneratedSlide[];
  try {
    slides = await generator.generate(request);
  } catch (error) {
    console.error("[studio] falha no provedor de IA", error);
    await finishStudioGeneration(ctx, { requestId, status: "failed", error: "O provedor de IA não concluiu a geração." });
    throw new ServiceError("A IA não conseguiu gerar os slides agora. Seu crédito foi devolvido; tente novamente em instantes.");
  }
  await finishStudioGeneration(ctx, { requestId, status: "succeeded", result: { slides } });
  await applySlides(ctx, carousel, slides);
  return { status: "succeeded", slides, charged: true };
}

function captionFor(slides: SlideRow[]) {
  return slides.map((slide) => [slide.heading, slide.body].filter(Boolean).join("\n")).filter(Boolean).join("\n\n").slice(0, 2200);
}

export async function exportCarouselToCalendar(
  ctx: ServiceContext,
  input: z.input<typeof exportCarouselSchema>,
  render: (input: RenderSlideInput) => Promise<Uint8Array | ArrayBuffer> = async (slide) => (await import("@/lib/studio/render")).renderStudioSlide(slide),
) {
  const { carouselId, schedule } = parse(exportCarouselSchema, input);
  const carousel = (await getCarousel(ctx, carouselId)) as CarouselRow;
  if (carousel.status !== "ready") throw new ServiceError("Marque o carrossel como concluído antes de enviar ao calendário.");
  const slides = ordered(carousel);
  if (slides.length === 0) throw new ServiceError("Adicione ao menos um slide antes de enviar ao calendário.");
  if (slides.length > 10) throw new ServiceError("O calendário aceita até 10 slides por post. Remova slides antes de enviar.");

  const storage = createAdminClient().storage.from("social-media");
  const paths: string[] = [];
  try {
    for (const [index, slide] of slides.entries()) {
      const backgroundUrl = slide.image_path ? await getStudioAssetUrl(ctx, slide.image_path) : null;
      const image = await render({ slide: { role: slide.role, heading: slide.heading, body: slide.body }, theme: carousel.theme, index, total: slides.length, backgroundUrl });
      const path = `${ctx.organizationId}/${randomUUID()}.png`;
      const { error } = await storage.upload(path, image, { contentType: "image/png", upsert: false });
      if (error) throw new ServiceError("Não foi possível preparar as imagens do carrossel. Tente novamente.");
      paths.push(path);
    }
    const post = await saveSocialPost(ctx, {
      status: schedule ? "scheduled" : "draft",
      post: {
        format: slides.length > 1 ? "carousel" : "feed", caption: captionFor(slides), hashtags: [],
        media: paths.map((path) => ({ path, type: "image" as const })),
        targets: schedule?.targets ?? [], scheduledAt: schedule?.scheduledAt ?? null,
      },
    });
    return { post, mediaPaths: paths };
  } catch (error) {
    if (paths.length) {
      const { error: cleanup } = await storage.remove(paths).catch((reason: unknown) => ({ error: reason }));
      if (cleanup) console.error("[studio] arquivos órfãos após exportação", paths, cleanup);
    }
    throw error;
  }
}
