import { describe, expect, it } from "vitest";
import { isSuperAdminUser, parseSuperAdminEmails } from "./super-admin";

describe("autorização Super-Admin", () => {
  it("normaliza SUPER_ADMIN_EMAILS ignorando espaços, maiúsculas e entradas inválidas", () => {
    const emails = parseSuperAdminEmails(" Admin@Clinkup.com , equipe@clinkup.com, invalido ");
    expect(emails.has("admin@clinkup.com")).toBe(true);
    expect(emails.has("equipe@clinkup.com")).toBe(true);
    expect(emails.has("invalido")).toBe(false);
    expect(parseSuperAdminEmails(undefined).size).toBe(0);
  });

  it("autoriza via profiles.is_super_admin ou SUPER_ADMIN_EMAILS e bloqueia usuários comuns", () => {
    expect(isSuperAdminUser({ email: "user@empresa.com" }, { is_super_admin: true }, "")).toBe(true);
    expect(isSuperAdminUser({ email: "ADMIN@clinkup.com" }, { is_super_admin: false }, "admin@clinkup.com")).toBe(true);
    expect(isSuperAdminUser({ email: "cliente@empresa.com" }, { is_super_admin: false }, "admin@clinkup.com")).toBe(false);
    expect(isSuperAdminUser({ email: null }, null, "admin@clinkup.com")).toBe(false);
  });
});
