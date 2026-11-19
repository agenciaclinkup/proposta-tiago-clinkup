import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OAuthProvider = "meta" | "google";
// `context`: dado extra assinado junto (ex.: qual produto Google conectar), impossível de trocar no caminho.
type StatePayload = { organizationId: string; userId: string; provider: OAuthProvider; context?: string; nonce: string; exp: number };

const TTL_MS = 10 * 60_000;
export const OAUTH_NONCE_COOKIE = "oauth_nonce";

// Chave própria para o state, derivada da chave do cofre (separação de uso, sem env nova).
function stateKey(): Buffer {
  const vault = process.env.VAULT_ENCRYPTION_KEY;
  if (!vault) throw new Error("VAULT_ENCRYPTION_KEY não configurada.");
  return createHmac("sha256", Buffer.from(vault, "base64")).update("oauth-state-v1").digest();
}

const sign = (encoded: string) => createHmac("sha256", stateKey()).update(encoded).digest("base64url");

// state = payload.assinatura (base64url). O nonce também vai num cookie httpOnly: o callback exige os dois iguais.
export function createOAuthState(owner: { organizationId: string; userId: string; provider: OAuthProvider; context?: string }) {
  const nonce = randomBytes(16).toString("base64url");
  const payload: StatePayload = { ...owner, nonce, exp: Date.now() + TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${encoded}.${sign(encoded)}`, nonce };
}

export function verifyOAuthState(
  state: string | null,
  expected: { organizationId: string; userId: string; provider: OAuthProvider; nonce: string | undefined },
): StatePayload | null {
  const [encoded, signature] = (state ?? "").split(".");
  if (!encoded || !signature || !expected.nonce) return null;

  const a = Buffer.from(signature);
  const b = Buffer.from(sign(encoded));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  const valid =
    payload.exp > Date.now() &&
    payload.nonce === expected.nonce &&
    payload.userId === expected.userId &&
    payload.organizationId === expected.organizationId &&
    payload.provider === expected.provider;
  return valid ? payload : null;
}
