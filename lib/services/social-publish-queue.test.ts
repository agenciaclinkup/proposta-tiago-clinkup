import { describe, expect, it, vi } from "vitest";
import { processClaim, SafeTransientError, UnconfirmedPublication } from "./social-publish-queue";

describe("fila de publicação", () => {
  it("persiste cada resultado parcial sem repetir destino confirmado", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValueOnce("external-1").mockRejectedValueOnce(new Error("timeout"));
    await processClaim({ id: "post", organizationId: "org", leaseToken: "lease" }, ["a", "b"], { start, finish, publish });
    expect(start).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenNthCalledWith(1, "a", "published", "external-1", null);
    expect(finish).toHaveBeenNthCalledWith(2, "b", "uncertain", null, expect.stringContaining("Confira"));
  });
  it("não chama provedor quando não consegue garantir posse", async () => {
    const start = vi.fn().mockRejectedValue(new Error("lease expirada"));
    const publish = vi.fn();
    const finish = vi.fn();
    await expect(processClaim({ id: "post", organizationId: "org", leaseToken: "lease" }, ["a"], { start, finish, publish })).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
  it("preserva identificador quando o provedor ainda processa o post", async () => {
    const finish = vi.fn();
    await processClaim({ id: "post", organizationId: "org", leaseToken: "lease" }, ["a"], { start: vi.fn(), publish: vi.fn().mockRejectedValue(new UnconfirmedPublication("remote-id")), finish });
    expect(finish).toHaveBeenCalledWith("a", "uncertain", "remote-id", expect.stringContaining("Confira"));
  });
  it("autoriza retry apenas de falha confirmada antes da publicação", async () => {
    const finish = vi.fn();
    await processClaim({ id: "post", organizationId: "org", leaseToken: "lease" }, ["a"], { start: vi.fn(), publish: vi.fn().mockRejectedValue(new SafeTransientError()), finish });
    expect(finish).toHaveBeenCalledWith("a", "retry", null, expect.stringContaining("temporária"));
  });
});
