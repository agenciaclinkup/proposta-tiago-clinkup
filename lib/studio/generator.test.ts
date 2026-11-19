import { afterEach, describe, expect, it, vi } from "vitest";
const generateText = vi.fn();
vi.mock("ai", () => ({ generateText, Output: { object: (options: unknown) => options } }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: (model: string) => ({ model }) }));
const { anthropicGenerator, studioGenerator, templateGenerator } = await import("./generator");
const { studioSlideSchema } = await import("@/lib/services/studio");

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("gerador de modelo (sem provedor)", () => {
  it("monta gancho, conteúdo e chamada para ação válidos sem cobrar créditos", async () => {
    const slides = await templateGenerator.generate({ prompt: "Promoção de clareamento dental em novembro", brandContext: null, slideCount: 5 });
    expect(templateGenerator.billable).toBe(false);
    expect(slides).toHaveLength(5);
    expect(slides[0]?.role).toBe("hook");
    expect(slides.at(-1)?.role).toBe("cta");
    expect(slides[0]?.heading).toContain("clareamento");
    slides.forEach((slide) => expect(studioSlideSchema.safeParse(slide).success).toBe(true));
  });
  it("respeita os limites de quantidade", async () => {
    expect(await templateGenerator.generate({ prompt: "x", brandContext: null, slideCount: 1 })).toHaveLength(1);
    expect(await templateGenerator.generate({ prompt: "x".repeat(5000), brandContext: null, slideCount: 10 })).toHaveLength(10);
  });
});

describe("escolha do provedor", () => {
  it("usa o modelo seguro quando não há chave da Anthropic", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(studioGenerator()).toBe(templateGenerator);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    expect(studioGenerator()).toBe(anthropicGenerator);
  });
});

describe("provedor Anthropic", () => {
  it("envia o contexto da marca e devolve slides sem imagens", async () => {
    generateText.mockResolvedValue({ output: { slides: [{ role: "hook", heading: "Oi", body: "Texto" }, { role: "cta", heading: "Agende", body: "" }] } });
    const slides = await anthropicGenerator.generate({ prompt: "Campanha", brandContext: "Clínica odontológica premium", slideCount: 2 });
    expect(anthropicGenerator.billable).toBe(true);
    expect(slides).toEqual([{ role: "hook", heading: "Oi", body: "Texto", imagePath: null }, { role: "cta", heading: "Agende", body: "", imagePath: null }]);
    expect(generateText.mock.calls[0]?.[0].system).toContain("Clínica odontológica premium");
    expect(generateText.mock.calls[0]?.[0].prompt).toContain("Campanha");
  });
  it("rejeita resposta vazia para permitir o estorno", async () => {
    generateText.mockResolvedValue({ output: undefined });
    await expect(anthropicGenerator.generate({ prompt: "Campanha", brandContext: null, slideCount: 3 })).rejects.toThrow();
  });
});
