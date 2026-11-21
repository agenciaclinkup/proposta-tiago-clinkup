import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "./context";

const single = vi.fn();
const upsert = vi.fn(() => ({ select: () => ({ single }) }));
const from = vi.fn(() => ({ upsert }));
const adminFrom = vi.fn(() => ({ upsert }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: adminFrom }) }));

const { buildWhatsappSupportUrl, resolveEffectiveBrand, saveOrganizationBrand } = await import("./organization-brand");

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const validInput = {
  name: "Agência Aurora",
  logoUrl: "https://aurora.com.br/logo.png",
  faviconUrl: "",
  primary: "#10B981",
  secondary: "#047857",
  supportEmail: "suporte@aurora.com.br",
  supportWhatsapp: "+5511999998888",
  hideClinkup: true,
};

const baseCtx = {
  supabase: { from } as unknown as ServiceContext["supabase"],
  organizationId: orgId,
  userId,
  planId: "scale",
  role: "admin",
  via: "manual",
  channel: "web",
} as ServiceContext;

beforeEach(() => {
  vi.clearAllMocks();
  single.mockResolvedValue({
    data: {
      organization_id: orgId,
      name: validInput.name,
      logo_url: validInput.logoUrl,
      favicon_url: null,
      primary_color: validInput.primary,
      secondary_color: validInput.secondary,
      support_email: validInput.supportEmail,
      support_whatsapp: validInput.supportWhatsapp,
      hide_clinkup: true,
      updated_at: "2026-11-21T12:00:00Z",
    },
    error: null,
  });
});

describe("identidade White-Label por organização", () => {
  it("gera link WhatsApp seguro e resolve identidade efetiva", () => {
    expect(buildWhatsappSupportUrl("+55 11 99999-8888")).toBe("https://wa.me/5511999998888");
    expect(buildWhatsappSupportUrl("123")).toBeNull();

    const custom = resolveEffectiveBrand({
      organization_id: orgId,
      name: "Agência Aurora",
      logo_url: "https://aurora.com.br/logo.png",
      favicon_url: null,
      primary_color: "#10B981",
      secondary_color: "#047857",
      support_email: "suporte@aurora.com.br",
      support_whatsapp: "5511999998888",
      hide_clinkup: true,
      updated_at: "2026-11-21T12:00:00Z",
    });
    expect(custom).toMatchObject({
      name: "Agência Aurora",
      hideClinkup: true,
      whatsappUrl: "https://wa.me/5511999998888",
      customized: true,
    });

    const fallback = resolveEffectiveBrand(null);
    expect(fallback.customized).toBe(false);
    expect(fallback.hideClinkup).toBe(false);
  });

  it("bloqueia membro comum ou plano inelegível sem licença White-Label", async () => {
    await expect(
      saveOrganizationBrand({ ...baseCtx, role: "member" }, validInput, { isWhiteLabel: true }),
    ).rejects.toThrow("White-Label");
    await expect(
      saveOrganizationBrand({ ...baseCtx, planId: "starter", role: "owner" }, validInput, { isWhiteLabel: false }),
    ).rejects.toThrow("White-Label");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("salva identidade validada para admin em plano Scale e permite Super-Admin", async () => {
    const saved = await saveOrganizationBrand(baseCtx, validInput, { isWhiteLabel: false });
    expect(saved.name).toBe("Agência Aurora");
    expect(from).toHaveBeenCalledWith("organization_brands");

    await saveOrganizationBrand({ ...baseCtx, planId: "starter", role: "member" }, validInput, {
      isWhiteLabel: false,
      isSuperAdmin: true,
    });
    expect(adminFrom).toHaveBeenCalledWith("organization_brands");
  });
});
