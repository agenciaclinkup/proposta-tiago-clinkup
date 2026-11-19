-- Retries somente para falhas provadas anteriores ao envio público; sem repetir respostas inconclusivas.
alter table public.social_posts add column retry_after timestamptz;
alter table public.social_post_targets add column attempt_count integer not null default 0 check (attempt_count between 0 and 3), add column next_attempt_at timestamptz, add column retry_confirmed_by uuid references auth.users(id) on delete set null, add column retry_confirmed_at timestamptz;
-- Conservador para registros da versão anterior: já podem ter passado por uma tentativa.
update public.social_post_targets set attempt_count = 1 where publish_state in ('dispatching', 'published', 'failed', 'uncertain');
alter table public.social_post_targets drop constraint social_post_targets_publish_state_check;
alter table public.social_post_targets add constraint social_post_targets_publish_state_check check (publish_state in ('pending', 'dispatching', 'retry_wait', 'published', 'failed', 'uncertain'));

-- Depois da primeira tentativa, não permitir que edição substitua destinos publicados ou em retry.
alter function public.save_social_post(uuid,uuid,uuid,text,text,jsonb,integer) rename to save_social_post_unchecked;
create function public.save_social_post(p_organization_id uuid, p_user_id uuid, p_post_id uuid, p_via text, p_status text, p_payload jsonb, p_limit integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_post_id is not null then
    perform 1 from public.social_posts p where p.id = p_post_id and p.organization_id = p_organization_id for update;
    if exists (select 1 from public.social_post_targets t where t.post_id = p_post_id and t.organization_id = p_organization_id and t.attempt_count > 0) then raise exception 'social_state_invalid'; end if;
  end if;
  return public.save_social_post_unchecked(p_organization_id, p_user_id, p_post_id, p_via, p_status, p_payload, p_limit);
end $$;

-- Repetição manual exige conferência explícita no canal, vínculo atual e ausência de ID externo.
create function public.request_social_retry(p_org uuid, p_user uuid, p_post uuid, p_integration uuid, p_confirmed boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_next timestamptz;
begin
  if p_confirmed is distinct from true then raise exception 'retry_confirmation_required'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_user) then raise exception 'social_forbidden'; end if;
  perform 1 from public.social_posts p where p.id = p_post and p.organization_id = p_org and p.status = 'failed' for update;
  if not found then raise exception 'retry_state_invalid'; end if;
  update public.social_post_targets t set publish_state = 'retry_wait',
    next_attempt_at = now() + make_interval(secs => 60 * (1 << greatest(t.attempt_count - 1, 0))),
    publish_error = 'Nova tentativa solicitada após conferência no canal.', retry_confirmed_by = p_user, retry_confirmed_at = now()
  where t.post_id = p_post and t.organization_id = p_org and t.integration_id = p_integration and t.publish_state in ('failed', 'uncertain') and t.external_id is null and t.attempt_count < 3
  returning t.next_attempt_at into v_next;
  if not found then raise exception 'retry_target_invalid'; end if;
  update public.social_posts p set status = 'scheduled', retry_after = v_next, error = 'Nova tentativa solicitada após conferência no canal.' where p.id = p_post and p.organization_id = p_org;
  return true;
end $$;
revoke all on function public.request_social_retry(uuid,uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.request_social_retry(uuid,uuid,uuid,uuid,boolean) to service_role;
revoke all on function public.save_social_post(uuid,uuid,uuid,text,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.save_social_post(uuid,uuid,uuid,text,text,jsonb,integer) to service_role;

create or replace function public.claim_social_posts(p_limit integer) returns table (id uuid, organization_id uuid, lease_token uuid)
language plpgsql security invoker set search_path = '' as $$
begin
  if p_limit < 1 or p_limit > 10 then raise exception 'invalid batch'; end if;
  with expired as (select p.id from public.social_posts p where p.status = 'publishing' and p.lease_expires_at < now() for update skip locked),
  targets as (update public.social_post_targets t set publish_state = 'uncertain', publish_error = 'Publicação interrompida. Confira o canal antes de tentar novamente.', finished_at = now() where t.post_id in (select e.id from expired e) and t.publish_state in ('pending', 'dispatching', 'retry_wait') returning t.post_id)
  update public.social_posts p set status = 'failed', error = 'Publicação interrompida. Confira os canais antes de tentar novamente.', lease_token = null, lease_expires_at = null, retry_after = null where p.id in (select e.id from expired e);
  return query with selected as (
    select p.id from public.social_posts p where p.status = 'scheduled' and p.scheduled_at <= now() and (p.retry_after is null or p.retry_after <= now()) order by p.scheduled_at, p.id for update skip locked limit p_limit
  ), claimed as (
    update public.social_posts p set status = 'publishing', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes', retry_after = null, error = null from selected s where p.id = s.id returning p.id, p.organization_id, p.lease_token
  ), wake as (
    update public.social_post_targets t set publish_state = 'pending', next_attempt_at = null from claimed c where t.post_id = c.id and t.organization_id = c.organization_id and t.publish_state = 'retry_wait' and t.next_attempt_at <= now() returning t.post_id
  ) select c.id, c.organization_id, c.lease_token from claimed c;
end $$;

create or replace function public.start_social_target(p_post uuid, p_org uuid, p_integration uuid, p_lease uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.social_posts p where p.id = p_post and p.organization_id = p_org and p.status = 'publishing' and p.lease_token = p_lease and p.lease_expires_at > now() for update;
  if not found then raise exception 'invalid lease'; end if;
  update public.social_post_targets t set publish_state = 'dispatching', attempt_count = attempt_count + 1 where t.post_id = p_post and t.organization_id = p_org and t.integration_id = p_integration and t.publish_state = 'pending' and t.attempt_count < 3;
  if not found then raise exception 'target already started'; end if;
  return true;
end $$;

create or replace function public.finish_social_target(p_post uuid, p_org uuid, p_integration uuid, p_lease uuid, p_result text, p_external_id text, p_error text) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if p_result not in ('published', 'failed', 'uncertain', 'retry') or (p_result = 'published' and coalesce(p_external_id, '') = '') or (p_result = 'retry' and p_external_id is not null) then raise exception 'invalid result'; end if;
  perform 1 from public.social_posts p where p.id = p_post and p.organization_id = p_org and p.status = 'publishing' and p.lease_token = p_lease and p.lease_expires_at > now() for update;
  if not found then raise exception 'invalid lease'; end if;
  update public.social_post_targets t set
    publish_state = case when p_result = 'retry' and t.attempt_count < 3 then 'retry_wait' when p_result = 'retry' then 'failed' else p_result end,
    next_attempt_at = case when p_result = 'retry' and t.attempt_count < 3 then now() + make_interval(secs => 60 * (1 << (t.attempt_count - 1))) else null end,
    external_id = p_external_id,
    publish_error = case when p_result = 'retry' and t.attempt_count >= 3 then 'As tentativas seguras se esgotaram. Confira a conexão e os dados antes de tentar novamente.' else p_error end,
    finished_at = now()
  where t.post_id = p_post and t.organization_id = p_org and t.integration_id = p_integration and t.publish_state = 'dispatching';
  if not found then raise exception 'target not dispatching'; end if;
  if not exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.organization_id = p_org and t.publish_state in ('pending', 'dispatching')) then
    update public.social_posts p set
      status = case when exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state = 'retry_wait') then 'scheduled'::public.social_post_status when exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state <> 'published') then 'failed'::public.social_post_status else 'published'::public.social_post_status end,
      retry_after = (select min(t.next_attempt_at) from public.social_post_targets t where t.post_id = p_post and t.publish_state = 'retry_wait'),
      error = case when exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state = 'retry_wait') then 'Uma falha temporária será tentada novamente.' when exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state <> 'published') then 'Um ou mais canais não foram confirmados. Confira os detalhes antes de tentar novamente.' else null end,
      published_at = case when not exists (select 1 from public.social_post_targets t where t.post_id = p_post and t.publish_state <> 'published') then now() else null end,
      external_ids = coalesce((select jsonb_object_agg(t.channel, t.external_id) from public.social_post_targets t where t.post_id = p_post and t.publish_state = 'published'), '{}'::jsonb), lease_token = null, lease_expires_at = null
    where p.id = p_post and p.organization_id = p_org;
  end if;
  return true;
end $$;
