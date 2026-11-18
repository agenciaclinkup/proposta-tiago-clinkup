import Link from "next/link";
import { Bot, CalendarDays, KanbanSquare, Megaphone, Palette, Search } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PricingTable } from "@/components/pricing-table";
import { Button } from "@/components/ui/button";
import { tenantBrand } from "@/config/tenant-brand";

const FEATURES = [
  { icon: Bot, title: "Agente Hermes", text: "Peça em linguagem natural, no painel ou pelo Telegram, e o Hermes executa por você." },
  { icon: KanbanSquare, title: "CRM com funil", text: "Kanban personalizável, ficha completa do lead e reuniões direto na sua agenda." },
  { icon: CalendarDays, title: "Calendário editorial", text: "Agende posts no Instagram, Facebook e Google Meu Negócio no horário exato." },
  { icon: Palette, title: "Estúdio de criação", text: "Carrosséis e landing pages com a identidade da sua marca, prontos em minutos." },
  { icon: Search, title: "Extrator de leads", text: "Encontre empresas por nicho e região e envie os contatos para o CRM com um clique." },
  { icon: Megaphone, title: "Meta Ads assistido", text: "Crie campanhas por conversa ou formulário, com orientação passo a passo." },
];

export default function Home() {
  return (
    <div className="bg-grid min-h-svh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <BrandMark />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Começar grátis</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="py-20 text-center sm:py-28">
          <p className="mx-auto w-fit rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-sm text-primary">
            Marketing, vendas e automação com IA
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold sm:text-6xl">
            <span className="text-gradient">{tenantBrand.tagline}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">{tenantBrand.description}</p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">Testar grátis por 14 dias</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#planos">Ver planos</Link>
            </Button>
          </div>
        </section>

        <section aria-labelledby="recursos" className="pb-24">
          <h2 id="recursos" className="sr-only">
            Recursos
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="glass rounded-2xl p-6">
                <Icon className="size-6 text-primary" aria-hidden />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="planos" aria-labelledby="planos-titulo" className="scroll-mt-8 pb-24">
          <h2 id="planos-titulo" className="text-center text-3xl font-semibold">
            Planos para cada fase do seu crescimento
          </h2>
          <p className="mt-2 mb-10 text-center text-muted-foreground">Comece grátis. Mude de plano quando quiser.</p>
          <PricingTable
            renderAction={() => (
              <Button asChild className="w-full">
                <Link href="/signup">Começar teste grátis</Link>
              </Button>
            )}
          />
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} {tenantBrand.name} · {tenantBrand.supportEmail}
      </footer>
    </div>
  );
}
