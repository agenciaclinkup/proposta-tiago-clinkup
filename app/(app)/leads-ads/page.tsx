import type { Metadata } from "next";
import { listStages } from "@/lib/services/crm";
import { serviceContext } from "@/lib/services/context";
import { listProspectSearches, listProspects } from "@/lib/services/prospecting";
import { getUsageSummary } from "@/lib/services/usage";
import { requireWorkspace } from "@/lib/workspace";
import { ProspectingView, type Prospect, type Search, type Stage } from "./view";

export const metadata: Metadata = { title: "Prospecção" };
export default async function ProspectingPage() {
  const workspace = await requireWorkspace(); const ctx = serviceContext(workspace, "manual");
  const [searches, prospects, stages, usage] = await Promise.all([listProspectSearches(ctx), listProspects(ctx), listStages(ctx), getUsageSummary(ctx)]);
  const credits = usage.find((item) => item.metric === "scraped_leads") ?? { used: 0, limit: 0 };
  return <ProspectingView searches={searches as Search[]} prospects={prospects as Prospect[]} stages={stages as Stage[]} credits={{ used: credits.used, limit: credits.limit }} />;
}
