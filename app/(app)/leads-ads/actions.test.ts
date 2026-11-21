import { beforeEach, expect, it, vi } from "vitest";
const workspace = vi.fn(); const rateLimit = vi.fn(); const send = vi.fn();
vi.mock("@/lib/workspace", () => ({ requireWorkspace: workspace }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, RATE_LIMIT_MESSAGE: "Aguarde.", RATE_LIMITS: { crmUser: {} } }));
vi.mock("@/lib/services/prospecting", async (original) => ({ ...(await original<typeof import("@/lib/services/prospecting")>()), sendProspectToCrm: send }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { sendProspectsAction } = await import("./actions");
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.clearAllMocks(); workspace.mockResolvedValue({ supabase: {}, user: { id }, organization: { id, plan_id: "starter" }, role: "member" }); rateLimit.mockResolvedValue(true); });
it("valida dados e aplica rate limit antes de transferir", async () => {
  expect(await sendProspectsAction({ prospectIds: ["inválido"], stageId: id })).toHaveProperty("error");
  rateLimit.mockResolvedValue(false);
  expect(await sendProspectsAction({ prospectIds: [id], stageId: id })).toEqual({ error: "Aguarde." });
  expect(send).not.toHaveBeenCalled();
});
it("encaminha seleção única usando o contexto da empresa", async () => {
  send.mockResolvedValue({ id });
  expect(await sendProspectsAction({ prospectIds: [id, id], stageId: id })).toMatchObject({ sent: 1 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ organizationId: id, userId: id, via: "manual" }), { prospectId: id, stageId: id });
});
