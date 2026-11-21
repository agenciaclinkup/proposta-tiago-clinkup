import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getPlan } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "./context";
import { listStages, resolveStage } from "./crm";
import { ServiceError } from "./errors";

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
type Binding = { conversationId: string | null };

export const proposeProspectTransferSchema = z.strictObject({
  prospectIds: z.array(z.uuid()).min(1, "Selecione ao menos uma empresa.").max(20, "Selecione no máximo 20 empresas por confirmação."),
  stage: z.string().trim().min(1).max(200).optional(),
});

type ProspectRow = {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  status: string;
};

export async function proposeProspectTransfer(
  ctx: ServiceContext,
  binding: Binding,
  input: z.input<typeof proposeProspectTransferSchema>,
) {
  if (!ctx.userId || !["web", "telegram"].includes(ctx.channel)) {
    throw new ServiceError("Entre na sua conta para confirmar o envio ao CRM.");
  }
  const parsed = proposeProspectTransferSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Confira as empresas selecionadas e a etapa do funil.");
  }

  const admin = createAdminClient();
  const membership = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (membership.error || !membership.data) throw new ServiceError("Você não tem acesso a esta empresa.");

  const prospectIds = [...new Set(parsed.data.prospectIds)];
  const stages = await listStages(ctx);
  let targetStage: (typeof stages)[number] | undefined = stages[0];
  if (parsed.data.stage) {
    const resolvedId = await resolveStage(ctx, parsed.data.stage);
    targetStage = stages.find((row) => row.id === resolvedId);
  }
  if (!targetStage) throw new ServiceError("Não encontramos uma etapa válida no funil da sua empresa.");

  const { data: prospects, error: prospectsError } = await admin
    .from("scraped_leads")
    .select("id, name, city, category, phone, email, status")
    .eq("organization_id", ctx.organizationId)
    .in("id", prospectIds);
  if (prospectsError) throw new Error(prospectsError.message);

  const rows = (prospects ?? []) as ProspectRow[];
  if (rows.length !== prospectIds.length) {
    throw new ServiceError("Não encontramos uma ou mais empresas selecionadas na sua organização.");
  }

  const alreadySent = rows.filter((row) => row.status === "sent_to_crm");
  if (alreadySent.length > 0) {
    throw new ServiceError(`Estas empresas já foram enviadas ao CRM: ${alreadySent.map((row) => row.name).join(", ")}.`);
  }
  const unavailable = rows.filter((row) => row.status !== "new");
  if (unavailable.length > 0) {
    throw new ServiceError(`Estas empresas não estão disponíveis para envio ao CRM: ${unavailable.map((row) => row.name).join(", ")}.`);
  }

  const crmLimit = getPlan(ctx.planId)?.limits.crmLeads ?? 0;
  const { count, error: countError } = await admin
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) + prospectIds.length > crmLimit) {
    throw new ServiceError("Sua empresa atingiu o limite de leads no CRM para enviar este lote. Consulte a página Planos.");
  }

  const code = randomBytes(16).toString("hex");
  const { error: insertError } = await admin.from("prospect_confirmations").insert({
    organization_id: ctx.organizationId,
    user_id: ctx.userId,
    channel: ctx.channel,
    conversation_id: binding.conversationId,
    proof_hash: hash(code),
    pipeline_id: targetStage.pipeline_id,
    stage_id: targetStage.id,
    prospect_ids: prospectIds,
  });
  if (insertError) throw new Error(insertError.message);

  return {
    code,
    stage: { id: targetStage.id, name: targetStage.name },
    prospects: rows.map((row) => ({
      prospectId: row.id,
      name: row.name,
      city: row.city,
      category: row.category,
      phone: row.phone,
      email: row.email,
    })),
  };
}

export async function confirmProspectTransfer(ctx: ServiceContext, binding: Binding, proof: string) {
  if (!ctx.userId || !/^[0-9a-f]{32}$/.test(proof)) {
    throw new ServiceError("Confirmação inválida. Solicite uma nova proposta.");
  }
  const crmLimit = getPlan(ctx.planId)?.limits.crmLeads ?? 0;
  const { data, error } = await createAdminClient().rpc("confirm_prospect_transfer", {
    p_org: ctx.organizationId,
    p_user: ctx.userId,
    p_channel: ctx.channel,
    p_conversation: binding.conversationId,
    p_hash: hash(proof),
    p_limit: crmLimit,
  });
  if (error) {
    if (error.message.includes("confirmation_invalid")) {
      throw new ServiceError("Esta confirmação expirou, já foi usada ou pertence a outra conversa. Solicite uma nova proposta.");
    }
    if (error.message.includes("prospect_crm_limit")) {
      throw new ServiceError("Sua empresa atingiu o limite de leads no CRM. Consulte a página Planos.");
    }
    if (error.message.includes("prospect_stage_invalid")) {
      throw new ServiceError("A etapa do funil selecionada não está mais disponível. Solicite uma nova proposta.");
    }
    if (error.message.includes("prospect_not_found")) {
      throw new ServiceError("Uma ou mais empresas da proposta não foram encontradas na sua organização.");
    }
    if (error.message.includes("prospect_state_invalid")) {
      throw new ServiceError("Uma ou mais empresas mudaram de situação e não podem ser enviadas ao CRM. Solicite uma nova proposta.");
    }
    if (error.message.includes("prospect_forbidden")) {
      throw new ServiceError("Você não tem acesso a esta empresa.");
    }
    throw new Error(error.message);
  }
  return data as { stageId: string; transferredCount: number; leads: { id: string; name: string; stage_id: string }[] };
}
