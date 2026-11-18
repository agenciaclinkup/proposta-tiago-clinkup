-- Fase 3.1 — Integrações, cofre de credenciais e códigos de vínculo do Telegram.
-- Conexões são gravadas só pelo servidor (callbacks OAuth/webhooks); usuário lê, admin desconecta.
-- Tokens ficam em integration_secrets, cifrados por lib/vault.ts e invisíveis para anon/authenticated.

create type public.integration_provider as enum (
  'instagram', 'facebook_page', 'meta_ads', 'google_business', 'google_calendar', 'telegram'
);
create type public.integration_status as enum ('connected', 'needs_attention', 'disconnected');

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'connected',
  external_account_id text not null check (char_length(external_account_id) between 1 and 200),
  display_name text check (char_length(display_name) <= 200),
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_account_id)
);

create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Defesa em profundidade: o banco recusa qualquer valor fora do formato do cofre (nunca token em texto puro).
  access_token_encrypted text not null check (access_token_encrypted ~ '^v1:[A-Za-z0-9_-]*:[A-Za-z0-9_-]*:[A-Za-z0-9_-]*$'),
  refresh_token_encrypted text check (refresh_token_encrypted ~ '^v1:[A-Za-z0-9_-]*:[A-Za-z0-9_-]*:[A-Za-z0-9_-]*$'),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.telegram_link_codes (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create trigger integrations_updated_at before update on public.integrations
  for each row execute function private.set_updated_at();
create trigger integration_secrets_updated_at before update on public.integration_secrets
  for each row execute function private.set_updated_at();

alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.telegram_link_codes enable row level security;

revoke all on public.integrations, public.integration_secrets, public.telegram_link_codes from anon, authenticated;
grant select, delete on public.integrations to authenticated;
grant select on public.telegram_link_codes to authenticated;
-- integration_secrets: nenhum grant para anon/authenticated (só service_role).

create policy "members read integrations" on public.integrations
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "admins disconnect integrations" on public.integrations
  for delete to authenticated
  using ((select private.is_org_admin(organization_id)));

create policy "users read own link codes" on public.telegram_link_codes
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));

-- Consome um código válido (não usado e não expirado) de forma atômica. Chamado pelo webhook do Telegram.
create function public.consume_telegram_link_code(p_code text)
returns table (organization_id uuid, user_id uuid)
language sql
security definer
set search_path = ''
as $$
  update public.telegram_link_codes c
  set used_at = now()
  where c.code = upper(p_code) and c.used_at is null and c.expires_at > now()
  returning c.organization_id, c.user_id;
$$;

revoke all on function public.consume_telegram_link_code(text) from public, anon, authenticated;
grant execute on function public.consume_telegram_link_code(text) to service_role;
