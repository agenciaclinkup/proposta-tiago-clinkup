import { describe, expect, it } from "vitest";
import { activityAuthor, contactLinks } from "./lead-view";

describe("contactLinks", () => {
  it("monta atalhos seguros de WhatsApp, e-mail, telefone, site e Instagram", () => {
    const links = contactLinks({
      whatsapp: "(11) 98765-4321",
      email: "maria@clinica.com.br",
      phone: "11 3333-4444",
      website: "https://clinica.com.br",
      instagram: "@clinica.sorriso",
    });
    expect(links).toEqual([
      { kind: "whatsapp", label: "WhatsApp", href: "https://wa.me/5511987654321" },
      { kind: "email", label: "E-mail", href: "mailto:maria@clinica.com.br" },
      { kind: "phone", label: "Ligar", href: "tel:+551133334444" },
      { kind: "website", label: "Site", href: "https://clinica.com.br" },
      { kind: "instagram", label: "Instagram", href: "https://www.instagram.com/clinica.sorriso" },
    ]);
  });

  it("mantém número internacional e ignora dados inválidos ou perigosos", () => {
    expect(contactLinks({ whatsapp: "+1 415 555 0100" })[0].href).toBe("https://wa.me/14155550100");
    expect(contactLinks({ whatsapp: "123", website: "javascript:alert(1)", instagram: "nome com espaço" })).toEqual([]);
  });
});

describe("activityAuthor", () => {
  const names = new Map([["u-2", "Bruno Lima"]]);
  it("diz quem executou: você, um membro pelo nome ou o Hermes", () => {
    expect(activityAuthor({ created_via: "hermes", created_by: "u-1" }, "u-1", names)).toBe("pelo Hermes");
    expect(activityAuthor({ created_via: "manual", created_by: "u-1" }, "u-1", names)).toBe("por você");
    expect(activityAuthor({ created_via: "manual", created_by: "u-2" }, "u-1", names)).toBe("por Bruno Lima");
    expect(activityAuthor({ created_via: "manual", created_by: null }, "u-1", names)).toBe("por um membro da equipe");
  });
});
