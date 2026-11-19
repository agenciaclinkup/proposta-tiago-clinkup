import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { listStages, resolveStage } from "@/lib/services/crm";
import { ServiceError } from "@/lib/services/errors";
import { proposeScheduledPost } from "@/lib/services/social-confirmations";
import { socialPostSchema } from "@/lib/services/social-posts";
import { carouselSchema, getCarousel, landingPageSchema, listCarousels, listLandingPages, saveCarousel, saveLandingPage } from "@/lib/services/studio";
import { exportCarouselToCalendar, generateCarouselSchema, generateCarousel } from "@/lib/services/studio-workflows";
import { defineTool } from "./run-tool";

type SlideRow = { position: number; role: string; heading: string; body: string; image_path: string | null };
export type StudioBinding = { conversationId: string; messageId: string };

// UUID v5 (SHA-1) de partes estáveis: a mesma mensagem com o mesmo pedido sempre gera a mesma chave de cobrança.
export function deterministicUuid(...parts: string[]) {
  const hex = createHash("sha1").update(JSON.stringify(["clinkup-studio", ...parts])).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const listStudioProjectsTool = defineTool({
  name: "list_studio_projects", description: "Lista os carrosséis e as landing pages do Estúdio da empresa, com IDs e resumo. Use os IDs para consultar, editar, gerar ou exportar.",
  input: z.object({}),
  execute: async (ctx) => {
    const [carousels, pages] = await Promise.all([listCarousels(ctx), listLandingPages(ctx)]);
    return {
      carousels: carousels.map((row) => ({ carouselId: row.id, title: row.title, status: row.status, slideCount: row.studio_slides.length, updatedAt: row.updated_at })),
      landingPages: pages.map((row) => ({ pageId: row.id, title: row.title, slug: row.slug, published: row.published, connectedToCrm: row.stage_id !== null, sectionCount: row.sections.length })),
    };
  },
});

const getStudioProjectTool = defineTool({
  name: "get_studio_project", description: "Mostra o conteúdo completo de um carrossel (slides e tema) ou de uma landing page (seções) no formato aceito para edição.",
  input: z.object({ type: z.enum(["carousel", "landing_page"]), id: z.uuid() }),
  execute: async (ctx, { type, id }) => {
    if (type === "carousel") {
      const row = await getCarousel(ctx, id);
      return { carouselId: row.id, title: row.title, status: row.status, theme: row.theme, slides: [...(row.studio_slides as SlideRow[])].sort((a, b) => a.position - b.position).map((slide) => ({ role: slide.role, heading: slide.heading, body: slide.body, imagePath: slide.image_path })) };
    }
    const page = (await listLandingPages(ctx)).find((row) => row.id === id);
    if (!page) throw new ServiceError("Não encontramos esta landing page na sua empresa.");
    return { pageId: page.id, title: page.title, slug: page.slug, sections: page.sections, published: page.published, stageId: page.stage_id };
  },
});

const saveCarouselTool = defineTool({
  name: "save_carousel", description: "Cria um carrossel (sem carouselId) ou substitui título, situação, tema e slides de um existente. Para editar, consulte antes com get_studio_project e preserve os slides e imagens que não mudam.",
  input: carouselSchema,
  execute: async (ctx, input) => {
    const saved = (await saveCarousel(ctx, input)) as { id: string; title: string; status: string };
    return { carouselId: saved.id, title: saved.title, status: saved.status };
  },
});

const saveLandingPageTool = defineTool({
  name: "save_landing_page", description: "Cria ou atualiza uma landing page (seções, endereço e situação). Informe em stage o nome da etapa do funil que receberá os leads, ou null para não enviar ao CRM.",
  input: z.object({ pageId: z.uuid().optional(), title: z.string(), slug: z.string(), sections: landingPageSchema.shape.sections, published: z.boolean(), stage: z.string().trim().min(1).max(100).nullable() }),
  execute: async (ctx, { stage, ...page }) => {
    let destination = { pipelineId: null as string | null, stageId: null as string | null };
    if (stage) {
      const stageId = await resolveStage(ctx, stage);
      destination = { stageId, pipelineId: (await listStages(ctx)).find((row) => row.id === stageId)?.pipeline_id ?? null };
    }
    const saved = (await saveLandingPage(ctx, { ...page, ...destination })) as { id: string; slug: string };
    return { pageId: saved.id, slug: saved.slug };
  },
});

export const STUDIO_TOOLS = [listStudioProjectsTool, getStudioProjectTool, saveCarouselTool, saveLandingPageTool];

const scheduleSchema = z.object({ scheduledAt: z.iso.datetime({ offset: true }), targets: socialPostSchema.shape.targets.unwrap().min(1) })
  .refine((value) => new Date(value.scheduledAt).getTime() > Date.now(), { message: "Escolha data e horário futuros para agendar." });

// Tools que dependem da mensagem atual (chave idempotente e confirmação vinculada à conversa).
export function buildStudioTurnTools(binding: StudioBinding | undefined) {
  const requireBinding = () => {
    if (!binding) throw new ServiceError("Não foi possível identificar esta conversa.");
    return binding;
  };
  const generateCarouselTool = defineTool({
    name: "generate_carousel", description: "Gera com IA os slides de um carrossel já salvo, usando o Contexto Mestre, e substitui os slides atuais. Pode usar 1 crédito de IA; não repita a chamada para o mesmo pedido.",
    input: generateCarouselSchema.omit({ requestId: true }),
    execute: async (ctx, input) => {
      const { conversationId, messageId } = requireBinding();
      if (!(await rateLimit(`studio:generate:${ctx.userId}`, RATE_LIMITS.studioGenerateUser))) throw new ServiceError(RATE_LIMIT_MESSAGE);
      const requestId = deterministicUuid(ctx.organizationId, ctx.userId ?? "", conversationId, messageId, input.carouselId, input.prompt, String(input.slideCount));
      const result = await generateCarousel(ctx, { ...input, requestId });
      const notice = result.status === "started" ? "A geração ainda está em andamento. Peça ao usuário para aguardar alguns segundos e consultar o carrossel."
        : result.status === "failed" ? result.message ?? "A geração não foi concluída."
        : result.charged ? "Slides gerados e salvos no carrossel (1 crédito de IA usado)." : "Slides salvos no carrossel.";
      return { ...result, notice };
    },
  });
  const exportTool = defineTool({
    name: "export_carousel_to_calendar", description: "Envia um carrossel concluído ao calendário como rascunho (padrão). Se o usuário pedir agendamento, informe schedule: o rascunho é criado e um comando de confirmação é gerado; o agendamento só acontece com confirm_calendar_action em nova mensagem. Chame uma única vez por pedido.",
    input: z.object({ carouselId: z.uuid(), schedule: scheduleSchema.optional() }),
    execute: async (ctx, { carouselId, schedule }) => {
      const { conversationId } = requireBinding();
      const { post } = (await exportCarouselToCalendar(ctx, { carouselId, schedule: null })) as { post: { id: string; status: string; format: string } };
      const draft = { postId: post.id, status: post.status, format: post.format, scheduled: false };
      if (!schedule) return draft;
      try {
        const proposal = await proposeScheduledPost(ctx, { conversationId }, { postId: post.id, ...schedule });
        return { ...draft, requiresConfirmation: true, instruction: `Para agendar este post, responda exatamente: CONFIRMAR ${proposal.code}` };
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
        return { ...draft, scheduleError: error.message, notice: "O rascunho foi criado no calendário, mas o agendamento não pôde ser preparado." };
      }
    },
  });
  return [generateCarouselTool, exportTool];
}
