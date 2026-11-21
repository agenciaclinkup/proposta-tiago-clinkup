import type { CSSProperties } from "react";
import { LogOut, MessageCircle } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { getPlan } from "@/config/plans";
import { serviceContext } from "@/lib/services/context";
import { getOrganizationBrand, resolveEffectiveBrand } from "@/lib/services/organization-brand";
import { isSuperAdminUser } from "@/lib/super-admin";
import { requireWorkspace } from "@/lib/workspace";
import { signOut } from "../(auth)/actions";
import { Nav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();
  const { organization, profile, user } = workspace;
  const plan = getPlan(organization.plan_id);
  const isSuperAdmin = isSuperAdminUser(user, profile);
  const orgBrand = await getOrganizationBrand(serviceContext(workspace, "manual"));
  const brand = resolveEffectiveBrand(orgBrand);

  const brandVars = brand.customized
    ? ({
        "--primary": brand.primary,
        "--ring": brand.primary,
        "--brand-secondary": brand.secondary,
      } as CSSProperties)
    : undefined;

  return (
    <div style={brandVars} className="min-h-svh lg:grid lg:grid-cols-[260px_1fr]">
      {brand.faviconUrl && <link rel="icon" href={brand.faviconUrl} />}
      <aside className="border-b border-sidebar-border bg-sidebar p-4 lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col lg:border-r lg:border-b-0">
        <div className="mb-4 flex items-center justify-between lg:mb-8">
          <BrandMark brand={{ name: brand.name, logoUrl: brand.logoUrl }} />
        </div>
        <Nav isSuperAdmin={isSuperAdmin} />
        <div className="mt-4 hidden space-y-2 border-t border-sidebar-border pt-4 lg:mt-auto lg:block">
          <div>
            <p className="truncate text-sm font-medium">{organization.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {profile.full_name ?? user.email} · Plano {plan?.name ?? organization.plan_id}
            </p>
          </div>
          {brand.whatsappUrl && (
            <a
              href={brand.whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-sidebar-accent"
            >
              <MessageCircle className="size-3.5 shrink-0" aria-hidden /> Suporte no WhatsApp
            </a>
          )}
          {!brand.hideClinkup && brand.customized && (
            <p className="px-2 text-[11px] text-muted-foreground/70">Tecnologia Clinkup Hermes</p>
          )}
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="w-full justify-start px-2 text-muted-foreground">
              <LogOut className="size-4" /> Sair
            </Button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
