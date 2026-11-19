-- Calendário: leituras por RLS; toda mutação passa pela operação transacional do servidor.
create type public.social_post_status as enum ('draft', 'scheduled', 'publishing', 'published', 'failed');
create type public.social_post_format as enum ('feed', 'reels', 'stories', 'carousel', 'gmb_update');

alter table public.integrations add constraint integrations_id_org_provider_unique unique (id, organization_id, provider);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  format public.social_post_format not null,
  caption text not null default '' check (char_length(caption) <= 10000),
  hashtags text[] not null default '{}',
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  scheduled_at timestamptz,
  status public.social_post_status not null default 'draft',
  published_at timestamptz,
  external_ids jsonb not null default '{}'::jsonb check (jsonb_typeof(external_ids) = 'object'),
  error text,
  carousel_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_via text not null check (created_via in ('manual', 'hermes')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (status <> 'scheduled' or scheduled_at is not null)
);
create index social_posts_org_date_idx on public.social_posts (organization_id, scheduled_at);
create index social_posts_queue_idx on public.social_posts (scheduled_at) where status = 'scheduled';
create trigger social_posts_updated_at before update on public.social_posts for each row execute function private.set_updated_at();

-- Um destino por canal; a FK composta vincula canal, integração e empresa, inclusive sob service_role.
create table public.social_post_targets (
  post_id uuid not null,
  organization_id uuid not null,
  channel text not null check (channel in ('instagram', 'facebook', 'google_business')),
  integration_id uuid not null,
  provider public.integration_provider not null,
  primary key (post_id, channel),
  foreign key (post_id, organization_id) references public.social_posts(id, organization_id) on delete cascade,
  foreign key (integration_id, organization_id, provider) references public.integrations(id, organization_id, provider) on delete restrict,
  check ((channel = 'instagram' and provider = 'instagram') or (channel = 'facebook' and provider = 'facebook_page') or (channel = 'google_business' and provider = 'google_business'))
);
create index social_post_targets_org_idx on public.social_post_targets (organization_id, post_id);
create index social_post_targets_integration_idx on public.social_post_targets (integration_id, organization_id, provider);
alter table public.social_posts enable row level security;
alter table public.social_post_targets enable row level security;
revoke all on public.social_posts, public.social_post_targets from anon, authenticated;
grant select on public.social_posts, public.social_post_targets to authenticated;
create policy "members read social posts" on public.social_posts for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read social targets" on public.social_post_targets for select to authenticated using ((select private.is_org_member(organization_id)));

-- O consumo é por agendamento efetuado no mês corrente em Brasília; edição de agendamento já ativo não cobra de novo.
-- Cancelar para rascunho não devolve consumo; agendar novamente consome uma nova unidade.
create function public.save_social_post(p_organization_id uuid, p_user_id uuid, p_post_id uuid, p_via text, p_status text, p_payload jsonb, p_limit integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
  v_previous public.social_post_status;
  v_usage jsonb;
  v_target jsonb;
  v_provider public.integration_provider;
  v_scheduled_at timestamptz;
begin
  if not exists (select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = p_user_id) then
    raise exception 'social_forbidden';
  end if;
  if p_via not in ('manual', 'hermes') or p_status not in ('draft', 'scheduled') or p_limit < 0 then raise exception 'social_invalid'; end if;
  if jsonb_typeof(p_payload->'targets') is distinct from 'array' or jsonb_array_length(p_payload->'targets') > 3 then raise exception 'social_targets_invalid'; end if;
  v_scheduled_at := nullif(p_payload->>'scheduled_at', '')::timestamptz;
  if p_status = 'scheduled' and (v_scheduled_at is null or v_scheduled_at <= now() or jsonb_array_length(p_payload->'targets') = 0) then raise exception 'social_schedule_invalid'; end if;
  if p_post_id is not null then
    select * into v_post from public.social_posts where id = p_post_id and organization_id = p_organization_id for update;
    if not found then raise exception 'social_not_found'; end if;
    if v_post.status not in ('draft', 'scheduled') then raise exception 'social_state_invalid'; end if;
    v_previous := v_post.status;
  end if;
  if p_status = 'scheduled' and (v_previous is null or v_previous <> 'scheduled') then
    v_usage := public.consume_usage(p_organization_id, 'scheduled_posts', 1, p_limit);
    if not (v_usage->>'allowed')::boolean then raise exception 'social_limit_reached:%', v_usage->>'used'; end if;
  end if;
  if p_post_id is null then
    insert into public.social_posts (organization_id, format, caption, hashtags, media, scheduled_at, status, created_by, created_via)
    values (p_organization_id, (p_payload->>'format')::public.social_post_format, coalesce(p_payload->>'caption',''), array(select jsonb_array_elements_text(p_payload->'hashtags')), p_payload->'media', v_scheduled_at, p_status::public.social_post_status, p_user_id, p_via)
    returning * into v_post;
  else
    update public.social_posts set format = (p_payload->>'format')::public.social_post_format, caption = coalesce(p_payload->>'caption',''), hashtags = array(select jsonb_array_elements_text(p_payload->'hashtags')), media = p_payload->'media', scheduled_at = v_scheduled_at, status = p_status::public.social_post_status
    where id = p_post_id and organization_id = p_organization_id returning * into v_post;
    delete from public.social_post_targets where post_id = p_post_id and organization_id = p_organization_id;
  end if;
  for v_target in select value from jsonb_array_elements(p_payload->'targets') loop
    v_provider := case v_target->>'channel' when 'instagram' then 'instagram'::public.integration_provider when 'facebook' then 'facebook_page'::public.integration_provider when 'google_business' then 'google_business'::public.integration_provider else null end;
    if v_provider is null or not exists (select 1 from public.integrations i where i.id = (v_target->>'integration_id')::uuid and i.organization_id = p_organization_id and i.provider = v_provider and i.status = 'connected') then raise exception 'social_integration_invalid'; end if;
    insert into public.social_post_targets (post_id, organization_id, channel, integration_id, provider) values (v_post.id, p_organization_id, v_target->>'channel', (v_target->>'integration_id')::uuid, v_provider);
  end loop;
  return to_jsonb(v_post);
end $$;
revoke all on function public.save_social_post(uuid, uuid, uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_social_post(uuid, uuid, uuid, text, text, jsonb, integer) to service_role;
