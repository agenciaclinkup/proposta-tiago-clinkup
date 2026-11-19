-- Dados do Estúdio: leitura por membros; alterações e consumo somente pelo servidor.
create table public.carousels (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200), status text not null check (status in ('draft','ready')),
  theme jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object'),
  export_paths text[] not null default '{}', created_by uuid references auth.users(id) on delete set null,
  created_via text not null check (created_via in ('manual','hermes')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organization_id)
);
create index carousels_org_updated_idx on public.carousels (organization_id, updated_at desc, id);
create trigger carousels_updated before update on public.carousels for each row execute function private.set_updated_at();

create table public.studio_slides (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, carousel_id uuid not null,
  position integer not null check (position between 0 and 19), role text not null check (role in ('hook','content','cta')),
  heading text not null default '' check (char_length(heading) <= 300), body text not null default '' check (char_length(body) <= 3000),
  image_path text check (image_path is null or (left(image_path, length(organization_id::text) + 1) = organization_id::text || '/' and position('..' in image_path) = 0)),
  foreign key (carousel_id, organization_id) references public.carousels(id, organization_id) on delete cascade,
  unique (carousel_id, position)
);
create index studio_slides_org_idx on public.studio_slides (organization_id, carousel_id, position);

create table public.landing_pages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200), slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) <= 30),
  pipeline_id uuid, stage_id uuid, published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null, created_via text not null check (created_via in ('manual','hermes')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, slug), unique (id, organization_id),
  check ((pipeline_id is null and stage_id is null) or (pipeline_id is not null and stage_id is not null)),
  foreign key (stage_id, pipeline_id, organization_id) references public.crm_stages(id, pipeline_id, organization_id)
);
create index landing_pages_org_updated_idx on public.landing_pages (organization_id, updated_at desc);
create index landing_pages_stage_idx on public.landing_pages (stage_id, pipeline_id, organization_id);
create trigger landing_pages_updated before update on public.landing_pages for each row execute function private.set_updated_at();

create table public.studio_generations (
  id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  carousel_id uuid not null, kind text not null check (kind = 'carousel'), prompt text not null check (char_length(prompt) between 1 and 5000),
  status text not null default 'started' check (status in ('started','succeeded','failed')),
  result jsonb, error_message text check (char_length(error_message) <= 1000),
  credits integer not null default 1 check (credits = 1), period_start date not null, credit_refunded boolean not null default false,
  created_by uuid not null references auth.users(id), created_via text not null check (created_via in ('manual','hermes')),
  created_at timestamptz not null default now(), finished_at timestamptz,
  foreign key (carousel_id, organization_id) references public.carousels(id, organization_id) on delete cascade
);
create index studio_generations_org_idx on public.studio_generations (organization_id, created_at desc);
create index studio_generations_carousel_idx on public.studio_generations (carousel_id, organization_id);

alter table public.carousels enable row level security;
alter table public.studio_slides enable row level security;
alter table public.landing_pages enable row level security;
alter table public.studio_generations enable row level security;
revoke all on public.carousels, public.studio_slides, public.landing_pages, public.studio_generations from public, anon, authenticated;
grant select on public.carousels, public.studio_slides, public.landing_pages, public.studio_generations to authenticated;
create policy "members read carousels" on public.carousels for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read studio slides" on public.studio_slides for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read landing pages" on public.landing_pages for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read studio generations" on public.studio_generations for select to authenticated using ((select private.is_org_member(organization_id)));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('studio-assets','studio-assets',false,52428800,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.save_studio_carousel(p_org uuid, p_user uuid, p_id uuid, p_via text, p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_carousel public.carousels%rowtype; v_slide jsonb; v_position integer := 0;
begin
  if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_user) then raise exception 'studio_forbidden'; end if;
  if p_via not in ('manual','hermes') or jsonb_typeof(p_payload->'slides') <> 'array' or jsonb_array_length(p_payload->'slides') > 20 then raise exception 'studio_invalid'; end if;
  if p_id is null then
    insert into public.carousels (organization_id,title,status,theme,export_paths,created_by,created_via) values (p_org,p_payload->>'title',p_payload->>'status',p_payload->'theme',coalesce(array(select jsonb_array_elements_text(p_payload->'exportPaths')),'{}'),p_user,p_via) returning * into v_carousel;
  else
    update public.carousels set title=p_payload->>'title',status=p_payload->>'status',theme=p_payload->'theme',export_paths=case when p_payload ? 'exportPaths' then array(select jsonb_array_elements_text(p_payload->'exportPaths')) else export_paths end where id=p_id and organization_id=p_org returning * into v_carousel;
    if not found then raise exception 'studio_not_found'; end if;
    delete from public.studio_slides where carousel_id=p_id and organization_id=p_org;
  end if;
  for v_slide in select value from jsonb_array_elements(p_payload->'slides') loop
    insert into public.studio_slides (organization_id,carousel_id,position,role,heading,body,image_path)
      values (p_org,v_carousel.id,v_position,v_slide->>'role',v_slide->>'heading',v_slide->>'body',v_slide->>'imagePath');
    v_position := v_position + 1;
  end loop;
  return to_jsonb(v_carousel);
end $$;

create function public.save_studio_landing(p_org uuid, p_user uuid, p_id uuid, p_via text, p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_page public.landing_pages%rowtype;
begin
  if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_user) then raise exception 'studio_forbidden'; end if;
  if p_via not in ('manual','hermes') then raise exception 'studio_invalid'; end if;
  if p_id is null then
    insert into public.landing_pages (organization_id,title,slug,sections,pipeline_id,stage_id,published,created_by,created_via)
      values (p_org,p_payload->>'title',p_payload->>'slug',p_payload->'sections',nullif(p_payload->>'pipelineId','')::uuid,nullif(p_payload->>'stageId','')::uuid,(p_payload->>'published')::boolean,p_user,p_via) returning * into v_page;
  else
    update public.landing_pages set title=p_payload->>'title',slug=p_payload->>'slug',sections=p_payload->'sections',pipeline_id=nullif(p_payload->>'pipelineId','')::uuid,stage_id=nullif(p_payload->>'stageId','')::uuid,published=(p_payload->>'published')::boolean where id=p_id and organization_id=p_org returning * into v_page;
    if not found then raise exception 'studio_not_found'; end if;
  end if;
  return to_jsonb(v_page);
end $$;

create function public.begin_studio_generation(p_org uuid,p_user uuid,p_request_id uuid,p_carousel uuid,p_kind text,p_prompt text,p_via text,p_limit integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_existing public.studio_generations%rowtype; v_usage jsonb;
begin
  if not exists (select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then raise exception 'studio_forbidden'; end if;
  if p_request_id is null or p_via not in ('manual','hermes') or p_kind <> 'carousel' or length(p_prompt) not between 1 and 5000 then raise exception 'studio_invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_existing from public.studio_generations where id=p_request_id;
  if found then
    if v_existing.organization_id <> p_org or v_existing.created_by <> p_user or v_existing.carousel_id <> p_carousel or v_existing.kind <> p_kind or v_existing.prompt <> p_prompt or v_existing.created_via <> p_via then raise exception 'studio_request_conflict'; end if;
    return jsonb_build_object('created',false,'generation',to_jsonb(v_existing));
  end if;
  perform 1 from public.carousels where id=p_carousel and organization_id=p_org for key share;
  if not found then raise exception 'studio_not_found'; end if;
  v_usage := public.consume_usage(p_org,'ai_credits',1,p_limit);
  if not (v_usage->>'allowed')::boolean then raise exception 'studio_limit_reached:%',v_usage->>'used'; end if;
  insert into public.studio_generations (id,organization_id,carousel_id,kind,prompt,created_by,created_via,period_start)
    values (p_request_id,p_org,p_carousel,p_kind,p_prompt,p_user,p_via,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date) returning * into v_existing;
  return jsonb_build_object('created',true,'generation',to_jsonb(v_existing));
end $$;

create function public.finish_studio_generation(p_org uuid,p_user uuid,p_request_id uuid,p_status text,p_result jsonb,p_error text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_generation public.studio_generations%rowtype;
begin
  if not exists (select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then raise exception 'studio_forbidden'; end if;
  if p_status not in ('succeeded','failed') then raise exception 'studio_invalid'; end if;
  select * into v_generation from public.studio_generations where id=p_request_id and organization_id=p_org and created_by=p_user for update;
  if not found then raise exception 'studio_not_found'; end if;
  if v_generation.status <> 'started' then raise exception 'studio_finished'; end if;
  if p_status = 'failed' then
    update public.usage_counters set used=used-v_generation.credits, updated_at=now()
      where organization_id=p_org and metric='ai_credits' and period_start=v_generation.period_start and used >= v_generation.credits;
    if not found then raise exception 'studio_refund_invalid'; end if;
  end if;
  update public.studio_generations set status=p_status,result=p_result,error_message=p_error,finished_at=now(),credit_refunded=(p_status = 'failed') where id=p_request_id returning * into v_generation;
  return to_jsonb(v_generation);
end $$;
revoke all on function public.save_studio_carousel(uuid,uuid,uuid,text,jsonb), public.save_studio_landing(uuid,uuid,uuid,text,jsonb), public.begin_studio_generation(uuid,uuid,uuid,uuid,text,text,text,integer), public.finish_studio_generation(uuid,uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_studio_carousel(uuid,uuid,uuid,text,jsonb), public.save_studio_landing(uuid,uuid,uuid,text,jsonb), public.begin_studio_generation(uuid,uuid,uuid,uuid,text,text,text,integer), public.finish_studio_generation(uuid,uuid,uuid,text,jsonb,text) to service_role;
