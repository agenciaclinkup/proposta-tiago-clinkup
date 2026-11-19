import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/workspace";
import { serviceContext } from "@/lib/services/context";
import { listStages } from "@/lib/services/crm";
import { listIntegrations } from "@/lib/services/integrations";
import { listCarousels, listLandingPages } from "@/lib/services/studio";
import { getUsageSummary } from "@/lib/services/usage";
import { StudioView, type StudioAccount, type StudioCarousel, type StudioLanding, type StudioStage } from "./view";

export const metadata: Metadata = { title: "Estúdio de criação" };
// Server Actions herdam este limite: geração com IA tem timeout de 90 s e a exportação renderiza até 10 PNGs.
export const maxDuration = 120;

export default async function StudioPage() {
  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  const [carousels, landingPages, usage, integrations, stages] = await Promise.all([
    listCarousels(ctx),
    listLandingPages(ctx),
    getUsageSummary(ctx),
    listIntegrations(ctx),
    // Sem funil, a landing page continua editável; só não oferece a etapa do CRM.
    listStages(ctx).catch(() => []),
  ]);
  const credits = usage.find((row) => row.metric === "ai_credits") ?? { used: 0, limit: 0 };
  const accounts: StudioAccount[] = integrations
    .filter((row) => row.status === "connected" && ["instagram", "facebook_page", "google_business"].includes(row.provider))
    .map((row) => ({ id: row.id, provider: row.provider, name: row.display_name ?? row.external_account_id }));

  return (
    <StudioView
      carousels={carousels as StudioCarousel[]}
      landingPages={landingPages as StudioLanding[]}
      accounts={accounts}
      stages={stages as StudioStage[]}
      credits={{ used: credits.used, limit: credits.limit }}
      aiProvider={Boolean(process.env.ANTHROPIC_API_KEY)}
      orgSlug={workspace.organization.slug}
    />
  );
}
