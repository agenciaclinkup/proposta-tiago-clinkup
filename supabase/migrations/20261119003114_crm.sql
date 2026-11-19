-- Fase 4.1 — CRM: funis, etapas, leads e histórico.
-- Integridade por FK composta: um lead só aponta para etapa do MESMO funil e da MESMA empresa;
-- uma atividade só aponta para lead da mesma empresa. O banco garante, não só a aplicação.

create type public.crm_stage_kind as enum ('open', 'won', 'lost');
create type public.crm_lead_source as enum ('manual', 'scraping', 'landing_page', 'hermes', 'webhook');
create type public.crm_activity_type as enum ('note', 'stage_change', 'meeting', 'message', 'ai_action');

create table public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index crm_pipelines_one_default on public.crm_pipelines (organization_id) where is_default;

create table public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null,
  organization_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null check (position >= 0),
  color text not null default '#00D4FF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  kind public.crm_stage_kind not null default 'open',
  created_at timestamptz not null default now(),
  foreign key (pipeline_id, organization_id) references public.crm_pipelines (id, organization_id) on delete cascade,
  unique (id, pipeline_id, organization_id)
);
create index crm_stages_pipeline_idx on public.crm_stages (pipeline_id, position);

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id uuid not null,
  stage_id uuid not null,
  -- Posição fracionária: mover um card altera só uma linha (renumeração rara, feita pelo service).
  position double precision not null,
  name text not null check (char_length(name) between 1 and 200),
  company text check (char_length(company) <= 200),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 40),
  whatsapp text check (char_length(whatsapp) <= 40),
  instagram text check (char_length(instagram) <= 100),
  website text check (char_length(website) <= 500),
  source public.crm_lead_source not null default 'manual',
  value numeric(14, 2) check (value >= 0),
  ai_score integer check (ai_score between 0 and 100),
  owner_id uuid references auth.users (id) on delete set null,
  scraped_lead_id uuid,
  next_meeting_at timestamptz,
  google_event_id text,
  notes text check (char_length(notes) <= 5000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (stage_id, pipeline_id, organization_id) references public.crm_stages (id, pipeline_id, organization_id),
  unique (id, organization_id)
);
create index crm_leads_board_idx on public.crm_leads (organization_id, stage_id, position);

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  lead_id uuid not null,
  type public.crm_activity_type not null,
  content text not null check (char_length(content) between 1 and 5000),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'manual' check (created_via in ('manual', 'hermes')),
  created_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.crm_leads (id, organization_id) on delete cascade
);
create index crm_activities_lead_idx on public.crm_activities (lead_id, created_at desc);

create trigger crm_leads_updated_at before update on public.crm_leads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Funil padrão: novas organizações (trigger) e organizações existentes (backfill abaixo)
-- ---------------------------------------------------------------------------

create function private.create_default_pipeline(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
begin
  insert into public.crm_pipelines (organization_id, name, is_default)
  values (p_organization_id, 'Funil de Vendas', true)
  returning id into v_pipeline;

  insert into public.crm_stages (pipeline_id, organization_id, name, position, color, kind) values
    (v_pipeline, p_organization_id, 'Novo Lead', 0, '#00D4FF', 'open'),
    (v_pipeline, p_organization_id, 'Qualificado por IA', 1, '#7C9CFF', 'open'),
    (v_pipeline, p_organization_id, 'Reunião Agendada', 2, '#2563EB', 'open'),
    (v_pipeline, p_organization_id, 'Proposta Enviada', 3, '#F59E0B', 'open'),
    (v_pipeline, p_organization_id, 'Fechado', 4, '#22C55E', 'won');
end;
$$;

revoke all on function private.create_default_pipeline(uuid) from public, anon, authenticated;

create or replace function private.handle_new_organization()
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

  perform private.create_default_pipeline(new.id);

  return new;
end;
$$;

select private.create_default_pipeline(o.id)
from public.organizations o
where not exists (select 1 from public.crm_pipelines p where p.organization_id = o.id);

-- ---------------------------------------------------------------------------
-- Grants + RLS: membros operam leads e histórico; só owner/admin mudam funis/etapas e excluem leads
-- ---------------------------------------------------------------------------

alter table public.crm_pipelines enable row level security;
alter table public.crm_stages enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_activities enable row level security;

revoke all on public.crm_pipelines, public.crm_stages, public.crm_leads, public.crm_activities from anon, authenticated;
grant select, insert, update, delete on public.crm_pipelines, public.crm_stages, public.crm_leads to authenticated;
-- Histórico é só de inclusão: sem update/delete para usuários (some junto com o lead).
grant select, insert on public.crm_activities to authenticated;

create policy "members read pipelines" on public.crm_pipelines for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "admins manage pipelines" on public.crm_pipelines for all to authenticated
  using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

create policy "members read stages" on public.crm_stages for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "admins manage stages" on public.crm_stages for all to authenticated
  using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

create policy "members read leads" on public.crm_leads for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "members create leads" on public.crm_leads for insert to authenticated
  with check ((select private.is_org_member(organization_id)) and created_by = (select auth.uid()));
create policy "members update leads" on public.crm_leads for update to authenticated
  using ((select private.is_org_member(organization_id)))
  with check ((select private.is_org_member(organization_id)));
create policy "admins delete leads" on public.crm_leads for delete to authenticated
  using ((select private.is_org_admin(organization_id)));

create policy "members read activities" on public.crm_activities for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "members add activities" on public.crm_activities for insert to authenticated
  with check ((select private.is_org_member(organization_id)) and created_by = (select auth.uid()));
