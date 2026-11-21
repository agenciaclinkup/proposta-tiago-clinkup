-- Autorização persistente de uso único para transferir resultados de prospecção ao CRM pelo Hermes.
create table public.prospect_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('web', 'telegram')),
  conversation_id uuid,
  proof_hash text not null unique check (length(proof_hash) = 64),
  pipeline_id uuid not null,
  stage_id uuid not null,
  prospect_ids uuid[] not null check (coalesce(array_length(prospect_ids, 1), 0) between 1 and 20),
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (stage_id, pipeline_id, organization_id) references public.crm_stages(id, pipeline_id, organization_id) on delete cascade
);
create index prospect_confirmations_org_idx on public.prospect_confirmations (organization_id, created_at desc);
alter table public.prospect_confirmations enable row level security;
revoke all on public.prospect_confirmations from public, anon, authenticated;

create function public.confirm_prospect_transfer(
  p_org uuid,
  p_user uuid,
  p_channel text,
  p_conversation uuid,
  p_hash text,
  p_limit integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_confirmation public.prospect_confirmations%rowtype;
  v_prospect_id uuid;
  v_lead jsonb;
  v_leads jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = p_user
  ) then
    raise exception 'prospect_forbidden';
  end if;

  select * into v_confirmation
  from public.prospect_confirmations
  where organization_id = p_org
    and user_id = p_user
    and channel = p_channel
    and conversation_id is not distinct from p_conversation
    and proof_hash = p_hash
  for update;

  if not found or v_confirmation.consumed_at is not null or v_confirmation.expires_at <= now() then
    raise exception 'confirmation_invalid';
  end if;

  if not exists (
    select 1
    from public.crm_stages s
    join public.crm_pipelines p on p.id = s.pipeline_id and p.organization_id = s.organization_id
    where s.id = v_confirmation.stage_id
      and s.pipeline_id = v_confirmation.pipeline_id
      and s.organization_id = p_org
      and p.is_default
  ) then
    raise exception 'prospect_stage_invalid';
  end if;

  perform 1 from public.organizations where id = p_org for update;

  foreach v_prospect_id in array v_confirmation.prospect_ids loop
    v_lead := public.send_scraped_lead_to_crm(p_org, p_user, v_prospect_id, v_confirmation.stage_id, 'hermes', p_limit);
    v_leads := v_leads || jsonb_build_array(v_lead);
  end loop;

  update public.prospect_confirmations
  set consumed_at = now()
  where id = v_confirmation.id;

  return jsonb_build_object(
    'stageId', v_confirmation.stage_id,
    'transferredCount', jsonb_array_length(v_leads),
    'leads', v_leads
  );
end $$;

revoke all on function public.confirm_prospect_transfer(uuid, uuid, text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_prospect_transfer(uuid, uuid, text, uuid, text, integer) to service_role;
