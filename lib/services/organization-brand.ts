import "server-only";
import type { z } from "zod";
import { canManageOrganizationBrand, organizationBrandSchema } from "@/config/organization-brand";
import { tenantBrand } from "@/config/tenant-brand";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

export type OrganizationBrandRow = {
  organization_id: string;
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  support_email: string;
  support_whatsapp: string;
  hide_clinkup: boolean;
  updated_at: string;
};

export type EffectiveBrand = {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primary: string;
  secondary: string;
  supportEmail: string;
  supportWhatsapp: string | null;
  whatsappUrl: string | null;
  hideClinkup: boolean;
  customized: boolean;
};

export function buildWhatsappSupportUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}

export function resolveEffectiveBrand(
  orgBrand: OrganizationBrandRow | null | undefined,
  fallback = tenantBrand,
): EffectiveBrand {
  if (!orgBrand) {
    return {
      name: fallback.name,
      logoUrl: fallback.logoUrl,
      faviconUrl: fallback.faviconUrl,
      primary: fallback.colors.primary,
      secondary: fallback.colors.secondary,
      supportEmail: fallback.supportEmail,
      supportWhatsapp: fallback.supportWhatsapp,
      whatsappUrl: buildWhatsappSupportUrl(fallback.supportWhatsapp),
      hideClinkup: false,
      customized: false,
    };
  }
  return {
    name: orgBrand.name,
    logoUrl: orgBrand.logo_url,
    faviconUrl: orgBrand.favicon_url,
    primary: orgBrand.primary_color,
    secondary: orgBrand.secondary_color,
    supportEmail: orgBrand.support_email,
    supportWhatsapp: orgBrand.support_whatsapp,
    whatsappUrl: buildWhatsappSupportUrl(orgBrand.support_whatsapp),
    hideClinkup: orgBrand.hide_clinkup,
    customized: true,
  };
}

export async function getOrganizationBrand(
  ctx: Pick<ServiceContext, "supabase" | "organizationId">,
): Promise<OrganizationBrandRow | null> {
  const { data, error } = await ctx.supabase
    .from("organization_brands")
    .select("organization_id, name, logo_url, favicon_url, primary_color, secondary_color, support_email, support_whatsapp, hide_clinkup, updated_at")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OrganizationBrandRow | null) ?? null;
}

export async function saveOrganizationBrand(
  ctx: ServiceContext,
  input: z.input<typeof organizationBrandSchema>,
  options: { isWhiteLabel: boolean; isSuperAdmin?: boolean },
): Promise<OrganizationBrandRow> {
  if (!ctx.userId) throw new ServiceError("Entre na sua conta para configurar a marca White-Label.");
  const allowed = canManageOrganizationBrand({
    role: ctx.role,
    planId: ctx.planId,
    isWhiteLabel: options.isWhiteLabel,
    isSuperAdmin: options.isSuperAdmin,
  });
  if (!allowed) {
    throw new ServiceError(
      "A personalização White-Label exige papel de proprietário/administrador em plano Scale ou licença White-Label ativa.",
    );
  }

  const parsed = organizationBrandSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira os dados da identidade White-Label.");
  }

  const client = options.isSuperAdmin ? createAdminClient() : ctx.supabase;
  const { data, error } = await client
    .from("organization_brands")
    .upsert(
      {
        organization_id: ctx.organizationId,
        name: parsed.data.name,
        logo_url: parsed.data.logoUrl,
        favicon_url: parsed.data.faviconUrl,
        primary_color: parsed.data.primary,
        secondary_color: parsed.data.secondary,
        support_email: parsed.data.supportEmail,
        support_whatsapp: parsed.data.supportWhatsapp,
        hide_clinkup: parsed.data.hideClinkup,
        updated_by: ctx.userId,
      },
      { onConflict: "organization_id" },
    )
    .select("organization_id, name, logo_url, favicon_url, primary_color, secondary_color, support_email, support_whatsapp, hide_clinkup, updated_at")
    .single();

  if (error) {
    if (error.code === "42501") {
      throw new ServiceError("Você não tem permissão para alterar a identidade White-Label desta organização.");
    }
    throw new Error(error.message);
  }
  return data as OrganizationBrandRow;
}
