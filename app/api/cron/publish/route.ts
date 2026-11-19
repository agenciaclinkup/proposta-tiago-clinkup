import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { reconcileSocialPublications, runSocialPublishBatch } from "@/lib/services/social-publish-worker";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = z.string().max(512).safeParse(request.headers.get("authorization"));
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const received = Buffer.from(header.success ? header.data : "");
  if (!secret || secret.length < 32 || received.length !== expected.length || !timingSafeEqual(expected, received)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  if (!(await rateLimit("social-publish:cron", RATE_LIMITS.socialCron))) return Response.json({ error: "Muitas tentativas. Tente novamente em instantes." }, { status: 429 });
  try {
    // A falha de uma consulta de estado não deve impedir a captura de novos posts.
    await reconcileSocialPublications().catch(() => console.error("[social-publisher] falha ao consultar conciliação"));
    const result = await runSocialPublishBatch();
    return Response.json(result);
  } catch (error) {
    console.error("[social-publisher] falha ao executar fila", error instanceof Error ? error.name : "erro");
    return Response.json({ error: "Não foi possível processar a fila." }, { status: 500 });
  }
}
