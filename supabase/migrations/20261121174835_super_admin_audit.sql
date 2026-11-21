-- Fase 9.2 — Trilha de auditoria imutável do Super-Admin e bônus de créditos mensais.
-- Acesso exclusivo via service_role; usuários autenticados/anônimos não leem nem alteram auditoria.

alter table public.usage_counters
  add column if not exists bonus integer not null default 0 check (bonus >= 0);

-- Atualiza consume_usage para considerar bônus concedidos pelo Super-Admin no mês vigente (Brasília).
create or replace function public.consume_usage(p_organization_id uuid, p_metric text, p_amount integer, p_limit integer)
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

  if exists (
    select 1 from public.usage_counters u
    where u.organization_id = p_organization_id and u.metric = p_metric and u.period_start = v_period
  ) then
    update public.usage_counters u
    set used = u.used + p_amount, updated_at = now()
    where u.organization_id = p_organization_id
      and u.metric = p_metric
      and u.period_start = v_period
      and u.used + p_amount <= (p_limit + u.bonus)
    returning u.used into v_used;

    if v_used is not null then
      return jsonb_build_object('allowed', true, 'used', v_used);
    end if;
  elsif p_amount <= p_limit then
    insert into public.usage_counters as u (organization_id, metric, period_start, used)
    values (p_organization_id, p_metric, v_period, p_amount)
    on conflict (organization_id, metric, period_start)
      do update set used = u.used + excluded.used, updated_at = now()
      where u.used + excluded.used <= (p_limit + u.bonus)
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

-- Concede ou ajusta bônus mensal de créditos (ex.: ai_credits) para suporte/cortesia. Nunca abaixo de zero.
create function public.grant_usage_bonus(p_organization_id uuid, p_metric text, p_delta integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  v_used integer;
  v_bonus integer;
begin
  if p_metric not in ('ai_credits', 'scraped_leads', 'scheduled_posts') or p_delta = 0 or p_delta < -1000000 or p_delta > 1000000 then
    raise exception 'invalid_bonus_arguments';
  end if;

  insert into public.usage_counters as u (organization_id, metric, period_start, used, bonus)
  values (p_organization_id, p_metric, v_period, 0, greatest(0, p_delta))
  on conflict (organization_id, metric, period_start)
    do update set bonus = greatest(0, u.bonus + p_delta), updated_at = now()
  returning u.used, u.bonus into v_used, v_bonus;

  return jsonb_build_object('used', v_used, 'bonus', v_bonus);
end;
$$;

revoke all on function public.grant_usage_bonus(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.grant_usage_bonus(uuid, text, integer) to service_role;

-- Trilha de auditoria imutável de ações do Super-Admin (append-only, privada).
create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  actor_email text not null check (char_length(actor_email) between 3 and 320),
  target_organization_id uuid references public.organizations(id) on delete set null,
  action text not null check (action in ('update_subscription', 'toggle_white_label', 'adjust_ai_credits')),
  reason text not null check (char_length(reason) between 3 and 500),
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb check (jsonb_typeof(after_state) = 'object'),
  created_at timestamptz not null default now()
);
create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index admin_audit_logs_target_idx on public.admin_audit_logs (target_organization_id, created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from public, anon, authenticated;

create function private.prevent_admin_audit_mutation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'admin_audit_immutable';
end $$;

create trigger admin_audit_logs_immutable
  before update or delete on public.admin_audit_logs
  for each row execute function private.prevent_admin_audit_mutation();
