-- Declaração explícita vinculada à busca e à empresa; somente o servidor grava.
create table public.prospect_sources (
  search_id uuid primary key, organization_id uuid not null, declared_by uuid not null references auth.users(id),
  source_type text not null check (source_type in ('brasilapi','commercial','import')),
  origin text not null check (char_length(origin) between 3 and 200), legal_basis text not null check (char_length(legal_basis) between 3 and 500), payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  declared_at timestamptz not null default now(),
  foreign key(search_id,organization_id) references public.lead_searches(id,organization_id) on delete cascade
);
create index prospect_sources_org_idx on public.prospect_sources(organization_id,search_id);
alter table public.prospect_sources enable row level security;
revoke all on public.prospect_sources from public,anon,authenticated;
grant select on public.prospect_sources to authenticated;
create policy "members read prospect sources" on public.prospect_sources for select to authenticated using ((select private.is_org_member(organization_id)));
create function public.record_prospect_source(p_org uuid,p_user uuid,p_search uuid,p_type text,p_origin text,p_basis text,p_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_existing public.prospect_sources%rowtype;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then raise exception 'prospect_forbidden'; end if;
  perform 1 from public.lead_searches where id=p_search and organization_id=p_org and created_by=p_user for update;
  if not found then raise exception 'prospect_not_found'; end if;
  select * into v_existing from public.prospect_sources where search_id=p_search;
  if found then
    if v_existing.organization_id<>p_org or v_existing.declared_by<>p_user or v_existing.source_type<>p_type or v_existing.origin<>p_origin or v_existing.legal_basis<>p_basis or v_existing.payload_hash<>p_hash then raise exception 'prospect_request_conflict'; end if;
    return true;
  end if;
  if not exists(select 1 from public.lead_searches where id=p_search and status='running') then raise exception 'prospect_not_found'; end if;
  insert into public.prospect_sources(search_id,organization_id,declared_by,source_type,origin,legal_basis,payload_hash) values(p_search,p_org,p_user,p_type,p_origin,p_basis,p_hash);
  return true;
end $$;
revoke all on function public.record_prospect_source(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_prospect_source(uuid,uuid,uuid,text,text,text,text) to service_role;

-- Novas consultas enriquecem somente campos ainda vazios, sem sobrescrever edições ou cobrar novamente.
create or replace function public.finish_lead_search(p_org uuid,p_user uuid,p_id uuid,p_status text,p_results jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
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
    if found then v_count:=v_count+1; else
      update public.scraped_leads set
        category=coalesce(nullif(category,''),nullif(v_item->>'category','')), address=coalesce(nullif(address,''),nullif(v_item->>'address','')),
        city=coalesce(nullif(city,''),nullif(v_item->>'city','')), phone=coalesce(nullif(phone,''),nullif(v_item->>'phone','')),
        whatsapp=coalesce(nullif(whatsapp,''),nullif(v_item->>'whatsapp','')), email=coalesce(nullif(email,''),nullif(v_item->>'email','')),
        website=coalesce(nullif(website,''),nullif(v_item->>'website','')), instagram=coalesce(nullif(instagram,''),nullif(v_item->>'instagram','')),
        rating=coalesce(rating,nullif(v_item->>'rating','')::numeric)
      where organization_id=p_org and place_id=v_item->>'placeId' returning id into v_lead;
    end if;
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
