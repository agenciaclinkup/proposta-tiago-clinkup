import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { tenantBrand } from "@/config/tenant-brand";

export const metadata: Metadata = { title: "Exclusão de dados do Facebook" };

// Página de status exigida pela Meta para pedidos de exclusão de dados. A exclusão é feita na hora do pedido.
export default async function MetaDataDeletionPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const { codigo } = await searchParams;
  const code = codigo && /^[A-Z0-9]{12}$/.test(codigo) ? codigo : null;

  return (
    <main className="bg-grid flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8">
        <BrandMark />
      </Link>
      <div className="glass w-full max-w-lg space-y-4 rounded-2xl p-8">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <CheckCircle2 className="size-6 text-primary" aria-hidden /> Exclusão de dados concluída
        </h1>
        {code && (
          <p className="text-sm">
            Código de confirmação: <span className="font-mono font-semibold text-primary">{code}</span>
          </p>
        )}
        <p className="text-muted-foreground">
          Recebemos o pedido feito pelo Facebook para excluir os dados da sua conta. Assim que o pedido chega, removemos
          imediatamente as conexões com Instagram, Páginas do Facebook e contas de anúncios ligadas ao seu usuário,
          incluindo os tokens de acesso guardados com criptografia.
        </p>
        <p className="text-muted-foreground">
          Conteúdos que a sua empresa criou dentro da {tenantBrand.name} (como posts e campanhas) continuam pertencendo à
          empresa e podem ser excluídos por um administrador no painel. Em caso de dúvidas, fale com a gente em{" "}
          <a href={`mailto:${tenantBrand.supportEmail}`} className="text-primary hover:underline">
            {tenantBrand.supportEmail}
          </a>
          {code ? " informando o código acima" : ""}.
        </p>
      </div>
    </main>
  );
}
