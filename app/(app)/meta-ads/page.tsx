import type { Metadata } from "next";
import { getPlan } from "@/config/plans";
import { serviceContext } from "@/lib/services/context";
import { listIntegrations } from "@/lib/services/integrations";
import { checkAdsReadiness, listAdAccounts, listAdActionLogs, listAdCampaigns } from "@/lib/services/meta-ads";
import { requireWorkspace } from "@/lib/workspace";
import { MetaAdsView, type AdAccountView, type AdActionLogView, type AdCampaignView, type MetaIntegrationView } from "./view";

export const metadata: Metadata = { title: "Meta Ads" };

export default async function MetaAdsPage() {
  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  const plan = getPlan(workspace.organization.plan_id);
  const isAdmin = ["owner", "admin"].includes(workspace.role);

  const [readiness, accounts, campaigns, logs, integrations] = await Promise.all([
    checkAdsReadiness(ctx),
    listAdAccounts(ctx),
    listAdCampaigns(ctx),
    listAdActionLogs(ctx, 30),
    listIntegrations(ctx),
  ]);

  const metaIntegrations: MetaIntegrationView[] = integrations
    .filter((row) => row.provider === "meta_ads" && row.status !== "disconnected")
    .map((row) => ({
      id: row.id,
      displayName: row.display_name ?? row.external_account_id,
      externalAccountId: row.external_account_id,
      status: row.status,
    }));

  return (
    <MetaAdsView
      planName={plan?.name ?? workspace.organization.plan_id}
      isAdmin={isAdmin}
      readiness={{
        ready: readiness.ready,
        planEnabled: readiness.planEnabled,
        maxActiveAdCampaigns: readiness.maxActiveAdCampaigns,
        issues: readiness.issues,
      }}
      integrations={metaIntegrations}
      accounts={accounts as AdAccountView[]}
      campaigns={campaigns as AdCampaignView[]}
      logs={logs as AdActionLogView[]}
    />
  );
}
