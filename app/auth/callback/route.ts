import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { RATE_LIMITS, rateLimitByIp } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const params = z.object({ code: z.string().min(1).max(512), next: z.string().max(512).optional() });

// Destino do link de confirmação de e-mail (fluxo PKCE).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const parsed = params.safeParse(Object.fromEntries(searchParams));

  if (parsed.success && (await rateLimitByIp("auth-callback", RATE_LIMITS.authCallbackIp, request.headers))) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.data.code);
    if (!error) return NextResponse.redirect(`${origin}${safeNextPath(parsed.data.next)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=link`);
}
