"use client";

import { useState } from "react";

export function ContactForm({ endpoint }: { endpoint: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("sending");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: form.get("email"), whatsapp: form.get("whatsapp"), message: form.get("message"), consent: form.get("consent") === "on", website: form.get("website") }) });
      setStatus(response.ok ? "success" : "error");
    } catch { setStatus("error"); }
  }
  if (status === "success") return <p role="status" className="rounded-xl bg-cyan-500/10 p-5 text-cyan-100">Obrigado! Seus dados foram enviados.</p>;
  const field = "mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white";
  return <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-6">
    <label className="block">Nome <input className={field} name="name" required maxLength={200} autoComplete="name" /></label>
    <label className="block">E-mail <input className={field} name="email" type="email" maxLength={320} autoComplete="email" /></label>
    <label className="block">WhatsApp <input className={field} name="whatsapp" type="tel" maxLength={40} autoComplete="tel" /></label>
    <p className="text-sm text-slate-300">Informe ao menos um e-mail ou WhatsApp.</p>
    <label className="block">Mensagem <textarea className={field} name="message" required maxLength={5000} rows={4} /></label>
    <div className="absolute -left-[9999px]" aria-hidden="true"><label>Site <input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" required className="mt-1" /> Autorizo o uso dos meus dados para receber contato sobre esta solicitação.</label>
    {status === "error" && <p role="alert" className="text-sm text-red-300">Não foi possível enviar seus dados. Confira os campos e tente novamente.</p>}
    <button disabled={status === "sending"} className="rounded-lg bg-cyan-400 px-6 py-3 font-semibold text-slate-950 disabled:opacity-50">{status === "sending" ? "Enviando…" : "Enviar meus dados"}</button>
  </form>;
}
