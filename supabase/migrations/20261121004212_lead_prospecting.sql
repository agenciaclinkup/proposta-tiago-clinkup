create table public.lead_searches (
  id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  niche text not null check (char_length(niche) between 1 and 200), location text not null check (char_length(location) between 1 and 200),
  radius_km integer not null check (radius_km between 1 and 50), requested_count integer not null check (requested_count between 1 and 100),
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  results_count integer not null default 0 check (results_count >= 0), charged_count integer not null default 0 check (charged_count >= 0), period_start date not null,
  created_by uuid not null references auth.users(id), created_via text not null check (created_via in ('manual','hermes')),
  created_at timestamptz not null default now(), finished_at timestamptz, unique(id,organization_id)
);
create index lead_searches_org_created_idx on public.lead_searches (organization_id,created_at desc);

create table public.scraped_leads (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, search_id uuid not null,
  place_id text not null check (char_length(place_id) between 1 and 500), name text not null check (char_length(name) between 1 and 200),
  category text, address text, city text, phone text, whatsapp text, email text, website text, instagram text,
  rating numeric(2,1) check (rating between 0 and 5), raw jsonb not null default '{}'::jsonb check (jsonb_typeof(raw)='object'), status text not null default 'new' check (status in ('new','sent_to_crm','sent_to_audience','discarded')),
  crm_lead_id uuid, created_at timestamptz not null default now(),
  foreign key (search_id,organization_id) references public.lead_searches(id,organization_id) on delete cascade,
  foreign key (crm_lead_id,organization_id) references public.crm_leads(id,organization_id) on delete set null (crm_lead_id),
  unique(organization_id,place_id), unique(id,organization_id)
);
create index scraped_leads_search_idx on public.scraped_leads (search_id,organization_id);
create index scraped_leads_crm_idx on public.scraped_leads (crm_lead_id,organization_id);
create index scraped_leads_org_status_idx on public.scraped_leads (organization_id,status,created_at desc);
create table public.lead_search_results (
  organization_id uuid not null, search_id uuid not null, scraped_lead_id uuid not null,
  primary key (search_id,scraped_lead_id),
  foreign key (search_id,organization_id) references public.lead_searches(id,organization_id) on delete cascade,
  foreign key (scraped_lead_id,organization_id) references public.scraped_leads(id,organization_id) on delete cascade
);
create index lead_search_results_org_idx on public.lead_search_results (organization_id,search_id);
create index lead_search_results_lead_idx on public.lead_search_results (scraped_lead_id,organization_id);
alter table public.lead_searches enable row level security;
alter table public.scraped_leads enable row level security;
alter table public.lead_search_results enable row level security;
revoke all on public.lead_searches,public.scraped_leads,public.lead_search_results from public,anon,authenticated;
grant select on public.lead_searches,public.scraped_leads,public.lead_search_results to authenticated;
create policy "members read lead searches" on public.lead_searches for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read scraped leads" on public.scraped_leads for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members read lead search results" on public.lead_search_results for select to authenticated using ((select private.is_org_member(organization_id)));

create function public.begin_lead_search(p_org uuid,p_user uuid,p_id uuid,p_niche text,p_location text,p_radius integer,p_count integer,p_via text,p_limit integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_search public.lead_searches%rowtype; v_usage jsonb;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then raise exception 'prospect_forbidden'; end if;
  if p_id is null or p_via not in ('manual','hermes') or p_count not between 1 and 100 or p_radius not between 1 and 50 or length(p_niche) not between 1 and 200 or length(p_location) not between 1 and 200 then raise exception 'prospect_invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  select * into v_search from public.lead_searches where id=p_id;
  if found then
    if v_search.organization_id<>p_org or v_search.created_by<>p_user or v_search.niche<>p_niche or v_search.location<>p_location or v_search.radius_km<>p_radius or v_search.requested_count<>p_count or v_search.created_via<>p_via then raise exception 'prospect_request_conflict'; end if;
    return jsonb_build_object('created',false,'search',to_jsonb(v_search));
  end if;
  v_usage := public.consume_usage(p_org,'scraped_leads',p_count,p_limit);
  if not (v_usage->>'allowed')::boolean then raise exception 'prospect_limit_reached:%',v_usage->>'used'; end if;
  insert into public.lead_searches(id,organization_id,niche,location,radius_km,requested_count,period_start,created_by,created_via)
    values(p_id,p_org,p_niche,p_location,p_radius,p_count,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date,p_user,p_via) returning * into v_search;
  return jsonb_build_object('created',true,'search',to_jsonb(v_search));
end $$;

create function public.finish_lead_search(p_org uuid,p_user uuid,p_id uuid,p_status text,p_results jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_search public.lead_searches%rowtype; v_item jsonb; v_count integer:=0; v_result_count integer:=0; v_refund integer; v_lead uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then raise exception 'prospect_forbidden'; end if;
  select * into v_search from public.lead_searches where id=p_id and organization_id=p_org and created_by=p_user for update;
  if not found then raise exception 'prospect_not_found'; end if;
  if v_search.status<>'running' then return to_jsonb(v_search); end if;
  if p_status not in ('succeeded','failed') or jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)>v_search.requested_count or (p_status='failed' and jsonb_array_length(p_results)<>0) then raise exception 'prospect_invalid'; end if;
  for v_item in select value from jsonb_array_elements(p_results) loop
    insert into public.scraped_leads(organization_id,search_id,place_id,name,category,address,city,phone,whatsapp,email,website,instagram,rating)
      values(p_org,p_id,v_item->>'placeId',v_item->>'name',v_item->>'category',v_item->>'address',v_item->>'city',v_item->>'phone',v_item->>'whatsapp',v_item->>'email',v_item->>'website',v_item->>'instagram',nullif(v_item->>'rating','')::numeric)
      on conflict(organization_id,place_id) do nothing returning id into v_lead;
    if found then v_count:=v_count+1; else select id into v_lead from public.scraped_leads where organization_id=p_org and place_id=v_item->>'placeId'; end if;
    insert into public.lead_search_results(organization_id,search_id,scraped_lead_id) values(p_org,p_id,v_lead) on conflict do nothing;
    if found then v_result_count:=v_result_count+1; end if;
  end loop;
  v_refund:=v_search.requested_count-v_count;
  if v_refund>0 then
    update public.usage_counters set used=used-v_refund,updated_at=now() where organization_id=p_org and metric='scraped_leads' and period_start=v_search.period_start and used>=v_refund;
    if not found then raise exception 'prospect_refund_invalid'; end if;
  end if;
  update public.lead_searches set status=p_status,results_count=v_result_count,charged_count=v_count,finished_at=now() where id=p_id returning * into v_search;
  return to_jsonb(v_search);
end $$;

-- Uma tentativa interrompida não pode acionar o provedor outra vez. Após 15 minutos,
-- o próprio solicitante pode encerrá-la e liberar a reserva no período original.
create function public.recover_lead_search(p_org uuid,p_user uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_search public.lead_searches%rowtype;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then raise exception 'prospect_forbidden'; end if;
  select * into v_search from public.lead_searches where id=p_id and organization_id=p_org and created_by=p_user for update;
  if not found then raise exception 'prospect_not_found'; end if;
  if v_search.status='running' and v_search.created_at < now()-interval '15 minutes' then
    return public.finish_lead_search(p_org,p_user,p_id,'failed','[]'::jsonb);
  end if;
  return to_jsonb(v_search);
end $$;

create function public.send_scraped_lead_to_crm(p_org uuid,p_user uuid,p_prospect uuid,p_stage uuid,p_via text,p_limit integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_prospect public.scraped_leads%rowtype; v_stage public.crm_stages%rowtype; v_crm public.crm_leads%rowtype; v_position double precision;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then raise exception 'prospect_forbidden'; end if;
  if p_via not in ('manual','hermes') or p_limit<0 then raise exception 'prospect_invalid'; end if;
  perform 1 from public.organizations where id=p_org for update;
  select * into v_prospect from public.scraped_leads where id=p_prospect and organization_id=p_org for update;
  if not found then raise exception 'prospect_not_found'; end if;
  if v_prospect.crm_lead_id is not null then
    select * into v_crm from public.crm_leads where id=v_prospect.crm_lead_id and organization_id=p_org;
    if found then return to_jsonb(v_crm); end if;
  end if;
  if v_prospect.status<>'new' then raise exception 'prospect_state_invalid'; end if;
  if (select count(*) from public.crm_leads where organization_id=p_org)>=p_limit then raise exception 'prospect_crm_limit'; end if;
  select s.* into v_stage from public.crm_stages s join public.crm_pipelines p on p.id=s.pipeline_id and p.organization_id=s.organization_id
    where s.organization_id=p_org and p.is_default and (p_stage is null or s.id=p_stage) order by s.position limit 1;
  if not found then raise exception 'prospect_stage_invalid'; end if;
  select coalesce(max(position),0)+1024 into v_position from public.crm_leads where organization_id=p_org and stage_id=v_stage.id;
  insert into public.crm_leads(organization_id,pipeline_id,stage_id,position,name,company,email,phone,whatsapp,website,instagram,source,scraped_lead_id,owner_id,created_by)
    values(p_org,v_stage.pipeline_id,v_stage.id,v_position,v_prospect.name,v_prospect.name,v_prospect.email,v_prospect.phone,v_prospect.whatsapp,v_prospect.website,v_prospect.instagram,'scraping',v_prospect.id,p_user,p_user) returning * into v_crm;
  insert into public.crm_activities(organization_id,lead_id,type,content,metadata,created_by,created_via)
    values(p_org,v_crm.id,'note','Lead recebido da prospecção.',jsonb_build_object('scraped_lead_id',v_prospect.id),p_user,p_via);
  update public.scraped_leads set status='sent_to_crm',crm_lead_id=v_crm.id where id=v_prospect.id;
  return to_jsonb(v_crm);
end $$;
revoke all on function public.begin_lead_search(uuid,uuid,uuid,text,text,integer,integer,text,integer),public.finish_lead_search(uuid,uuid,uuid,text,jsonb),public.recover_lead_search(uuid,uuid,uuid),public.send_scraped_lead_to_crm(uuid,uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.begin_lead_search(uuid,uuid,uuid,text,text,integer,integer,text,integer),public.finish_lead_search(uuid,uuid,uuid,text,jsonb),public.recover_lead_search(uuid,uuid,uuid),public.send_scraped_lead_to_crm(uuid,uuid,uuid,uuid,text,integer) to service_role;
