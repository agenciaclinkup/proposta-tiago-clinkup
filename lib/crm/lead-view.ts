// Apresentação da ficha do lead (pura, testável): atalhos de contato seguros e autoria das atividades.

export type ContactLink = { kind: "whatsapp" | "email" | "phone" | "website" | "instagram"; label: string; href: string };

// Número brasileiro sem DDI (10–11 dígitos) recebe 55; com "+" mantém o DDI informado.
function phoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const withCountry = raw.trim().startsWith("+") ? digits : digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return withCountry.length >= 11 && withCountry.length <= 15 ? withCountry : null;
}

export function contactLinks(lead: {
  whatsapp?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  instagram?: string | null;
}): ContactLink[] {
  const links: ContactLink[] = [];

  const whatsapp = lead.whatsapp ? phoneDigits(lead.whatsapp) : null;
  if (whatsapp) links.push({ kind: "whatsapp", label: "WhatsApp", href: `https://wa.me/${whatsapp}` });

  if (lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    links.push({ kind: "email", label: "E-mail", href: `mailto:${lead.email}` });
  }

  const phone = lead.phone ? phoneDigits(lead.phone) : null;
  if (phone) links.push({ kind: "phone", label: "Ligar", href: `tel:+${phone}` });

  // Só http(s): bloqueia javascript:, data: e afins vindos de dados digitados ou importados.
  if (lead.website) {
    try {
      const url = new URL(lead.website);
      if (url.protocol === "https:" || url.protocol === "http:") links.push({ kind: "website", label: "Site", href: url.toString().replace(/\/$/, "") });
    } catch {
      // link inválido: sem atalho
    }
  }

  const handle = lead.instagram?.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
  if (handle && /^[A-Za-z0-9._]{1,30}$/.test(handle)) {
    links.push({ kind: "instagram", label: "Instagram", href: `https://www.instagram.com/${handle}` });
  }

  return links;
}

export function activityAuthor(
  activity: { created_via: string; created_by: string | null },
  currentUserId: string,
  names: Map<string, string>,
): string {
  if (activity.created_via === "hermes") return "pelo Hermes";
  if (activity.created_by === currentUserId) return "por você";
  const name = activity.created_by ? names.get(activity.created_by) : undefined;
  return name ? `por ${name}` : "por um membro da equipe";
}
