import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { RATE_LIMITS, rateLimitByIp } from "@/lib/rate-limit";
import { verifySignedRequest } from "./meta";

// Comum aos callbacks de desautorização e exclusão de dados: rate limit, signed_request verificado com o app secret.
export async function readMetaSignedRequest(request: NextRequest): Promise<{ userId: string } | NextResponse> {
  if (!(await rateLimitByIp("meta-webhook", RATE_LIMITS.metaWebhookIp, request.headers))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const signedRequest = form?.get("signed_request");
  const payload = typeof signedRequest === "string" && signedRequest.length <= 4096 ? verifySignedRequest(signedRequest, appSecret) : null;
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  return { userId: payload.user_id };
}
