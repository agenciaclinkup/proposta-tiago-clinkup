import { describe, expect, it } from "vitest";
import { parseTenantBrand } from "./tenant-brand";
describe("identidade White-Label", () => {
  it("usa identidade padrao quando nao configurada", () => {
    expect(parseTenantBrand({}).name).toBe("Clinkup Hermes");
  });
  it("aceita cores hexadecimais e enderecos web validos", () => {
    const brand = parseTenantBrand({ NEXT_PUBLIC_BRAND_PRIMARY: "#123abc", NEXT_PUBLIC_BRAND_LOGO_URL: "https://example.com/logo.png", NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP: "5511999999999" });
    expect(brand.colors.primary).toBe("#123abc");
    expect(brand.logoUrl).toBe("https://example.com/logo.png");
  });
  it.each(["javascript:alert(1)", "data:text/html,evil", "https://user:pass@example.com/a"])("rejeita URL insegura %s", (url) => {
    expect(() => parseTenantBrand({ NEXT_PUBLIC_BRAND_LOGO_URL: url })).toThrow();
  });
  it("rejeita cores e contatos invalidos", () => {
    expect(() => parseTenantBrand({ NEXT_PUBLIC_BRAND_PRIMARY: "red;" })).toThrow();
    expect(() => parseTenantBrand({ NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP: "123" })).toThrow();
    expect(() => parseTenantBrand({ NEXT_PUBLIC_BRAND_SUPPORT_EMAIL: "invalid" })).toThrow();
  });
});
