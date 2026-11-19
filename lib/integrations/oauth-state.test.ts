import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

const owner = { organizationId: "org-1", userId: "u-1", provider: "meta" as const };

beforeEach(() => vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64")));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("state OAuth anti-CSRF", () => {
  it("aceita o state do mesmo usuário, org, provedor e nonce do cookie", () => {
    const { state, nonce } = createOAuthState(owner);
    expect(verifyOAuthState(state, { ...owner, nonce })).toEqual(expect.objectContaining({ organizationId: "org-1", userId: "u-1" }));
  });

  it("recusa state adulterado", () => {
    const { state, nonce } = createOAuthState(owner);
    const [payload, signature] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), organizationId: "org-2" })).toString("base64url");
    expect(verifyOAuthState(`${forged}.${signature}`, { ...owner, organizationId: "org-2", nonce })).toBeNull();
    expect(verifyOAuthState("lixo", { ...owner, nonce })).toBeNull();
  });

  it("recusa nonce diferente do cookie, outro usuário, outra org ou outro provedor", () => {
    const { state, nonce } = createOAuthState(owner);
    expect(verifyOAuthState(state, { ...owner, nonce: "outro" })).toBeNull();
    expect(verifyOAuthState(state, { ...owner, nonce: undefined })).toBeNull();
    expect(verifyOAuthState(state, { ...owner, userId: "u-2", nonce })).toBeNull();
    expect(verifyOAuthState(state, { ...owner, organizationId: "org-2", nonce })).toBeNull();
    expect(verifyOAuthState(state, { ...owner, provider: "google", nonce })).toBeNull();
  });

  it("expira em 10 minutos", () => {
    vi.useFakeTimers();
    const { state, nonce } = createOAuthState(owner);
    vi.advanceTimersByTime(9 * 60_000);
    expect(verifyOAuthState(state, { ...owner, nonce })).not.toBeNull();
    vi.advanceTimersByTime(2 * 60_000);
    expect(verifyOAuthState(state, { ...owner, nonce })).toBeNull();
  });

  it("não aceita state assinado com outra chave", () => {
    const { state, nonce } = createOAuthState(owner);
    vi.stubEnv("VAULT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(verifyOAuthState(state, { ...owner, nonce })).toBeNull();
  });
});
