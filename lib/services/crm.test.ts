import { describe, expect, it } from "vitest";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import {
  resolveStage,
  computePosition,
  countOpenOpportunities,
  createLead,
  createStage,
  deleteLead,
  deleteStage,
  getLead,
  memberNames,
  leadInputSchema,
  moveLead,
  POSITION_STEP,
  reorderStages,
  updateStage,
} from "./crm";

// Supabase falso: registra cada operação (tabela, tipo, filtros, payload) e responde via `respond`.
type Op = { table: string; kind: "select" | "insert" | "update" | "delete"; filters: string[]; payload?: unknown; head?: boolean };
function fakeSupabase(respond: (op: Op) => { data?: unknown; count?: number }) {
  const ops: Op[] = [];
  const builder = (op: Op) => {
    const run = () => ({ data: null, error: null, count: null, ...respond(op) });
    const b = {
      select: (_cols?: string, opts?: { head?: boolean }) => ((op.head = opts?.head), b),
      eq: (c: string, v: unknown) => (op.filters.push(`${c}=${v}`), b),
      neq: (c: string, v: unknown) => (op.filters.push(`${c}!=${v}`), b),
      in: (c: string, v: unknown[]) => (op.filters.push(`${c} in ${v.join(",")}`), b),
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
      delete: () => {
        const op: Op = { table, kind: "delete", filters: [] };
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

describe("gestão de etapas (só owner/admin)", () => {
  const admin = (supabase: unknown) => ctxWith(supabase, { role: "admin" });
  const stagesRespond = (leadCount = 0, stages = [{ id: "s1" }, { id: "s2" }]) => (op: Op) => {
    if (op.table === "crm_pipelines") return { data: { id: "pipe-1" } };
    if (op.table === "crm_leads" && op.head) return { count: leadCount };
    if (op.table === "crm_stages" && op.kind === "select" && op.filters.some((f) => f.startsWith("id="))) return { data: { id: "s1", name: "Novo Lead", pipeline_id: "pipe-1" } };
    if (op.table === "crm_stages" && op.kind === "select") return { data: stages.map((s, i) => ({ ...s, position: i })) };
    if (op.kind === "insert") return { data: { id: "s-new", ...(op.payload as object) } };
    if (op.kind === "update" || op.kind === "delete") return { data: { id: "s1" } };
    return {};
  };

  it("member não cria, edita, reordena nem exclui etapas", async () => {
    const { supabase, ops } = fakeSupabase(stagesRespond());
    const member = ctxWith(supabase);
    await expect(createStage(member, { name: "Negociação" })).rejects.toBeInstanceOf(ServiceError);
    await expect(updateStage(member, "s1", { name: "x" })).rejects.toBeInstanceOf(ServiceError);
    await expect(reorderStages(member, ["s2", "s1"])).rejects.toBeInstanceOf(ServiceError);
    await expect(deleteStage(member, "s1")).rejects.toBeInstanceOf(ServiceError);
    await expect(deleteLead(member, "lead-1")).rejects.toBeInstanceOf(ServiceError);
    expect(ops).toHaveLength(0);
  });

  it("cria etapa no fim do funil padrão da empresa", async () => {
    const { supabase, ops } = fakeSupabase(stagesRespond());
    await createStage(admin(supabase), { name: "Negociação", color: "#F59E0B" });
    expect(ops.find((op) => op.kind === "insert")?.payload).toMatchObject({
      organization_id: "org-1",
      pipeline_id: "pipe-1",
      name: "Negociação",
      color: "#F59E0B",
      position: 2,
      kind: "open",
    });
  });

  it("reordena só com exatamente as etapas do funil", async () => {
    const { supabase, ops } = fakeSupabase(stagesRespond());
    await reorderStages(admin(supabase), ["s2", "s1"]);
    const updates = ops.filter((op) => op.kind === "update");
    expect(updates.map((op) => [op.payload, op.filters[0]])).toEqual([
      [{ position: 0 }, "id=s2"],
      [{ position: 1 }, "id=s1"],
    ]);
    await expect(reorderStages(admin(supabase), ["s1", "s-de-outra-empresa"])).rejects.toBeInstanceOf(ServiceError);
  });

  it("só exclui etapa vazia e nunca a última do funil", async () => {
    const withLeads = fakeSupabase(stagesRespond(3));
    await expect(deleteStage(admin(withLeads.supabase), "s1")).rejects.toThrow(/3 leads/);
    expect(withLeads.ops.some((op) => op.kind === "delete")).toBe(false);

    const lastOne = fakeSupabase(stagesRespond(0, [{ id: "s1" }]));
    await expect(deleteStage(admin(lastOne.supabase), "s1")).rejects.toBeInstanceOf(ServiceError);

    const ok = fakeSupabase(stagesRespond(0));
    await deleteStage(admin(ok.supabase), "s1");
    expect(ok.ops.find((op) => op.kind === "delete")?.filters).toEqual(["id=s1", "organization_id=org-1"]);
  });

  it("admin exclui lead da própria empresa", async () => {
    const { supabase, ops } = fakeSupabase(stagesRespond());
    await deleteLead(admin(supabase), "lead-1");
    expect(ops.find((op) => op.kind === "delete")).toMatchObject({ table: "crm_leads", filters: ["id=lead-1", "organization_id=org-1"] });
  });
});

describe("countOpenOpportunities", () => {
  it("conta leads nas etapas abertas do funil da empresa", async () => {
    const { supabase, ops } = fakeSupabase((op) => {
      if (op.table === "crm_stages") return { data: [{ id: "s1" }, { id: "s2" }] };
      if (op.table === "crm_leads" && op.head) return { count: 7 };
      return {};
    });
    expect(await countOpenOpportunities(ctxWith(supabase))).toBe(7);
    expect(ops.find((op) => op.table === "crm_stages")?.filters).toEqual(expect.arrayContaining(["organization_id=org-1", "kind=open"]));
    expect(ops.find((op) => op.head)?.filters).toEqual(expect.arrayContaining(["organization_id=org-1", "stage_id in s1,s2"]));
  });
});

describe("getLead", () => {
  it("busca o lead só na empresa do contexto e traz a etapa", async () => {
    const { supabase, ops } = fakeSupabase((op) =>
      op.table === "crm_leads" ? { data: { id: "lead-1", name: "Maria", stage_id: "s1", crm_stages: { name: "Novo Lead", kind: "open" } } } : {},
    );
    const lead = await getLead(ctxWith(supabase), "lead-1");
    expect(lead).toMatchObject({ id: "lead-1", stage: { name: "Novo Lead", kind: "open" } });
    expect(ops[0].filters).toEqual(["id=lead-1", "organization_id=org-1"]);
  });

  it("lead de outra empresa ou inexistente vira ServiceError", async () => {
    const { supabase } = fakeSupabase(() => ({ data: null }));
    await expect(getLead(ctxWith(supabase), "lead-x")).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("memberNames", () => {
  it("só resolve nomes de quem é membro da empresa", async () => {
    const { supabase, ops } = fakeSupabase((op) => {
      if (op.table === "organization_members") return { data: [{ user_id: "u-2" }] };
      if (op.table === "profiles") return { data: [{ id: "u-2", full_name: "Bruno Lima" }] };
      return {};
    });
    const names = await memberNames(ctxWith(supabase), ["u-2", "u-de-fora"], supabase as never);
    expect(Object.fromEntries(names)).toEqual({ "u-2": "Bruno Lima" });
    expect(ops.find((op) => op.table === "organization_members")?.filters).toEqual(expect.arrayContaining(["organization_id=org-1", "user_id in u-2,u-de-fora"]));
    expect(ops.find((op) => op.table === "profiles")?.filters).toEqual(["id in u-2"]);
  });
});


describe("resolveStage", () => {
  it("resolve nomes sem acento e caixa e filtra pela organização", async () => {
    const fake = fakeSupabase((op) => op.table === "crm_pipelines" ? { data: { id: "pipe-1" } } : { data: [{ id: "etapa-1", name: "Reunião Agendada" }] });
    expect(await resolveStage(ctxWith(fake.supabase), "reuniao AGENDADA")).toBe("etapa-1");
    expect(fake.ops.every((op) => op.filters.includes("organization_id=org-1"))).toBe(true);
    await expect(resolveStage(ctxWith(fake.supabase), "Outra")).rejects.toThrow("Reunião Agendada");
  });
  it("recusa nomes ambíguos", async () => {
    const fake = fakeSupabase((op) => op.table === "crm_pipelines" ? { data: { id: "pipe-1" } } : { data: [{ id: "1", name: "Reunião" }, { id: "2", name: "Reuniao" }] });
    await expect(resolveStage(ctxWith(fake.supabase), "reuniao")).rejects.toThrow("ambígua");
  });
});
