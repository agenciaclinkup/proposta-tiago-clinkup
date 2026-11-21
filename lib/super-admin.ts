import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { ServiceError } from "@/lib/services/errors";
import { createClient } from "@/lib/supabase/server";

export type SuperAdminActor = {
  id: string;
  email: string;
  fullName: string | null;
};

export function parseSuperAdminEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.includes("@")),
  );
}

export function isSuperAdminUser(
  user: { email?: string | null },
  profile: { is_super_admin?: boolean | null } | null,
  envEmails: string | undefined = process.env.SUPER_ADMIN_EMAILS,
): boolean {
  if (profile?.is_super_admin === true) return true;
  const email = user.email?.trim().toLowerCase();
  if (!email) return false;
  return parseSuperAdminEmails(envEmails).has(email);
}

async function fetchSuperAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || !auth.user.email) return { status: "unauthenticated" as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, is_super_admin")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!isSuperAdminUser(auth.user, profile)) {
    return { status: "forbidden" as const };
  }

  return {
    status: "ok" as const,
    actor: {
      id: auth.user.id,
      email: auth.user.email,
      fullName: profile?.full_name ?? null,
    } satisfies SuperAdminActor,
  };
}

export const loadSuperAdmin = cache(fetchSuperAdmin);

// Para páginas RSC (/admin): sem sessão → /login; usuário comum → /dashboard (sem expor dados).
export const requireSuperAdmin = cache(async (): Promise<SuperAdminActor> => {
  const result = await loadSuperAdmin();
  if (result.status === "unauthenticated") redirect("/login");
  if (result.status === "forbidden") redirect("/dashboard");
  return result.actor;
});

// Para Server Actions e Route Handlers: bloqueia com erro explícito (semântica 403).
export async function assertSuperAdminActor(): Promise<SuperAdminActor> {
  const result = await fetchSuperAdmin();
  if (result.status !== "ok") {
    throw new ServiceError("Acesso restrito à equipe Super-Admin da plataforma.");
  }
  return result.actor;
}
