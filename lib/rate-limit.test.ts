import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "9.9.9.9" }) }));

const { clientIp, rateLimit, rateLimitByIp } = await import("./rate-limit");

beforeEach(() => rpc.mockReset());

describe("clientIp", () => {
  it("usa o primeiro IP do x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
  });

  it("cai para x-real-ip e depois unknown", () => {
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("rateLimit", () => {
  it("repassa a decisão do banco", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await rateLimit("signin:ip:1", { limit: 1, windowSeconds: 60 })).toBe(false);
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", { p_key: "signin:ip:1", p_limit: 1, p_window_seconds: 60 });
  });

  it("falha aberta quando o banco erra", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: new Error("down") });
    expect(await rateLimit("k", { limit: 1, windowSeconds: 60 })).toBe(true);
  });

  it("monta a chave por IP a partir dos headers do request", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await rateLimitByIp("signup", { limit: 5, windowSeconds: 3600 });
    expect(rpc.mock.calls[0][1].p_key).toBe("signup:ip:9.9.9.9");
  });
});
