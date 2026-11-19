import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { capturePublicLead } from "@/lib/landing/public-service";
import { clientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const failure = "Não foi possível enviar seus dados agora. Tente novamente mais tarde.";
async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(data);
  } finally { reader.releaseLock(); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgSlug: string; slug: string }> }) {
  const { orgSlug, slug } = await params;
  const hash = createHash("sha256").update(`${clientIp(request.headers)}\0${orgSlug}\0${slug}`).digest("hex");
  try {
    const limit = await createAdminClient().rpc("rate_limit_hit", { p_key: `landing:${hash}`, p_limit: RATE_LIMITS.landingCapture.limit, p_window_seconds: RATE_LIMITS.landingCapture.windowSeconds });
    if (limit.error || limit.data !== true) return NextResponse.json({ error: failure }, { status: 429 });
    if (Number(request.headers.get("content-length") ?? 0) > 16384) return NextResponse.json({ error: failure }, { status: 400 });
    const body = await boundedBody(request);
    if (body === null) return NextResponse.json({ error: failure }, { status: 400 });
    let input: unknown;
    try { input = JSON.parse(body); } catch { return NextResponse.json({ error: failure }, { status: 400 }); }
    if (!(await capturePublicLead(orgSlug, slug, input))) return NextResponse.json({ error: failure }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: failure }, { status: 503 });
  }
}
