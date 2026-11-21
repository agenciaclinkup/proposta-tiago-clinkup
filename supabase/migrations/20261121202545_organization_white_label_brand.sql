-- Fase 9.4 — Identidade White-Label por organização com RLS estrito.
-- Membros leem a identidade da própria empresa; apenas owner/admin de org elegível (Scale ou is_white_label)
-- ou Super-Admin podem gravar/alterar.

create table public.organization_brands (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  logo_url text check (logo_url is null or logo_url ~ '^https?://'),
  favicon_url text check (favicon_url is null or favicon_url ~ '^https?://'),
  primary_color text not null check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  support_email text not null check (char_length(support_email) between 3 and 254),
  support_whatsapp text not null check (support_whatsapp ~ '^\+?[1-9][0-9]{9,14}$'),
  hide_clinkup boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organization_brands_updated_at before update on public.organization_brands
  for each row execute function private.set_updated_at();

create function private.can_manage_org_brand(p_org uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_super_admin = true
  ) or (
    private.is_org_admin(p_org)
    and exists (
      select 1 from public.organizations
      where id = p_org and (plan_id = 'scale' or is_white_label = true)
    )
  );
$$;

alter table public.organization_brands enable row level security;
revoke all on public.organization_brands from public, anon, authenticated;
grant select, insert, update on public.organization_brands to authenticated;

create policy "members read organization brand" on public.organization_brands
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "eligible admins insert organization brand" on public.organization_brands
  for insert to authenticated
  with check ((select private.can_manage_org_brand(organization_id)));

create policy "eligible admins update organization brand" on public.organization_brands
  for update to authenticated
  using ((select private.can_manage_org_brand(organization_id)))
  with check ((select private.can_manage_org_brand(organization_id)));
