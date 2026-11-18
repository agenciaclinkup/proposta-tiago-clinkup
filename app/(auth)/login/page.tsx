import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;

  return (
    <>
      <h1 className="text-2xl font-semibold">Bem-vindo de volta</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Entre para acessar seu painel e o Agente Hermes.</p>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          Não foi possível validar seu link de acesso. Tente entrar novamente.
        </p>
      )}
      <AuthForm mode="login" next={next} />
    </>
  );
}
