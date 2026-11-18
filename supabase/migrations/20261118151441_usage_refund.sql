-- Fase 2.4 — Estorno de consumo (ex.: resposta do Hermes falhou depois de cobrar o crédito).
-- Mesmo período de `consume_usage`; nunca fica abaixo de zero. Execute só service_role.

create function public.refund_usage(p_organization_id uuid, p_metric text, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_amount < 1 then
    raise exception 'invalid usage arguments';
  end if;

  update public.usage_counters u
  set used = greatest(u.used - p_amount, 0), updated_at = now()
  where u.organization_id = p_organization_id
    and u.metric = p_metric
    and u.period_start = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
  returning u.used into v_used;

  return coalesce(v_used, 0);
end;
$$;

revoke all on function public.refund_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.refund_usage(uuid, text, integer) to service_role;
