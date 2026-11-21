import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetaAdsHttpClient, createSimulatedMetaAdsClient } from "./meta-ads-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("MetaAdsClient HTTP", () => {
  it("converte métricas de insights (spend em centavos, leads e ROAS) com validação Zod", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              campaign_id: "camp_1",
              date_start: "2026-11-01",
              date_stop: "2026-11-20",
              spend: "123.45",
              impressions: "5000",
              clicks: "210",
              actions: [
                { action_type: "lead", value: "12" },
                { action_type: "link_click", value: "200" },
              ],
              purchase_roas: [{ value: "3.5" }],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const client = createMetaAdsHttpClient();
    const rows = await client.getCampaignInsights("act_123", "token", { since: "2026-11-01", until: "2026-11-20" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      campaign_id: "camp_1",
      spend_cents: 12345,
      impressions: 5000,
      clicks: 210,
      leads: 12,
      roas: 3.5,
    });
  });

  it("traduz erros de token expirado (401/190), permissão (200) e rate limit (429) em pt-BR", async () => {
    const client = createMetaAdsHttpClient();

    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 190, message: "expired" } }), { status: 401 }));
    await expect(client.listCampaigns("act_1", "tok")).rejects.toThrow("expirou");

    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 200, message: "perm" } }), { status: 403 }));
    await expect(client.listCampaigns("act_1", "tok")).rejects.toThrow("permissão suficiente");

    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 17, message: "limit" } }), { status: 429 }));
    await expect(client.listCampaigns("act_1", "tok")).rejects.toThrow("limite de requisições");
  });

  it("trata falha de rede/timeout com mensagem clara em pt-BR", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("timeout"));
    const client = createMetaAdsHttpClient();
    await expect(client.createCampaign("act_1", "tok", { name: "Teste", objective: "OUTCOME_LEADS", dailyBudgetCents: 2000, status: "PAUSED" })).rejects.toThrow(
      "não respondeu a tempo",
    );
  });
});

describe("createSimulatedMetaAdsClient", () => {
  it("simula criação e atualização sem chamadas externas de rede", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sim = createSimulatedMetaAdsClient();
    const created = await sim.createCampaign("act_1", "tok", {
      name: "Leads Clínica",
      objective: "OUTCOME_LEADS",
      dailyBudgetCents: 5000,
      status: "PAUSED",
    });
    expect(created.id).toBe("sim_camp_1");
    await sim.updateCampaign(created.id, "tok", { status: "ACTIVE", dailyBudgetCents: 7500 });
    const list = await sim.listCampaigns("act_1", "tok");
    expect(list[0]).toMatchObject({ id: "sim_camp_1", status: "ACTIVE", daily_budget: 7500 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
