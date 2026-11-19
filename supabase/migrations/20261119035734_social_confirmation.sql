-- As autorizações são privadas; apenas o servidor autenticado pode criá-las ou consumi-las.
create table public.social_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('web', 'telegram')),
  conversation_id uuid,
  operation text not null check (operation in ('weekly', 'publish_now')),
  proof_hash text not null unique check (length(proof_hash) = 64),
  payload jsonb not null,
  integration_snapshot jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.social_confirmations enable row level security;
revoke all on public.social_confirmations from public, anon, authenticated;

-- Registrar a conta externa, não apenas o ID interno, evita aprovar uma conta e enviar em outra após reconexão.
create function private.snapshot_social_confirmation() returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_ids uuid[];
begin
  if new.operation = 'weekly' then
    select array_agg(distinct (t->>'integration_id')::uuid) into v_ids
    from jsonb_array_elements(new.payload) p cross join lateral jsonb_array_elements(p->'targets') t;
  else
    select array_agg(distinct t.integration_id) into v_ids from public.social_post_targets t
      where t.post_id = (new.payload->>'postId')::uuid and t.organization_id = new.organization_id;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'social_integration_invalid'; end if;
  select coalesce(jsonb_object_agg(i.id::text, jsonb_build_object('provider', i.provider, 'account', i.external_account_id, 'status', i.status)), '{}'::jsonb)
    into new.integration_snapshot from public.integrations i where i.organization_id = new.organization_id and i.id = any(v_ids);
  if (select count(*) from jsonb_object_keys(new.integration_snapshot)) <> array_length(v_ids, 1) then raise exception 'social_integration_invalid'; end if;
  return new;
end $$;
create trigger social_confirmation_snapshot before insert on public.social_confirmations for each row execute function private.snapshot_social_confirmation();

create function public.confirm_social_action(p_org uuid, p_user uuid, p_channel text, p_conversation uuid, p_hash text, p_limit integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_confirmation public.social_confirmations%rowtype;
  v_post public.social_posts%rowtype;
  v_item jsonb;
  v_posts jsonb := '[]'::jsonb;
  v_usage jsonb;
  v_lease uuid;
  v_snapshot jsonb;
begin
  if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_user) then raise exception 'social_forbidden'; end if;
  select * into v_confirmation from public.social_confirmations
    where organization_id = p_org and user_id = p_user and channel = p_channel
      and conversation_id is not distinct from p_conversation and proof_hash = p_hash for update;
  if not found or v_confirmation.consumed_at is not null or v_confirmation.expires_at <= now() then raise exception 'confirmation_invalid'; end if;
  select coalesce(jsonb_object_agg(i.id::text, jsonb_build_object('provider', i.provider, 'account', i.external_account_id, 'status', i.status)), '{}'::jsonb)
    into v_snapshot from public.integrations i where i.organization_id = p_org and i.id::text in (select jsonb_object_keys(v_confirmation.integration_snapshot));
  if v_snapshot <> v_confirmation.integration_snapshot then raise exception 'social_integration_invalid'; end if;
  if v_confirmation.operation = 'weekly' then
    if jsonb_typeof(v_confirmation.payload) <> 'array' or jsonb_array_length(v_confirmation.payload) not between 1 and 7 then raise exception 'confirmation_invalid'; end if;
    for v_item in select value from jsonb_array_elements(v_confirmation.payload) loop
      v_posts := v_posts || jsonb_build_array(public.save_social_post(p_org, p_user, null, 'hermes', 'scheduled', v_item, p_limit));
    end loop;
    update public.social_confirmations set consumed_at = now() where id = v_confirmation.id;
    return jsonb_build_object('operation', 'weekly', 'posts', v_posts);
  end if;

  select * into v_post from public.social_posts where id = (v_confirmation.payload->>'postId')::uuid and organization_id = p_org for update;
  if not found or v_post.status not in ('draft', 'scheduled') or v_post.updated_at <> (v_confirmation.payload->>'updatedAt')::timestamptz then raise exception 'confirmation_post_changed'; end if;
  if not exists (select 1 from public.social_post_targets where post_id = v_post.id and organization_id = p_org)
    or exists (select 1 from public.social_post_targets t left join public.integrations i on i.id = t.integration_id and i.organization_id = t.organization_id
      where t.post_id = v_post.id and (t.publish_state <> 'pending' or t.attempt_count <> 0 or i.status is distinct from 'connected')) then raise exception 'confirmation_post_changed'; end if;
  if v_post.status = 'draft' then
    v_usage := public.consume_usage(p_org, 'scheduled_posts', 1, p_limit);
    if not (v_usage->>'allowed')::boolean then raise exception 'social_limit_reached:%', v_usage->>'used'; end if;
  end if;
  v_lease := gen_random_uuid();
  update public.social_posts set status = 'publishing', scheduled_at = now(), lease_token = v_lease, lease_expires_at = now() + interval '10 minutes', error = null where id = v_post.id;
  update public.social_confirmations set consumed_at = now() where id = v_confirmation.id;
  return jsonb_build_object('operation', 'publish_now', 'postId', v_post.id, 'organizationId', p_org, 'leaseToken', v_lease, 'integrationSnapshot', v_confirmation.integration_snapshot);
end $$;
revoke all on function public.confirm_social_action(uuid,uuid,text,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.confirm_social_action(uuid,uuid,text,uuid,text,integer) to service_role;
