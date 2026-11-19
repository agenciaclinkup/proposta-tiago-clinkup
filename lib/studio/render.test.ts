import { describe, expect, it } from "vitest";
import { renderStudioSlide } from "./render";

describe("renderização do slide", () => {
  it("gera PNG 1080x1350 com acentos", async () => {
    const png = await renderStudioSlide({ slide: { role: "hook", heading: "Sorriso renovado em 1 sessão", body: "Atendimento humanizado e tecnologia de ponta." }, theme: { primaryColor: "#00D4FF" }, index: 0, total: 3, backgroundUrl: null });
    expect([...png.slice(1, 4)].map((code) => String.fromCharCode(code)).join("")).toBe("PNG");
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1080, 1350]);
  }, 30_000);
});
