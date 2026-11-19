import { createHash } from "node:crypto";
import { getPublicLandingImage } from "@/lib/landing/public-service";
import { clientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; slug: string; index: string }> }) {
  const { orgSlug, slug, index } = await params;
  if (!/^(?:0|[1-9]\d?)$/.test(index)) return new Response(null, { status: 404 });
  const hash = createHash("sha256").update(`${clientIp(request.headers)}\0${orgSlug}\0${slug}`).digest("hex");
  const limit = await createAdminClient().rpc("rate_limit_hit", { p_key: `landing-media:${hash}`, p_limit: RATE_LIMITS.landingMedia.limit, p_window_seconds: RATE_LIMITS.landingMedia.windowSeconds });
  if (limit.error || limit.data !== true) return new Response(null, { status: 429 });
  const blob = await getPublicLandingImage(orgSlug, slug, Number(index));
  if (!blob) return new Response(null, { status: 404 });
  return new Response(await blob.arrayBuffer(), { headers: { "Content-Type": blob.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
