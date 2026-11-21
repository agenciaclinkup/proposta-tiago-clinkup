import type { Metadata } from "next";
import { getAdminOverview } from "@/lib/services/super-admin";
import { requireSuperAdmin } from "@/lib/super-admin";
import { SuperAdminView } from "./view";

export const metadata: Metadata = { title: "Super-Admin" };

export default async function SuperAdminPage() {
  const actor = await requireSuperAdmin();
  const { overview, auditLogs } = await getAdminOverview(actor);

  return <SuperAdminView actorEmail={actor.email} overview={overview} auditLogs={auditLogs} />;
}
