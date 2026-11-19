import { NextResponse, type NextRequest } from "next/server";
import { metaAuthorizeUrl } from "@/lib/integrations/meta";
import { createOAuthState, OAUTH_NONCE_COOKIE } from "@/lib/integrations/oauth-state";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { loadWorkspace } from "@/lib/workspace";

const back = (request: NextRequest, status: string) => NextResponse.redirect(new URL(`/integrations?meta=${status}`, request.url));

// Inicia o login com a Meta (só owner/admin). Navegação do navegador: erros voltam para /integrations com aviso.
export async function GET(request: NextRequest) {
  const loaded = await loadWorkspace();
  if (loaded.status !== "ok") return NextResponse.redirect(new URL("/login?next=/integrations", request.url));
  const { workspace } = loaded;
  if (workspace.role === "member") return back(request, "forbidden");

  const appId = process.env.META_APP_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!appId || !process.env.META_APP_SECRET || !siteUrl) {
    console.error("[meta] META_APP_ID, META_APP_SECRET ou NEXT_PUBLIC_SITE_URL não configurados");
    return back(request, "unavailable");
  }
  if (!(await rateLimit(`integrations:user:${workspace.user.id}`, RATE_LIMITS.integrationsUser))) {
    return back(request, "rate_limited");
  }

  const { state, nonce } = createOAuthState({
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    provider: "meta",
  });
  const response = NextResponse.redirect(
    metaAuthorizeUrl({ appId, redirectUri: `${siteUrl}/api/integrations/meta/callback`, state }),
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
