import "server-only";
import { z } from "zod";
import { getGoogleAccessToken, resolveGoogleBusinessLocation } from "@/lib/integrations/google";
import { checkPublishedStatus, publishFacebook, publishGoogle, publishInstagram } from "@/lib/integrations/social-publish";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIntegrationToken } from "./integrations";
import { ServiceError } from "./errors";
import { processClaim, RejectedPublication, SafeTransientError, type SocialClaim } from "./social-publish-queue";

const claimSchema = z.object({ id: z.uuid(), organization_id: z.uuid(), lease_token: z.uuid() });
const postSchema = z.object({ format: z.string(), caption: z.string(), hashtags: z.array(z.string()), media: z.array(z.object({ path: z.string(), type: z.enum(["image", "video"]) })) });
const targetSchema = z.object({ integration_id: z.uuid(), channel: z.enum(["instagram", "facebook", "google_business"]) });
const reconcileSchema = z.object({ post_id: z.uuid(), organization_id: z.uuid(), integration_id: z.uuid(), channel: z.enum(["facebook", "google_business"]), external_id: z.string().min(1).max(500) });

export async function reconcileSocialPublications() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("social_post_targets").select("post_id,organization_id,integration_id,channel,external_id").eq("publish_state", "uncertain").not("external_id", "is", null).in("channel", ["facebook", "google_business"]).order("reconciled_at", { ascending: true, nullsFirst: true }).limit(10);
  if (error) throw new Error(error.message);
  const targets = z.array(reconcileSchema).parse(data);
  await Promise.all(targets.map(async (target) => {
    let result: "pending" | "published" | "failed" = "pending";
    try {
      const integration = await admin.from("integrations").select("provider,status").eq("id", target.integration_id).eq("organization_id", target.organization_id).maybeSingle();
      const expected = target.channel === "facebook" ? "facebook_page" : "google_business";
      if (!integration.error && integration.data?.status === "connected" && integration.data.provider === expected) {
        const token = target.channel === "google_business" ? await getGoogleAccessToken(target.organization_id, target.integration_id) : (await getIntegrationToken(target.organization_id, target.integration_id)).accessToken;
        result = await checkPublishedStatus(target.channel, target.external_id, token);
      }
    } catch {
      // Erros de consulta não autorizam reenviar nem expõem credenciais no log.
    }
    const saved = await admin.rpc("reconcile_social_target", { p_post: target.post_id, p_org: target.organization_id, p_integration: target.integration_id, p_external_id: target.external_id, p_result: result });
    if (saved.error) console.error("[social-publisher] falha ao registrar conciliação");
  }));
  return { checked: targets.length };
}

export async function runSocialPublishBatch() {
  const admin = createAdminClient();
  // Cada tarefa do lote começa imediatamente; a posse não fica aguardando outras tarefas longas.
  const { data, error } = await admin.rpc("claim_social_posts", { p_limit: 5 });
  if (error) throw new Error(error.message);
  const claims = z.array(claimSchema).parse(data);
  const outcomes = await Promise.all(claims.map((item) => runClaim({ id: item.id, organizationId: item.organization_id, leaseToken: item.lease_token })));
  return { claimed: claims.length, processed: outcomes.filter(Boolean).length };
}

export async function runClaim(claim: SocialClaim, expectedAccounts?: Record<string, { account: string; provider: string; status: string }>) {
  const admin = createAdminClient();

    try {
      const [postResult, targetResult] = await Promise.all([
        admin.from("social_posts").select("format,caption,hashtags,media").eq("id", claim.id).eq("organization_id", claim.organizationId).eq("lease_token", claim.leaseToken).single(),
        admin.from("social_post_targets").select("channel,integration_id").eq("post_id", claim.id).eq("organization_id", claim.organizationId).eq("publish_state", "pending").order("channel"),
      ]);
      if (postResult.error || targetResult.error) throw new Error("queue read failed");
      const post = postSchema.parse(postResult.data);
      const targets = z.array(targetSchema).parse(targetResult.data);
      const byId = new Map(targets.map((target) => [target.integration_id, target]));
      await processClaim(claim, targets.map((target) => target.integration_id), {
        start: async (integrationId) => {
          const result = await admin.rpc("start_social_target", { p_post: claim.id, p_org: claim.organizationId, p_integration: integrationId, p_lease: claim.leaseToken });
          if (result.error) throw new Error(result.error.message);
        },
        publish: async (integrationId) => {
          const target = byId.get(integrationId)!;
          // Esta preparação não cria post público: falhas transitórias podem ser repetidas.
          let input: { accountId: string; token: string; caption: string; media: { url: string; type: "image" | "video" }[]; format: string };
          try {
          const { data: integration, error: integrationError } = await admin.from("integrations").select("provider,status,external_account_id").eq("id", integrationId).eq("organization_id", claim.organizationId).maybeSingle();
          const provider = { instagram: "instagram", facebook: "facebook_page", google_business: "google_business" }[target.channel];
          if (integrationError) throw new Error("integration lookup failed");
          if (!integration || integration.status !== "connected" || integration.provider !== provider) throw new RejectedPublication("integration disconnected");
          const expected = expectedAccounts?.[integrationId];
          if (expectedAccounts && (!expected || expected.account !== integration.external_account_id || expected.provider !== provider || expected.status !== "connected")) throw new RejectedPublication("integration disconnected");
          const media = [];
          for (const item of post.media) {
            if (!item.path.startsWith(`${claim.organizationId}/`) || item.path.includes("..")) throw new RejectedPublication("invalid media");
            const signed = await admin.storage.from("social-media").createSignedUrl(item.path, 3600);
            if (signed.error || !signed.data?.signedUrl) throw new Error("media unavailable");
            media.push({ url: signed.data.signedUrl, type: item.type });
          }
          let token: string;
          try {
            token = target.channel === "google_business" ? await getGoogleAccessToken(claim.organizationId, integrationId) : (await getIntegrationToken(claim.organizationId, integrationId)).accessToken;
          } catch (error) {
            if (error instanceof ServiceError) throw new RejectedPublication("integration disconnected");
            throw error;
          }
          const caption = [post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n");
          const externalAccount = expected?.account ?? integration.external_account_id;
          const accountId = target.channel === "google_business" ? await resolveGoogleBusinessLocation(token, externalAccount) : externalAccount;
          input = { accountId, token, caption, media, format: post.format };
          } catch (error) {
            if (error instanceof RejectedPublication) throw error;
            if (error instanceof ServiceError) throw new RejectedPublication("integration disconnected");
            throw new SafeTransientError();
          }
          if (target.channel === "instagram") return publishInstagram(input);
          if (target.channel === "facebook") return publishFacebook(input);
          return publishGoogle(input);
        },
        finish: async (integrationId, result, externalId, message) => {
          const finished = await admin.rpc("finish_social_target", { p_post: claim.id, p_org: claim.organizationId, p_integration: integrationId, p_lease: claim.leaseToken, p_result: result, p_external_id: externalId, p_error: message });
          if (finished.error) throw new Error(finished.error.message);
        },
      });
      return true;
    } catch (error) {
      // Não incluir payload, tokens ou URLs assinadas nos logs.
      console.error("[social-publisher] não foi possível concluir a tarefa", error instanceof Error ? error.name : "erro");
      return false;
    }
}
