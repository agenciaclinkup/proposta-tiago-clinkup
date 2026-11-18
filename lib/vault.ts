import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Cofre de credenciais: AES-256-GCM. Formato `v1:<iv>:<tag>:<ciphertext>` (base64url).
// `aad` = id do dono do segredo (ex.: integração): o texto cifrado não pode ser copiado para outra linha.
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (!raw) throw new Error("VAULT_ENCRYPTION_KEY não configurada.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("VAULT_ENCRYPTION_KEY deve ter 32 bytes em base64.");
  return key;
}

export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(payload: string, aad: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Formato de segredo inválido.");
  const [, iv, tag, ciphertext] = parts;

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
