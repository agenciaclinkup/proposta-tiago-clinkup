import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/workspace";
import { serviceContext } from "@/lib/services/context";
import { listIntegrations } from "@/lib/services/integrations";
import { listSocialPosts } from "@/lib/services/social-posts";
import { CalendarView, type CalendarPost, type CalendarIntegration } from "./view";

export const metadata: Metadata = { title: "Calendário editorial" };
export default async function CalendarPage() {
  const workspace = await requireWorkspace();
  const ctx = serviceContext(workspace, "manual");
  const [integrations, first] = await Promise.all([listIntegrations(ctx), listSocialPosts(ctx, { limit: 100 })]);
  const posts = [...first];
  let page = first;
  while (page.length === 100 && posts.length < 1000) {
    page = await listSocialPosts(ctx, { limit: 100, offset: posts.length });
    posts.push(...page);
  }
  const accounts: CalendarIntegration[] = integrations.filter((row) => row.status === "connected" && ["instagram", "facebook_page", "google_business"].includes(row.provider))
    .map((row) => ({ id: row.id, provider: row.provider, name: row.display_name ?? row.external_account_id }));
  return <CalendarView posts={posts as CalendarPost[]} accounts={accounts} truncated={posts.length >= 1000} />;
}
