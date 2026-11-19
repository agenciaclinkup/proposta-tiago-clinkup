import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const rpc = vi.fn();
const capture = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/landing/public-service", () => ({ capturePublicLead: capture }));
const { POST } = await import("./route");
beforeEach(() => { vi.clearAllMocks(); });
it("bloqueia captura quando o limitador recusa ou falha", async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  const response = await POST(new NextRequest("https://example.com/p/org/page/submit", { method: "POST", body: "{}", headers: { "x-forwarded-for": "1.2.3.4" } }), { params: Promise.resolve({ orgSlug: "org", slug: "page" }) });
  expect(response.status).toBe(429);
  expect(capture).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("rate_limit_hit", expect.objectContaining({ p_key: expect.stringMatching(/^landing:[a-f0-9]{64}$/) }));
});
