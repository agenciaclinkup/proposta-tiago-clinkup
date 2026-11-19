alter table public.social_posts add column lease_token uuid, add column lease_expires_at timestamptz;
alter table public.social_post_targets add column publish_state text not null default 'pending' check (publish_state in ('pending', 'dispatching', 'published', 'failed', 'uncertain')),
  add column external_id text, add column publish_error text, add column finished_at timestamptz, add column reconciled_at timestamptz;
create index social_targets_reconcile_idx on public.social_post_targets (reconciled_at nulls first) where publish_state = 'uncertain' and external_id is not null;

-- Expired jobs are never retried automatically: an external API may have accepted the request.
create function public.claim_social_posts(p_limit integer) returns table (id uuid, organization_id uuid, lease_token uuid)
language plpgsql security invoker set search_path = '' as $$
begin
  if p_limit < 1 or p_limit > 10 then raise exception 'invalid batch'; end if;
  with expired as (
    select p.id from public.social_posts p where p.status = 'publishing' and p.lease_expires_at < now() for update skip locked
  ), targets as (
    update public.social_post_targets t set publish_state = 'uncertain', publish_error = 'Publicação interrompida. Confira o canal antes de tentar novamente.', finished_at = now()
    where t.post_id in (select e.id from expired e) and t.publish_state in ('pending', 'dispatching') returning t.post_id
  )
  update public.social_posts p set status = 'failed', error = 'Publicação interrompida. Confira os canais antes de tentar novamente.', lease_token = null, lease_expires_at = null
  where p.id in (select e.id from expired e);
  return query with selected as (
    select p.id from public.social_posts p where p.status = 'scheduled' and p.scheduled_at <= now() order by p.scheduled_at, p.id for update skip locked limit p_limit
  ) update public.social_posts p set status = 'publishing', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes', error = null
  from selected s where p.id = s.id returning p.id, p.organization_id, p.lease_token;
end $$;

create function public.start_social_target(p_post uuid, p_org uuid, p_integration uuid, p_lease uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.social_posts p where p.id = p_post and p.organization_id = p_org and p.status = 'publishing' and p.lease_token = p_lease and p.lease_expires_at > now() for update;
  if not found then raise exception 'invalid lease'; end if;
  update public.social_post_targets t set publish_state = 'dispatching' where t.post_id = p_post and t.organization_id = p_org and t.integration_id = p_integration and t.publish_state = 'pending';
  if not found then raise exception 'target already started'; end if;
  return true;
end $$;

create function public.finish_social_target(p_post uuid, p_org uuid, p_integration uuid, p_lease uuid, p_result text, p_external_id text, p_error text) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if p_result not in ('published', 'failed', 'uncertain') or (p_result = 'published' and coalesce(p_external_id, '') = '') then raise exception 'invalid result'; end if;
  perform 1 from public.social_posts p where p.id = p_post and p.organization_id = p_org and p.status = 'publishing' and p.lease_token = p_lease and p.lease_expires_at > now() for update;
  if not found then raise exception 'invalid lease'; end if;
  update public.social_post_targets t set publish_state = p_result, external_id = p_external_id, publish_error = p_error, finished_at = now()
  where t.post_id = p_post and t.organization_id = p_org and t.integration_id = p_integration and t.publish_state = 'dispatching';
  if not found then raise exception 'target not dispatching'; end if;
  if not exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.organization_id = p_org and t.publish_state in ('pending', 'dispatching')) then
    update public.social_posts p set status = case when exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state <> 'published') then 'failed'::public.social_post_status else 'published'::public.social_post_status end,
      error = case when exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state <> 'published') then 'Um ou mais canais não foram confirmados. Confira os detalhes antes de tentar novamente.' else null end,
      published_at = case when not exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state <> 'published') then now() else null end,
      external_ids = coalesce((select jsonb_object_agg(t.channel, t.external_id) from public.social_post_targets t where t.post_id = p_post and t.publish_state = 'published'), '{}'::jsonb), lease_token = null, lease_expires_at = null
    where p.id = p_post and p.organization_id = p_org;
  end if;
  return true;
end $$;
revoke all on function public.claim_social_posts(integer), public.start_social_target(uuid,uuid,uuid,uuid), public.finish_social_target(uuid,uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_social_posts(integer), public.start_social_target(uuid,uuid,uuid,uuid), public.finish_social_target(uuid,uuid,uuid,uuid,text,text,text) to service_role;

-- Conciliação apenas consulta provedores: não cria nem reenvia publicação.
create function public.reconcile_social_target(p_post uuid, p_org uuid, p_integration uuid, p_external_id text, p_result text) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if p_result not in ('pending', 'published', 'failed') then raise exception 'invalid result'; end if;
  perform 1 from public.social_posts p where p.id = p_post and p.organization_id = p_org for update;
  if not found then return false; end if;
  update public.social_post_targets t set
    publish_state = case when p_result = 'pending' then t.publish_state else p_result end,
    publish_error = case when p_result = 'published' then null when p_result = 'failed' then 'O canal recusou a publicação após o processamento.' else t.publish_error end,
    reconciled_at = now(), finished_at = case when p_result = 'pending' then t.finished_at else now() end
  where t.post_id = p_post and t.organization_id = p_org and t.integration_id = p_integration and t.publish_state = 'uncertain' and t.external_id = p_external_id;
  if not found then return false; end if;
  if not exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state <> 'published') then
    update public.social_posts p set status = 'published', error = null, published_at = now(), external_ids = (select jsonb_object_agg(t.channel, t.external_id) from public.social_post_targets t where t.post_id = p_post)
    where p.id = p_post and p.organization_id = p_org and p.status = 'failed';
  end if;
  return true;
end $$;
revoke all on function public.reconcile_social_target(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.reconcile_social_target(uuid,uuid,uuid,text,text) to service_role;
