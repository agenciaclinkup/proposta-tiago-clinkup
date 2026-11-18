import { describe, expect, it } from "vitest";
import { getIntegrationGuide, INTEGRATION_CATALOG, INTEGRATION_PROVIDERS } from "./catalog";

describe("catálogo de integrações", () => {
  it("tem um guia para cada provedor do banco (enum integration_provider)", () => {
    expect(INTEGRATION_CATALOG.map((guide) => guide.provider)).toEqual([...INTEGRATION_PROVIDERS]);
  });

  it("cada guia é didático: nome, requisitos e pelo menos 3 passos com detalhe", () => {
    for (const guide of INTEGRATION_CATALOG) {
      expect(guide.name.length, guide.provider).toBeGreaterThan(3);
      expect(guide.requirements.length, guide.provider).toBeGreaterThan(0);
      expect(guide.steps.length, guide.provider).toBeGreaterThanOrEqual(3);
      for (const step of guide.steps) expect(step.detail.length, `${guide.provider}: ${step.title}`).toBeGreaterThan(30);
    }
  });

  it("busca o guia por provedor", () => {
    expect(getIntegrationGuide("telegram")?.name).toBe("Telegram");
    expect(getIntegrationGuide("tiktok" as never)).toBeUndefined();
  });
});
