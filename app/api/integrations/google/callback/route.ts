import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  exchangeGoogleCode,
  fetchGoogleBusinessLocations,
  fetchGooglePrimaryCalendar,
  mapGoogleConnections,
} from "@/lib/integrations/google";
import { OAUTH_NONCE_COOKIE, verifyOAuthState } from "@/lib/integrations/oauth-state";
import { saveIntegration } from "@/lib/services/integrations";
import { loadWorkspace } from "@/lib/workspace";

const params = z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(2048) });
const product = z.enum(["business", "calendar"]);

// Retorno do login com o Google. Sempre limpa o nonce e volta para /integrations com o resultado.
export async function GET(request: NextRequest) {
  const back = (status: string) => {
    const response = NextResponse.redirect(new URL(`/integrations?google=${status}`, request.url));
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
      provider: "google",
      nonce: request.cookies.get(OAUTH_NONCE_COOKIE)?.value,
    });
  const chosen = verified ? product.safeParse(verified.context) : null;
  if (!parsed.success || !verified || !chosen?.success) return back("invalid_state");

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/$/, "");
    const tokens = await exchangeGoogleCode(parsed.data.code, `${siteUrl}/api/integrations/google/callback`);
    // Sem refresh token a conexão pararia de funcionar em ~1 hora: melhor pedir para autorizar de novo.
    if (!tokens.refreshToken) return back("no_refresh");

    const rows = mapGoogleConnections({
      product: chosen.data,
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      grantId: randomUUID(),
      tokens: { ...tokens, refreshToken: tokens.refreshToken },
      locations: chosen.data === "business" ? await fetchGoogleBusinessLocations(tokens.accessToken) : [],
      calendar: chosen.data === "calendar" ? await fetchGooglePrimaryCalendar(tokens.accessToken) : null,
    });
    if (rows.length === 0) return back("none");
    for (const row of rows) await saveIntegration(row);
    return back("connected");
  } catch (error) {
    console.error("[google] falha no callback OAuth", error);
    return back("error");
  }
}
