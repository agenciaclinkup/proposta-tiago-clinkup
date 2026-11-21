import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { getPlan } from "@/config/plans";
import { isSuperAdminUser } from "@/lib/super-admin";
import { requireWorkspace } from "@/lib/workspace";
import { signOut } from "../(auth)/actions";
import { Nav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { organization, profile, user } = await requireWorkspace();
  const plan = getPlan(organization.plan_id);
  const isSuperAdmin = isSuperAdminUser(user, profile);

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-sidebar-border bg-sidebar p-4 lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col lg:border-r lg:border-b-0">
        <div className="mb-4 flex items-center justify-between lg:mb-8">
          <BrandMark />
        </div>
        <Nav isSuperAdmin={isSuperAdmin} />
        <div className="mt-4 hidden border-t border-sidebar-border pt-4 lg:mt-auto lg:block">
          <p className="truncate text-sm font-medium">{organization.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {profile.full_name ?? user.email} · Plano {plan?.name ?? organization.plan_id}
          </p>
          <form action={signOut} className="mt-3">
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
