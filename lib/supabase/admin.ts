import "server-only";
import { createClient } from "@supabase/supabase-js";

// Ignora RLS. Usar só em webhooks verificados e rotinas internas.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
