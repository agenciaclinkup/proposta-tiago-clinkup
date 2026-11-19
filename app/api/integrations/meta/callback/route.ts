import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exchangeMetaCode, fetchMetaAccounts, mapMetaConnections } from "@/lib/integrations/meta";
import { OAUTH_NONCE_COOKIE, verifyOAuthState } from "@/lib/integrations/oauth-state";
import { saveIntegration } from "@/lib/services/integrations";
import { loadWorkspace } from "@/lib/workspace";

const params = z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(2048) });

// Retorno do login com a Meta. Sempre limpa o nonce e volta para /integrations com o resultado.
export async function GET(request: NextRequest) {
  const back = (status: string, extra = "") => {
    const response = NextResponse.redirect(new URL(`/integrations?meta=${status}${extra}`, request.url));
    response.cookies.set(OAUTH_NONCE_COOKIE, "", { path: "/api/integrations", maxAge: 0 });
    return response;
  };

  const loaded = await loadWorkspace();
  if (loaded.status !== "ok") return NextResponse.redirect(new URL("/login?next=/integrations", request.url));
  const { workspace } = loaded;

  const search = request.nextUrl.searchParams;
  if (search.get("error")) return back("cancelled");
  if (workspace.role === "member") return back("forbidden");

  const parsed = params.safeParse({ code: search.get("code"), state: search.get("state") });
  const verified =
    parsed.success &&
    verifyOAuthState(parsed.data.state, {
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      provider: "meta",
      nonce: request.cookies.get(OAUTH_NONCE_COOKIE)?.value,
    });
  if (!parsed.success || !verified) return back("invalid_state");

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/$/, "");
    const userToken = await exchangeMetaCode(parsed.data.code, `${siteUrl}/api/integrations/meta/callback`);
    const accounts = await fetchMetaAccounts(userToken.accessToken);
    const rows = mapMetaConnections({
      ...accounts,
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      userToken,
    });
    if (rows.length === 0) return back("none");
    for (const row of rows) await saveIntegration(row);
    return back("connected", `&count=${rows.length}`);
  } catch (error) {
    console.error("[meta] falha no callback OAuth", error);
    return back("error");
  }
}
