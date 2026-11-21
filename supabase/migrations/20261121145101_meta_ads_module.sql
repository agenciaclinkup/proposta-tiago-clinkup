-- Fase 8.1 — Módulo Meta Ads: contas vinculadas, campanhas, conjuntos, anúncios,
-- snapshots de métricas, trilha de auditoria e confirmações financeiras persistentes.
-- Toda escrita sensível passa pelo servidor (service_role); membros da organização apenas leem via RLS.

create table public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null,
  provider public.integration_provider not null default 'meta_ads' check (provider = 'meta_ads'),
  external_ad_account_id text not null check (char_length(external_ad_account_id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 200),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  account_status integer not null default 1,
  business_id text check (business_id is null or char_length(business_id) <= 100),
  pixel_id text check (pixel_id is null or char_length(pixel_id) <= 100),
  -- Teto financeiro obrigatório: 0 bloqueia qualquer gasto pago até configuração explícita por admin/owner.
  daily_budget_cap_cents integer not null default 0 check (daily_budget_cap_cents between 0 and 100000000),
  monthly_budget_cap_cents integer not null default 0 check (monthly_budget_cap_cents between 0 and 1000000000),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (integration_id, organization_id, provider) references public.integrations(id, organization_id, provider) on delete cascade,
  unique (organization_id, integration_id),
  unique (organization_id, external_ad_account_id),
  unique (id, organization_id)
);
create index meta_ad_accounts_org_idx on public.meta_ad_accounts (organization_id, created_at desc);
create trigger meta_ad_accounts_updated_at before update on public.meta_ad_accounts
  for each row execute function private.set_updated_at();

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_account_id uuid not null,
  integration_id uuid not null,
  external_campaign_id text check (external_campaign_id is null or char_length(external_campaign_id) between 1 and 100),
  request_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  objective text not null check (objective in ('OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_AWARENESS', 'OUTCOME_SALES')),
  daily_budget_cents integer not null check (daily_budget_cents between 100 and 100000000),
  status text not null default 'paused' check (status in ('draft', 'paused', 'active', 'archived', 'error')),
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  creative jsonb not null default '{}'::jsonb check (jsonb_typeof(creative) = 'object'),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_via text not null check (created_via in ('manual', 'hermes', 'sync')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ad_account_id, organization_id) references public.meta_ad_accounts(id, organization_id) on delete cascade,
  unique (id, organization_id)
);
create unique index ad_campaigns_org_external_idx on public.ad_campaigns (organization_id, external_campaign_id) where external_campaign_id is not null;
create unique index ad_campaigns_org_request_idx on public.ad_campaigns (organization_id, request_id) where request_id is not null;
create index ad_campaigns_account_status_idx on public.ad_campaigns (ad_account_id, organization_id, status);
create trigger ad_campaigns_updated_at before update on public.ad_campaigns
  for each row execute function private.set_updated_at();

create table public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  external_ad_set_id text not null check (char_length(external_ad_set_id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'paused' check (status in ('paused', 'active', 'archived', 'error')),
  daily_budget_cents integer check (daily_budget_cents is null or daily_budget_cents between 100 and 100000000),
  targeting jsonb not null default '{}'::jsonb check (jsonb_typeof(targeting) = 'object'),
  optimization_goal text check (optimization_goal is null or char_length(optimization_goal) <= 100),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.ad_campaigns(id, organization_id) on delete cascade,
  unique (id, organization_id),
  unique (organization_id, external_ad_set_id)
);
create index ad_sets_campaign_idx on public.ad_sets (campaign_id, organization_id);
create trigger ad_sets_updated_at before update on public.ad_sets
  for each row execute function private.set_updated_at();

create table public.ad_ads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ad_set_id uuid not null,
  external_ad_id text not null check (char_length(external_ad_id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'paused' check (status in ('paused', 'active', 'archived', 'error')),
  creative jsonb not null default '{}'::jsonb check (jsonb_typeof(creative) = 'object'),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ad_set_id, organization_id) references public.ad_sets(id, organization_id) on delete cascade,
  unique (organization_id, external_ad_id)
);
create index ad_ads_set_idx on public.ad_ads (ad_set_id, organization_id);
create trigger ad_ads_updated_at before update on public.ad_ads
  for each row execute function private.set_updated_at();

create table public.ad_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  date_start date not null,
  date_stop date not null check (date_stop >= date_start),
  spend_cents integer not null default 0 check (spend_cents >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  leads integer not null default 0 check (leads >= 0),
  roas numeric(10, 4) not null default 0 check (roas >= 0),
  raw jsonb not null default '{}'::jsonb check (jsonb_typeof(raw) = 'object'),
  captured_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.ad_campaigns(id, organization_id) on delete cascade,
  unique (campaign_id, date_start, date_stop)
);
create index ad_metric_snapshots_org_date_idx on public.ad_metric_snapshots (organization_id, date_start desc);

create table public.ad_action_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_account_id uuid not null,
  campaign_id uuid,
  action text not null check (action in ('update_caps', 'sync', 'create_campaign', 'activate_campaign', 'pause_campaign', 'update_budget')),
  actor_id uuid references auth.users(id) on delete set null,
  via text not null check (via in ('manual', 'hermes', 'system')),
  request_id uuid,
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb check (jsonb_typeof(after_state) = 'object'),
  status text not null check (status in ('succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  foreign key (ad_account_id, organization_id) references public.meta_ad_accounts(id, organization_id) on delete cascade,
  foreign key (campaign_id, organization_id) references public.ad_campaigns(id, organization_id) on delete set null (campaign_id)
);
create index ad_action_logs_org_created_idx on public.ad_action_logs (organization_id, created_at desc);

-- Confirmações persistentes de uso único para ações com impacto financeiro em Meta Ads (tabela privada).
create table public.ad_action_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('web', 'telegram')),
  conversation_id uuid,
  ad_account_id uuid not null,
  campaign_id uuid,
  operation text not null check (operation in ('create_campaign', 'activate_campaign', 'update_budget')),
  proof_hash text not null unique check (length(proof_hash) = 64),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (ad_account_id, organization_id) references public.meta_ad_accounts(id, organization_id) on delete cascade,
  foreign key (campaign_id, organization_id) references public.ad_campaigns(id, organization_id) on delete cascade
);
create index ad_action_confirmations_org_idx on public.ad_action_confirmations (organization_id, created_at desc);

alter table public.meta_ad_accounts enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_sets enable row level security;
alter table public.ad_ads enable row level security;
alter table public.ad_metric_snapshots enable row level security;
alter table public.ad_action_logs enable row level security;
alter table public.ad_action_confirmations enable row level security;

revoke all on public.meta_ad_accounts, public.ad_campaigns, public.ad_sets, public.ad_ads, public.ad_metric_snapshots, public.ad_action_logs, public.ad_action_confirmations from public, anon, authenticated;
grant select on public.meta_ad_accounts, public.ad_campaigns, public.ad_sets, public.ad_ads, public.ad_metric_snapshots, public.ad_action_logs to authenticated;

create policy "members read meta ad accounts" on public.meta_ad_accounts for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read ad campaigns" on public.ad_campaigns for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read ad sets" on public.ad_sets for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read ad ads" on public.ad_ads for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read ad metric snapshots" on public.ad_metric_snapshots for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read ad action logs" on public.ad_action_logs for select to authenticated using ((select private.is_org_member(organization_id)));

-- Valida e consome atomicamente uma confirmação financeira de Meta Ads, verificando papel admin/owner,
-- teto diário/mensal da conta e limite de campanhas ativas do plano.
create function public.consume_ad_action_confirmation(
  p_org uuid,
  p_user uuid,
  p_channel text,
  p_conversation uuid,
  p_hash text,
  p_max_active integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_conf public.ad_action_confirmations%rowtype;
  v_account public.meta_ad_accounts%rowtype;
  v_campaign public.ad_campaigns%rowtype;
  v_active_count integer := 0;
  v_active_daily bigint := 0;
  v_target_daily bigint := 0;
  v_projected_daily bigint := 0;
  v_will_be_active boolean := false;
begin
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = p_user and role in ('owner', 'admin')
  ) then
    raise exception 'ads_forbidden';
  end if;

  select * into v_conf
  from public.ad_action_confirmations
  where organization_id = p_org
    and user_id = p_user
    and channel = p_channel
    and conversation_id is not distinct from p_conversation
    and proof_hash = p_hash
  for update;

  if not found or v_conf.consumed_at is not null or v_conf.expires_at <= now() then
    raise exception 'confirmation_invalid';
  end if;

  select * into v_account
  from public.meta_ad_accounts
  where id = v_conf.ad_account_id and organization_id = p_org
  for update;

  if not found then
    raise exception 'ads_account_not_found';
  end if;
  if v_account.daily_budget_cap_cents <= 0 then
    raise exception 'ads_cap_not_configured';
  end if;

  select count(*), coalesce(sum(daily_budget_cents), 0)
  into v_active_count, v_active_daily
  from public.ad_campaigns
  where organization_id = p_org
    and ad_account_id = v_account.id
    and status = 'active'
    and (v_conf.campaign_id is null or id <> v_conf.campaign_id);

  if v_conf.operation = 'create_campaign' then
    v_target_daily := coalesce((v_conf.payload->>'dailyBudgetCents')::bigint, 0);
    v_will_be_active := coalesce(v_conf.payload->>'initialStatus', 'paused') = 'active';
    if v_target_daily < 100 or v_target_daily > v_account.daily_budget_cap_cents then
      raise exception 'ads_daily_cap_exceeded';
    end if;
    if v_will_be_active then
      if v_active_count >= p_max_active then
        raise exception 'ads_plan_limit';
      end if;
      v_projected_daily := v_active_daily + v_target_daily;
    else
      v_projected_daily := v_target_daily;
    end if;
  elsif v_conf.operation = 'activate_campaign' then
    select * into v_campaign
    from public.ad_campaigns
    where id = v_conf.campaign_id and organization_id = p_org and ad_account_id = v_account.id
    for update;
    if not found then
      raise exception 'ads_campaign_not_found';
    end if;
    if v_active_count >= p_max_active then
      raise exception 'ads_plan_limit';
    end if;
    v_projected_daily := v_active_daily + v_campaign.daily_budget_cents;
  elsif v_conf.operation = 'update_budget' then
    select * into v_campaign
    from public.ad_campaigns
    where id = v_conf.campaign_id and organization_id = p_org and ad_account_id = v_account.id
    for update;
    if not found then
      raise exception 'ads_campaign_not_found';
    end if;
    v_target_daily := coalesce((v_conf.payload->>'dailyBudgetCents')::bigint, 0);
    if v_target_daily < 100 or v_target_daily > v_account.daily_budget_cap_cents then
      raise exception 'ads_daily_cap_exceeded';
    end if;
    v_projected_daily := case when v_campaign.status = 'active' then v_active_daily + v_target_daily else v_target_daily end;
  end if;

  if v_projected_daily > v_account.daily_budget_cap_cents then
    raise exception 'ads_daily_cap_exceeded';
  end if;
  if v_account.monthly_budget_cap_cents > 0 and (v_projected_daily * 30) > v_account.monthly_budget_cap_cents then
    raise exception 'ads_monthly_cap_exceeded';
  end if;

  update public.ad_action_confirmations set consumed_at = now() where id = v_conf.id;

  return jsonb_build_object(
    'operation', v_conf.operation,
    'adAccountId', v_account.id,
    'integrationId', v_account.integration_id,
    'externalAdAccountId', v_account.external_ad_account_id,
    'campaignId', v_conf.campaign_id,
    'payload', v_conf.payload
  );
end $$;

revoke all on function public.consume_ad_action_confirmation(uuid, uuid, text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_ad_action_confirmation(uuid, uuid, text, uuid, text, integer) to service_role;
