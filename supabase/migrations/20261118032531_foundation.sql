-- Fase 1 — Fundação multi-tenant: organizações, membros, perfis, contexto da marca e assinaturas.
-- Helpers SECURITY DEFINER ficam em `private` (schema não exposto pela Data API).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create type public.member_role as enum ('owner', 'admin', 'member');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete');

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,64}$'),
  niche text,
  plan_id text not null default 'starter' check (plan_id in ('starter', 'growth', 'scale')),
  is_white_label boolean not null default false,
  onboarding_completed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members (user_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  current_organization_id uuid references public.organizations (id) on delete set null,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.brand_context (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  company_name text not null,
  niche text not null,
  products_services text not null,
  average_ticket numeric(12, 2),
  target_audience text not null,
  differentiators text not null,
  tone_of_voice text not null,
  visual_identity jsonb not null default '{}'::jsonb,
  master_context text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan_id text not null default 'starter' check (plan_id in ('starter', 'growth', 'scale')),
  status public.subscription_status not null default 'trialing',
  provider text not null default 'manual' check (provider in ('stripe', 'asaas', 'manual')),
  provider_customer_id text,
  provider_subscription_id text unique,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers de autorização
-- ---------------------------------------------------------------------------

create function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = (select auth.uid())
  );
$$;

create function private.is_org_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_org_member(uuid), private.is_org_admin(uuid) from public, anon;
grant execute on function private.is_org_member(uuid), private.is_org_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger brand_context_updated_at before update on public.brand_context
  for each row execute function private.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- Perfil criado junto com o usuário. full_name vem de user_metadata: só exibição, nunca autorização.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Quem cria a organização vira owner e ganha trial Starter de 14 dias.
create function private.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
  values (new.id, 'starter', 'trialing', now() + interval '14 days');

  return new;
end;
$$;

create trigger on_organization_created after insert on public.organizations
  for each row execute function private.handle_new_organization();

revoke all on function private.set_updated_at(), private.handle_new_user(), private.handle_new_organization() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants (tabelas novas não são expostas automaticamente) + RLS
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.profiles enable row level security;
alter table public.brand_context enable row level security;
alter table public.subscriptions enable row level security;

revoke all on public.organizations, public.organization_members, public.profiles,
  public.brand_context, public.subscriptions from anon, authenticated;

-- plan_id e is_white_label só mudam via service role (billing/admin).
grant select on public.organizations to authenticated;
grant insert (id, name, slug, niche) on public.organizations to authenticated;
grant update (name, slug, niche, onboarding_completed_at) on public.organizations to authenticated;

grant select on public.organization_members to authenticated;

-- is_super_admin nunca é gravável pelo próprio usuário.
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, current_organization_id) on public.profiles to authenticated;

grant select, insert, update on public.brand_context to authenticated;

grant select on public.subscriptions to authenticated;

create policy "members read organization" on public.organizations
  for select to authenticated
  using ((select private.is_org_member(id)) or created_by = (select auth.uid()));

create policy "users create own organization" on public.organizations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "admins update organization" on public.organizations
  for update to authenticated
  using ((select private.is_org_admin(id)))
  with check ((select private.is_org_admin(id)));

create policy "members read memberships" on public.organization_members
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "users read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "users update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (current_organization_id is null or (select private.is_org_member(current_organization_id)))
  );

create policy "members read brand context" on public.brand_context
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "admins create brand context" on public.brand_context
  for insert to authenticated
  with check ((select private.is_org_admin(organization_id)));

create policy "admins update brand context" on public.brand_context
  for update to authenticated
  using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

create policy "members read subscription" on public.subscriptions
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
