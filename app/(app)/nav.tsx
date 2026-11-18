"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  CreditCard,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  Palette,
  PlugZap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// `ready: false` = módulo de fase futura (ver ARCHITECTURE.md).
const ITEMS: { href: string; label: string; icon: LucideIcon; ready: boolean }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, ready: true },
  { href: "/hermes", label: "Agente Hermes", icon: Bot, ready: true },
  { href: "/crm", label: "CRM", icon: KanbanSquare, ready: false },
  { href: "/calendar", label: "Calendário", icon: CalendarDays, ready: false },
  { href: "/studio", label: "Estúdio", icon: Palette, ready: false },
  { href: "/leads-ads", label: "Leads & Ads", icon: Megaphone, ready: false },
  { href: "/integrations", label: "Integrações", icon: PlugZap, ready: false },
  { href: "/billing", label: "Planos", icon: CreditCard, ready: true },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação principal" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {ITEMS.map(({ href, label, icon: Icon, ready }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const content = (
          <>
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="whitespace-nowrap">{label}</span>
            {!ready && (
              <span className="ml-auto hidden rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground lg:inline">
                Em breve
              </span>
            )}
          </>
        );
        const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";

        return ready ? (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              base,
              active
                ? "bg-primary/10 text-primary"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            {content}
          </Link>
        ) : (
          <span key={href} aria-disabled className={cn(base, "cursor-not-allowed text-muted-foreground/60")}>
            {content}
          </span>
        );
      })}
    </nav>
  );
}
