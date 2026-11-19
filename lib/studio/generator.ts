import "server-only";
import { anthropic, type AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { studioSlideSchema } from "@/lib/services/studio";

export type GeneratedSlide = z.infer<typeof studioSlideSchema>;
export type GenerateInput = { prompt: string; brandContext: string | null; slideCount: number };
// billable = consome crédito de IA (reserva e estorno via begin/finish_studio_generation).
export type StudioGenerator = { billable: boolean; generate(input: GenerateInput): Promise<GeneratedSlide[]> };

// Mesmo modelo do Hermes (lib/hermes/turn.ts); duplicado para não carregar o núcleo do chat aqui.
const STUDIO_MODEL = "claude-opus-5-5";
const outputSchema = z.object({
  slides: z.array(z.object({ role: z.enum(["hook", "content", "cta"]), heading: z.string().max(300), body: z.string().max(3000) })).min(1).max(10),
});

export const anthropicGenerator: StudioGenerator = {
  billable: true,
  async generate({ prompt, brandContext, slideCount }) {
    const { output } = await generateText({
      model: anthropic(STUDIO_MODEL),
      system: [
        "Você é o redator criativo do Estúdio da CLINKUP. Escreva carrosséis para redes sociais em português do Brasil.",
        `Crie exatamente ${slideCount} slides: o primeiro é o gancho (hook), o último é a chamada para ação (cta) e os demais são conteúdo.`,
        "Títulos curtos (até 80 caracteres) e textos objetivos (até 280 caracteres). Não invente preços, garantias ou dados que não foram informados.",
        brandContext ? `Contexto mestre da marca:\n${brandContext}` : "A empresa ainda não preencheu o contexto da marca; use um tom profissional e acolhedor.",
      ].join("\n\n"),
      prompt: `Pedido do usuário:\n${prompt}`,
      output: Output.object({ schema: outputSchema }),
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.timeout(90_000),
      providerOptions: { anthropic: { effort: "medium", fallbacks: "default", anthropicBeta: ["server-side-fallback-2026-07-01"] } satisfies AnthropicProviderOptions },
    });
    const parsed = outputSchema.parse(output);
    return parsed.slides.map((slide) => ({ role: slide.role, heading: slide.heading.trim(), body: slide.body.trim(), imagePath: null }));
  },
};

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Fallback sem provedor externo: estrutura editável, sem custo, para o usuário completar.
export const templateGenerator: StudioGenerator = {
  billable: false,
  async generate({ prompt, slideCount }) {
    const topic = cut(prompt.trim().split(/[.!?\n]/)[0]?.trim() || prompt.trim(), 120);
    return Array.from({ length: slideCount }, (_, index): GeneratedSlide => {
      if (index === 0) return { role: "hook", heading: topic, body: "Arraste para o lado e descubra como isso funciona para você.", imagePath: null };
      if (index === slideCount - 1) return { role: "cta", heading: "Gostou? Fale com a gente", body: "Envie uma mensagem ou toque no link da bio para saber mais.", imagePath: null };
      return { role: "content", heading: `Ponto ${index}`, body: `Explique aqui um benefício ou passo importante sobre: ${cut(topic, 80)}.`, imagePath: null };
    });
  },
};

export function studioGenerator(): StudioGenerator {
  return process.env.ANTHROPIC_API_KEY ? anthropicGenerator : templateGenerator;
}
