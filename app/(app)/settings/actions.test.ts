import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";

const requireWorkspace = vi.fn();
const rateLimit = vi.fn();
const revalidatePath = vi.fn();
const saveOrganizationBrand = vi.fn();

vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  RATE_LIMIT_MESSAGE: "Muitas tentativas.",
  RATE_LIMITS: { onboardingUser: { limit: 20, windowSeconds: 600 } },
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/services/organization-brand", () => ({ saveOrganizationBrand }));

const { saveOrganizationBrandAction } = await import("./actions");

const valid = {
  name: "Marca Própria",
  logoUrl: "https://marca.com/logo.png",
  faviconUrl: "",
  primary: "#00D4FF",
  secondary: "#2563EB",
  supportEmail: "suporte@marca.com",
  supportWhatsapp: "5511999998888",
  hideClinkup: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspace.mockResolvedValue({
    supabase: {},
    user: { id: "u-1", email: "admin@marca.com" },
    profile: { is_super_admin: false },
    organization: { id: "org-1", plan_id: "scale", is_white_label: true },
    role: "owner",
  });
  rateLimit.mockResolvedValue(true);
});

describe("saveOrganizationBrandAction", () => {
  it("valida schema Zod e rate limit antes de salvar", async () => {
    expect(await saveOrganizationBrandAction({ ...valid, primary: "invalido" })).toHaveProperty("error");
    rateLimit.mockResolvedValueOnce(false);
    expect(await saveOrganizationBrandAction(valid)).toEqual({ error: "Muitas tentativas." });
    expect(saveOrganizationBrand).not.toHaveBeenCalled();
  });

  it("salva identidade e revalida o layout raiz", async () => {
    saveOrganizationBrand.mockResolvedValueOnce({ organization_id: "org-1" });
    expect(await saveOrganizationBrandAction(valid)).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("propaga erro amigável quando organização não é elegível", async () => {
    saveOrganizationBrand.mockRejectedValueOnce(new ServiceError("A personalização White-Label exige plano Scale."));
    expect(await saveOrganizationBrandAction(valid)).toEqual({ error: "A personalização White-Label exige plano Scale." });
  });
});
