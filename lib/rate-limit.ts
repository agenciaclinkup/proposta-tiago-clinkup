import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type RateRule = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  signInIp: { limit: 20, windowSeconds: 600 },
  signInEmail: { limit: 10, windowSeconds: 600 },
  signUpIp: { limit: 5, windowSeconds: 3600 },
  authCallbackIp: { limit: 30, windowSeconds: 600 },
  onboardingUser: { limit: 20, windowSeconds: 600 },
  billingUser: { limit: 10, windowSeconds: 600 },
  stripeWebhookIp: { limit: 300, windowSeconds: 60 },
  hermesChatUser: { limit: 20, windowSeconds: 60 },
  hermesDeleteUser: { limit: 30, windowSeconds: 60 },
  integrationsUser: { limit: 20, windowSeconds: 60 },
  telegramChat: { limit: 20, windowSeconds: 60 },
  telegramCodeUser: { limit: 5, windowSeconds: 600 },
} satisfies Record<string, RateRule>;

export const RATE_LIMIT_MESSAGE = "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";

// Primeiro IP de x-forwarded-for (definido pelo proxy da plataforma de deploy).
export function clientIp(source: Headers): string {
  const forwarded = source.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || source.get("x-real-ip")?.trim() || "unknown";
}

// true = permitido. Falha aberta: se o banco oscilar, registra e libera para não derrubar login/checkout.
export async function rateLimit(key: string, rule: RateRule): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: key.slice(0, 200),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    console.error("[rate-limit] falha ao verificar limite", key.split(":")[0], error);
    return true;
  }
}

export async function rateLimitByIp(scope: string, rule: RateRule, source?: Headers): Promise<boolean> {
  return rateLimit(`${scope}:ip:${clientIp(source ?? (await headers()))}`, rule);
}
