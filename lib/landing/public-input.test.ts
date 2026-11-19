import { describe, expect, it } from "vitest";
import { captureSchema, publicSlugSchema } from "./public-input";

describe("captura pública", () => {
  it("exige consentimento e ao menos um contato válido", () => {
    expect(captureSchema.safeParse({ name: "Ana", email: "", whatsapp: "", message: "", consent: true, website: "" }).success).toBe(false);
    expect(captureSchema.safeParse({ name: "Ana", email: "ana@example.com", whatsapp: "", message: "Olá", consent: false, website: "" }).success).toBe(false);
    expect(captureSchema.safeParse({ name: "Ana", email: "ana@example.com", whatsapp: "", message: "   ", consent: true, website: "" }).success).toBe(false);
    expect(captureSchema.safeParse({ name: "Ana", email: "ana@example.com", whatsapp: "", message: "Olá", consent: true, website: "" }).success).toBe(true);
  });
  it("rejeita protocolos e controles em campos e slugs inválidos", () => {
    expect(captureSchema.safeParse({ name: "Ana", email: "", whatsapp: "javascript:alert(1)", message: "", consent: true, website: "" }).success).toBe(false);
    expect(publicSlugSchema.safeParse("../outra").success).toBe(false);
    expect(publicSlugSchema.safeParse("pagina-valida-1").success).toBe(true);
  });
});
