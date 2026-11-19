import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { googleAuthorizeUrl } from "@/lib/integrations/google";
import { createOAuthState, OAUTH_NONCE_COOKIE } from "@/lib/integrations/oauth-state";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { loadWorkspace } from "@/lib/workspace";

const product = z.enum(["business", "calendar"]);
const back = (request: NextRequest, status: string) => NextResponse.redirect(new URL(`/integrations?google=${status}`, request.url));

// Inicia o login com o Google para um produto (Business Profile ou Calendar). Só owner/admin.
export async function GET(request: NextRequest) {
  const loaded = await loadWorkspace();
  if (loaded.status !== "ok") return NextResponse.redirect(new URL("/login?next=/integrations", request.url));
  const { workspace } = loaded;

  const parsed = product.safeParse(request.nextUrl.searchParams.get("product"));
  if (!parsed.success) return back(request, "invalid");
  if (workspace.role === "member") return back(request, "forbidden");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !siteUrl) {
    console.error("[google] GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou NEXT_PUBLIC_SITE_URL não configurados");
    return back(request, "unavailable");
  }
  if (!(await rateLimit(`integrations:user:${workspace.user.id}`, RATE_LIMITS.integrationsUser))) {
    return back(request, "rate_limited");
  }

  const { state, nonce } = createOAuthState({
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    provider: "google",
    context: parsed.data,
  });
  const response = NextResponse.redirect(
    googleAuthorizeUrl({ product: parsed.data, redirectUri: `${siteUrl}/api/integrations/google/callback`, state }),
  );
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: siteUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/integrations",
    maxAge: 600,
  });
  return response;
}
