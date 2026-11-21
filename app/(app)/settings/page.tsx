import type { Metadata } from "next";
import { canManageOrganizationBrand } from "@/config/organization-brand";
import { getPlan } from "@/config/plans";
import { serviceContext } from "@/lib/services/context";
import { getOrganizationBrand, resolveEffectiveBrand } from "@/lib/services/organization-brand";
import { isSuperAdminUser } from "@/lib/super-admin";
import { requireWorkspace } from "@/lib/workspace";
import { WhiteLabelBrandForm } from "./brand-form";

export const metadata: Metadata = { title: "Identidade White-Label" };

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  const isSuperAdmin = isSuperAdminUser(workspace.user, workspace.profile);
  const canEdit = canManageOrganizationBrand({
    role: workspace.role,
    planId: workspace.organization.plan_id,
    isWhiteLabel: workspace.organization.is_white_label,
    isSuperAdmin,
  });

  const orgBrand = await getOrganizationBrand(ctx);
  const effective = resolveEffectiveBrand(orgBrand);
  const plan = getPlan(workspace.organization.plan_id);

  return (
    <WhiteLabelBrandForm
      canEdit={canEdit}
      isAdmin={["owner", "admin"].includes(workspace.role) || isSuperAdmin}
      planName={plan?.name ?? workspace.organization.plan_id}
      isWhiteLabel={workspace.organization.is_white_label}
      initial={{
        name: effective.name,
        logoUrl: effective.logoUrl ?? "",
        faviconUrl: effective.faviconUrl ?? "",
        primary: effective.primary,
        secondary: effective.secondary,
        supportEmail: effective.supportEmail,
        supportWhatsapp: effective.supportWhatsapp ?? "",
        hideClinkup: effective.hideClinkup,
      }}
    />
  );
}
