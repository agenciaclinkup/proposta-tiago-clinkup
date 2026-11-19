import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getPublicLanding } from "@/lib/landing/public-service";
import { ContactForm } from "./contact-form";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ orgSlug: string; slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, slug } = await params;
  const page = await getPublicLanding(orgSlug, slug);
  if (!page) return {};
  const description = page.sections.find((section) => section.body)?.body.slice(0, 160);
  return { title: { absolute: page.title }, description, openGraph: { title: page.title, description } };
}
export default async function PublicLanding({ params }: Props) {
  const { orgSlug, slug } = await params;
  const page = await getPublicLanding(orgSlug, slug);
  if (!page) notFound();
  const endpoint = `/p/${encodeURIComponent(orgSlug)}/${encodeURIComponent(slug)}/submit`;
  return <main className="min-h-screen bg-[#050811] text-slate-100">
    <header className="border-b border-white/10" style={{ borderTop: `4px solid ${page.accent}` }}><div className="mx-auto max-w-5xl px-6 py-5 text-sm font-semibold tracking-wide text-slate-100">{page.company}</div></header>
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-12 sm:py-20">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">{page.title}</h1>
      {page.sections.map((section, index) => <section key={index} id={section.type === "form" && !page.sections.slice(0, index).some((item) => item.type === "form") ? "contato" : undefined} className="space-y-5 border-t border-white/10 pt-10">
        {section.heading && <h2 className="text-2xl font-semibold sm:text-3xl">{section.heading}</h2>}
        {section.body && <p className="max-w-3xl whitespace-pre-wrap leading-7 text-slate-300">{section.body}</p>}
        {section.imageUrl && <Image unoptimized src={section.imageUrl} alt={section.heading || "Imagem da página"} width={1200} height={900} className="max-h-[36rem] w-full rounded-xl object-contain" />}
        {section.type === "form" && (page.acceptsLeads ? <ContactForm endpoint={endpoint} /> : <p className="text-slate-400">O formulário de contato está temporariamente indisponível.</p>)}
        {section.type === "cta" && page.sections.some((item) => item.type === "form") && page.acceptsLeads && <a href="#contato" className="inline-block rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-slate-950">Entre em contato</a>}
      </section>)}
    </div>
  </main>;
}
