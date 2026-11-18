"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimit, rateLimitByIp } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string } | undefined;

const credentials = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [ipOk, emailOk] = await Promise.all([
    rateLimitByIp("signin", RATE_LIMITS.signInIp),
    rateLimit(`signin:email:${parsed.data.email.toLowerCase()}`, RATE_LIMITS.signInEmail),
  ]);
  if (!ipOk || !emailOk) return { error: RATE_LIMIT_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Confirme seu e-mail pelo link que enviamos antes de entrar."
          : "E-mail ou senha incorretos.",
    };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials
    .extend({ fullName: z.string().trim().min(2, "Informe seu nome.").max(120) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const requestHeaders = await headers();
  if (!(await rateLimitByIp("signup", RATE_LIMITS.signUpIp, requestHeaders))) return { error: RATE_LIMIT_MESSAGE };

  const origin = requestHeaders.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });
  if (error) return { error: "Não foi possível criar sua conta. Verifique os dados e tente novamente." };

  // Com confirmação de e-mail desativada, a sessão já vem pronta.
  if (data.session) redirect("/onboarding");
  return { message: "Conta criada! Enviamos um link de confirmação para o seu e-mail." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
