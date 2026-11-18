import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Crie sua conta</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        14 dias grátis no plano Starter. Sem cartão de crédito para começar.
      </p>
      <AuthForm mode="signup" />
    </>
  );
}
