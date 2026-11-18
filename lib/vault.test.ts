import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./vault";

beforeEach(() => vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

describe("vault", () => {
  it("cifra e decifra com o mesmo AAD", () => {
    const token = "EAAG-meta-token-123";
    const sealed = encryptSecret(token, "integration-1");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain(token);
    expect(decryptSecret(sealed, "integration-1")).toBe(token);
  });

  it("gera textos cifrados diferentes para o mesmo valor", () => {
    expect(encryptSecret("x", "a")).not.toBe(encryptSecret("x", "a"));
  });

  it("rejeita AAD diferente (segredo copiado para outra integração)", () => {
    const sealed = encryptSecret("token", "integration-1");
    expect(() => decryptSecret(sealed, "integration-2")).toThrow();
  });

  it("rejeita texto adulterado", () => {
    const [v, iv, tag, ct] = encryptSecret("token", "a").split(":");
    const tampered = Buffer.from(ct, "base64url");
    tampered[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, tampered.toString("base64url")].join(":"), "a")).toThrow();
    expect(() => decryptSecret("lixo", "a")).toThrow("Formato de segredo inválido.");
  });

  it("rejeita chave com tamanho errado", () => {
    vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encryptSecret("x", "a")).toThrow("32 bytes");
  });
});
