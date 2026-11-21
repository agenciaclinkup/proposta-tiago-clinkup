import { describe, expect, it } from "vitest";
import { organizationBrandSchema, canManageOrganizationBrand } from "./organization-brand";
const valid = { name: "Empresa", logoUrl: "https://example.com/logo.png", faviconUrl: "", primary: "#123456", secondary: "#abcdef", supportEmail: "contato@example.com", supportWhatsapp: "5511999999999", hideClinkup: true };
describe("identidade da organizacao", () => {
  it("aceita dados validos e limpa favicon vazio", () => expect(organizationBrandSchema.parse(valid).faviconUrl).toBeNull());
  it("recusa urls com credenciais e cores invalidas", () => {
    expect(organizationBrandSchema.safeParse({ ...valid, logoUrl: "https://x:y@example.com" }).success).toBe(false);
    expect(organizationBrandSchema.safeParse({ ...valid, primary: "red" }).success).toBe(false);
  });
  it("limita acesso ao plano permitido e administrador", () => {
    expect(canManageOrganizationBrand({ role: "admin", planId: "scale", isWhiteLabel: false })).toBe(true);
    expect(canManageOrganizationBrand({ role: "member", planId: "scale", isWhiteLabel: true })).toBe(false);
    expect(canManageOrganizationBrand({ role: "owner", planId: "starter", isWhiteLabel: false })).toBe(false);
    expect(canManageOrganizationBrand({ role: "owner", planId: "starter", isWhiteLabel: true })).toBe(true);
    expect(canManageOrganizationBrand({ role: "member", planId: "starter", isWhiteLabel: false, isSuperAdmin: true })).toBe(true);
  });
});
