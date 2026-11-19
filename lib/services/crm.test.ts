import { describe, expect, it } from "vitest";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { computePosition, createLead, leadInputSchema, moveLead, POSITION_STEP } from "./crm";

// Supabase falso: registra cada operação (tabela, tipo, filtros, payload) e responde via `respond`.
type Op = { table: string; kind: "select" | "insert" | "update"; filters: string[]; payload?: unknown; head?: boolean };
function fakeSupabase(respond: (op: Op) => { data?: unknown; count?: number }) {
  const ops: Op[] = [];
  const builder = (op: Op) => {
    const run = () => ({ data: null, error: null, count: null, ...respond(op) });
    const b = {
      select: (_cols?: string, opts?: { head?: boolean }) => ((op.head = opts?.head), b),
      eq: (c: string, v: unknown) => (op.filters.push(`${c}=${v}`), b),
      neq: (c: string, v: unknown) => (op.filters.push(`${c}!=${v}`), b),
      order: () => b,
      limit: () => b,
      single: async () => run(),
      maybeSingle: async () => run(),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  };
  const supabase = {
    from: (table: string) => ({
      select: (cols?: string, opts?: { head?: boolean }) => {
        const op: Op = { table, kind: "select", filters: [] };
        ops.push(op);
        return builder(op).select(cols, opts);
      },
      insert: (payload: unknown) => {
        const op: Op = { table, kind: "insert", filters: [], payload };
        ops.push(op);
        return builder(op);
      },
      update: (payload: unknown) => {
        const op: Op = { table, kind: "update", filters: [], payload };
        ops.push(op);
        return builder(op);
      },
    }),
  };
  return { supabase, ops };
}

const ctxWith = (supabase: unknown, extra: Partial<ServiceContext> = {}) =>
  ({ supabase, organizationId: "org-1", userId: "u-1", planId: "starter", role: "member", via: "manual", channel: "web", ...extra }) as ServiceContext;

describe("computePosition", () => {
  it("coloca no fim, no início e entre dois cards", () => {
    expect(computePosition([], 0)).toEqual({ position: POSITION_STEP, renumber: null });
    expect(computePosition([1024, 2048], 2)).toEqual({ position: 2048 + POSITION_STEP, renumber: null });
    expect(computePosition([1024, 2048], 0).position).toBeLessThan(1024);
    expect(computePosition([1024, 2048], 1).position).toBe(1536);
  });

  it("renumera a coluna quando não há mais espaço entre dois cards", () => {
    const a = 1;
    const b = a + Number.EPSILON;
    const result = computePosition([a, b], 1);
    expect(result.renumber).toEqual([POSITION_STEP, POSITION_STEP * 3]);
    expect(result.position).toBe(POSITION_STEP * 2);
  });
});

describe("leadInputSchema", () => {
  it("aceita campos vazios do formulário como ausentes e valida e-mail e site", () => {
    const parsed = leadInputSchema.parse({ name: " Maria ", email: "", website: "", value: "1500" });
    expect(parsed).toMatchObject({ name: "Maria", value: 1500 });
    expect(parsed.email).toBeUndefined();
    expect(leadInputSchema.safeParse({ name: "Maria", email: "maria" }).success).toBe(false);
    expect(leadInputSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("createLead", () => {
  const board = (op: Op) => {
    if (op.table === "crm_leads" && op.head) return { count: 3 };
    if (op.table === "crm_pipelines") return { data: { id: "pipe-1" } };
    if (op.table === "crm_stages") return { data: { id: "stage-1", pipeline_id: "pipe-1" } };
    if (op.table === "crm_leads" && op.kind === "select") return { data: { position: 4096 } };
    if (op.table === "crm_leads" && op.kind === "insert") return { data: { id: "lead-1", ...(op.payload as object) } };
    return {};
  };

  it("cria na primeira etapa do funil padrão, no fim da coluna, com o usuário como responsável", async () => {
    const { supabase, ops } = fakeSupabase(board);
    await createLead(ctxWith(supabase), leadInputSchema.parse({ name: "Maria" }));
    const insert = ops.find((op) => op.kind === "insert")!;
    expect(insert.payload).toMatchObject({
      organization_id: "org-1",
      pipeline_id: "pipe-1",
      stage_id: "stage-1",
      position: 4096 + POSITION_STEP,
      name: "Maria",
      source: "manual",
      owner_id: "u-1",
      created_by: "u-1",
    });
    expect(ops.filter((op) => op.kind === "select").every((op) => op.filters.includes("organization_id=org-1"))).toBe(true);
  });

  it("marca a origem como Hermes quando criado pelo agente", async () => {
    const { supabase, ops } = fakeSupabase(board);
    await createLead(ctxWith(supabase, { via: "hermes" }), leadInputSchema.parse({ name: "Maria" }));
    expect(ops.find((op) => op.kind === "insert")?.payload).toMatchObject({ source: "hermes" });
  });

  it("respeita o limite de leads do plano", async () => {
    const { supabase, ops } = fakeSupabase((op) => (op.head ? { count: 1000 } : board(op)));
    await expect(createLead(ctxWith(supabase), leadInputSchema.parse({ name: "Maria" }))).rejects.toThrow(/limite de 1\.000 leads/);
    expect(ops.some((op) => op.kind === "insert")).toBe(false);
  });

  it("recusa etapa que não é do funil da empresa", async () => {
    const { supabase } = fakeSupabase((op) => (op.table === "crm_stages" ? { data: null } : board(op)));
    await expect(
      createLead(ctxWith(supabase), leadInputSchema.parse({ name: "Maria", stageId: "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f" })),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("moveLead", () => {
  const lead = { id: "lead-1", stage_id: "stage-1", pipeline_id: "pipe-1" };
  const respond = (neighbors: { id: string; position: number }[]) => (op: Op) => {
    if (op.table === "crm_leads" && op.kind === "select" && op.filters.includes("id=lead-1")) return { data: lead };
    if (op.table === "crm_stages" && op.filters.includes("id=stage-2")) return { data: { id: "stage-2", name: "Proposta Enviada" } };
    if (op.table === "crm_stages" && op.filters.includes("id=stage-1")) return { data: { id: "stage-1", name: "Novo Lead" } };
    if (op.table === "crm_leads" && op.kind === "select") return { data: neighbors };
    if (op.kind === "update") return { data: [{ id: "x" }] };
    return {};
  };

  it("muda de etapa, posiciona entre os vizinhos e registra o histórico com a origem", async () => {
    const { supabase, ops } = fakeSupabase(respond([{ id: "a", position: 1024 }, { id: "b", position: 2048 }]));
    await moveLead(ctxWith(supabase, { via: "hermes" }), { leadId: "lead-1", stageId: "stage-2", index: 1 });
    expect(ops.find((op) => op.kind === "update" && op.filters.includes("id=lead-1"))?.payload).toEqual({
      stage_id: "stage-2",
      position: 1536,
    });
    expect(ops.find((op) => op.table === "crm_activities")?.payload).toMatchObject({
      organization_id: "org-1",
      lead_id: "lead-1",
      type: "stage_change",
      content: "Movido de “Novo Lead” para “Proposta Enviada”",
      created_via: "hermes",
      created_by: "u-1",
    });
  });

  it("reordenar na mesma etapa não gera histórico", async () => {
    const { supabase, ops } = fakeSupabase(respond([{ id: "a", position: 1024 }]));
    await moveLead(ctxWith(supabase), { leadId: "lead-1", stageId: "stage-1", index: 0 });
    expect(ops.some((op) => op.table === "crm_activities")).toBe(false);
  });

  it("recusa etapa de outro funil ou empresa", async () => {
    const { supabase } = fakeSupabase((op) => (op.table === "crm_stages" ? { data: null } : respond([])(op)));
    await expect(moveLead(ctxWith(supabase), { leadId: "lead-1", stageId: "stage-x", index: 0 })).rejects.toBeInstanceOf(ServiceError);
  });
});
