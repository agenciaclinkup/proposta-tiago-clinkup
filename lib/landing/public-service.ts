import "server-only";
import { PLANS } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureSchema, organizationSlugSchema, publicSlugSchema } from "./public-input";

type Section = { type: "hero" | "content" | "features" | "testimonial" | "cta" | "form"; heading: string; body: string; imagePath: string | null };
type Row = { title: string; sections: Section[]; organization_id: string; stage_id: string | null };
async function findPage(orgSlug: string, slug: string) {
  if (!organizationSlugSchema.safeParse(orgSlug).success || !publicSlugSchema.safeParse(slug).success) return null;
  const admin = createAdminClient();
  const org = await admin.from("organizations").select("id,name").eq("slug", orgSlug).maybeSingle();
  if (org.error) throw new Error("landing organization lookup failed");
  if (!org.data) return null;
  const result = await admin.from("landing_pages").select("title,sections,organization_id,stage_id").eq("organization_id", org.data.id).eq("slug", slug).eq("published", true).maybeSingle();
  if (result.error) throw new Error("landing lookup failed");
  if (!result.data) return null;
  const brand = await admin.from("brand_context").select("visual_identity").eq("organization_id", org.data.id).maybeSingle();
  if (brand.error) throw new Error("landing brand lookup failed");
  const value = brand.data?.visual_identity?.primary_color;
  const accent = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#00D4FF";
  return { row: result.data as Row, company: org.data.name as string, accent };
}

export async function getPublicLanding(orgSlug: string, slug: string) {
  const found = await findPage(orgSlug, slug);
  if (!found) return null;
  const { row, company, accent } = found;
  return { title: row.title, company, accent, acceptsLeads: Boolean(row.stage_id), sections: row.sections.map((s, index) => ({ type: s.type, heading: s.heading, body: s.body, imageUrl: s.imagePath && s.imagePath.startsWith(`${row.organization_id}/`) && !s.imagePath.includes("..") ? `/p/${encodeURIComponent(orgSlug)}/${encodeURIComponent(slug)}/media/${index}` : null })) };
}

export async function getPublicLandingImage(orgSlug: string, slug: string, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= 30) return null;
  const found = await findPage(orgSlug, slug);
  const path = found?.row.sections[index]?.imagePath;
  if (!found || !path || !path.startsWith(`${found.row.organization_id}/`) || path.includes("..") || !/^[a-zA-Z0-9._-]+$/.test(path.slice(found.row.organization_id.length + 1))) return null;
  const result = await createAdminClient().storage.from("studio-assets").download(path);
  if (result.error || !result.data || !["image/jpeg", "image/png", "image/webp"].includes(result.data.type)) return null;
  return result.data;
}

export async function capturePublicLead(orgSlug: string, slug: string, input: unknown) {
  const parsed = captureSchema.safeParse(input);
  if (!parsed.success || !organizationSlugSchema.safeParse(orgSlug).success || !publicSlugSchema.safeParse(slug).success) return false;
  if (parsed.data.website) return true;
  const limits = Object.fromEntries(PLANS.map((plan) => [plan.id, plan.limits.crmLeads]));
  const result = await createAdminClient().rpc("capture_landing_lead", { p_org_slug: orgSlug, p_slug: slug, p_name: parsed.data.name, p_email: parsed.data.email || null, p_whatsapp: parsed.data.whatsapp || null, p_message: parsed.data.message || null, p_limits: limits });
  if (result.error) throw new Error("landing capture failed");
  return result.data === true;
}
