import { NextResponse, type NextRequest } from "next/server";
import { verifyAsaasWebhookToken } from "@/lib/integrations/asaas";
import { RATE_LIMITS, rateLimitByIp } from "@/lib/rate-limit";
import { processAsaasWebhookEvent } from "@/lib/services/asaas-billing";
import { ServiceError } from "@/lib/services/errors";

export async function POST(request: NextRequest) {
  if (!(await rateLimitByIp("asaas-webhook", RATE_LIMITS.asaasWebhookIp, request.headers))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const token = request.headers.get("asaas-access-token");
  if (!verifyAsaasWebhookToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await processAsaasWebhookEvent(body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[asaas-webhook] falha ao processar evento", error);
    return NextResponse.json({ error: "webhook processing failed" }, { status: 500 });
  }
}
