import { afterEach, describe, expect, it, vi } from "vitest";
const run = vi.fn();
vi.mock("@/lib/services/social-publish-worker", () => ({ runSocialPublishBatch: run, reconcileSocialPublications: vi.fn().mockResolvedValue({ checked: 0 }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue(true), RATE_LIMITS: { socialCron: {} } }));
const { GET } = await import("./route");
const secret = "s".repeat(40);
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("cron de publicações", () => {
  it("recusa segredo ausente e incorreto", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(new Request("http://localhost/api/cron/publish"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/cron/publish", { headers: { authorization: "Bearer errado" } }))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("executa somente com segredo válido", async () => {
    vi.stubEnv("CRON_SECRET", secret); run.mockResolvedValue({ claimed: 0, processed: 0 });
    expect((await GET(new Request("http://localhost/api/cron/publish", { headers: { authorization: `Bearer ${secret}` } }))).status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });
});
