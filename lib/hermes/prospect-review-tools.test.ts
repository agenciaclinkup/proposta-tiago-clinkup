import { describe, it, expect, vi } from "vitest";
import type { ServiceContext } from "@/lib/services/context";
const listProspectSearches = vi.fn();
const listProspects = vi.fn();
vi.mock("@/lib/services/prospecting", () => ({ listProspectSearches, listProspects }));
const { PROSPECT_REVIEW_TOOLS } = await import("./prospect-review-tools");
const ctx = { organizationId: "org", userId: "user", via: "hermes", channel: "telegram" } as ServiceContext;
describe("revisão de prospecção", () => {
  it("usa o serviço compartilhado e mantém o contexto do canal", async () => {
    listProspectSearches.mockResolvedValue([{ id: "search" }]);
    expect(await PROSPECT_REVIEW_TOOLS[0].execute(ctx, {})).toEqual([{ id: "search" }]);
    expect(listProspectSearches).toHaveBeenCalledWith(ctx);
  });
  it("recusa identificador inválido antes da consulta", () => {
    expect(PROSPECT_REVIEW_TOOLS[1].input.safeParse({ searchId: "invalido" }).success).toBe(false);
  });
});
