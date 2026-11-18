-- Fase 2.1 — Auditoria do Agente Hermes e consumo mensal por plano.
-- Escrita só pelo servidor (service_role): usuário não forja log nem zera consumo.

create type public.hermes_channel as enum ('web', 'telegram', 'webhook', 'system');
create type public.hermes_log_status as enum ('success', 'error');

create table public.hermes_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  channel public.hermes_channel not null,
  via text not null default 'hermes' check (via in ('manual', 'hermes')),
  tool_name text not null check (char_length(tool_name) <= 100),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status public.hermes_log_status not null,
  error text,
  duration_ms integer check (duration_ms >= 0),
  created_at timestamptz not null default now()
);
create index hermes_logs_org_created_idx on public.hermes_logs (organization_id, created_at desc);

create table public.usage_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  metric text not null check (metric in ('ai_credits', 'scraped_leads', 'scheduled_posts')),
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, metric, period_start)
);

alter table public.hermes_logs enable row level security;
alter table public.usage_counters enable row level security;

revoke all on public.hermes_logs, public.usage_counters from anon, authenticated;
grant select on public.hermes_logs, public.usage_counters to authenticated;

create policy "members read hermes logs" on public.hermes_logs
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "members read usage" on public.usage_counters
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- Consome `p_amount` da métrica no mês corrente (fuso de Brasília) se couber em `p_limit`.
-- Atômico sob concorrência: o UPDATE condicional só incrementa se o total não ultrapassar o limite.
create function public.consume_usage(p_organization_id uuid, p_metric text, p_amount integer, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  v_used integer;
begin
  if p_amount < 1 or p_limit < 0 then
    raise exception 'invalid usage arguments';
  end if;

  if p_amount <= p_limit then
    insert into public.usage_counters as u (organization_id, metric, period_start, used)
    values (p_organization_id, p_metric, v_period, p_amount)
    on conflict (organization_id, metric, period_start)
      do update set used = u.used + excluded.used, updated_at = now()
      where u.used + excluded.used <= p_limit
    returning u.used into v_used;

    if v_used is not null then
      return jsonb_build_object('allowed', true, 'used', v_used);
    end if;
  end if;

  select u.used into v_used
  from public.usage_counters u
  where u.organization_id = p_organization_id and u.metric = p_metric and u.period_start = v_period;

  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0));
end;
$$;

revoke all on function public.consume_usage(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, text, integer, integer) to service_role;
