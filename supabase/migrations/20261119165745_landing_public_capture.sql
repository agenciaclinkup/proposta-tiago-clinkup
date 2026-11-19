-- Somente o endpoint público verificado pode resolver a página e gravar o lead.
create function public.capture_landing_lead(p_org_slug text, p_slug text, p_name text, p_email text, p_whatsapp text, p_message text, p_limits jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_org public.organizations%rowtype; v_page public.landing_pages%rowtype; v_count bigint; v_limit integer; v_position double precision; v_lead uuid;
begin
  select * into v_org from public.organizations where slug=p_org_slug for update;
  if not found then return false; end if;
  select * into v_page from public.landing_pages where organization_id=v_org.id and slug=p_slug and published=true for share;
  if not found or v_page.stage_id is null or v_page.pipeline_id is null or not exists (select 1 from jsonb_array_elements(v_page.sections) s where s->>'type'='form') then return false; end if;
  if not exists (select 1 from public.crm_stages where id=v_page.stage_id and pipeline_id=v_page.pipeline_id and organization_id=v_org.id) then return false; end if;
  v_limit := coalesce((p_limits->>v_org.plan_id)::integer,0);
  select count(*) into v_count from public.crm_leads where organization_id=v_org.id;
  if v_count >= v_limit then return false; end if;
  select coalesce(max(position),0)+1024 into v_position from public.crm_leads where organization_id=v_org.id and stage_id=v_page.stage_id;
  insert into public.crm_leads (organization_id,pipeline_id,stage_id,position,name,email,whatsapp,notes,source,created_by,owner_id)
    values (v_org.id,v_page.pipeline_id,v_page.stage_id,v_position,p_name,nullif(p_email,''),nullif(p_whatsapp,''),nullif(p_message,''),'landing_page',null,null) returning id into v_lead;
  insert into public.crm_activities (organization_id,lead_id,type,content,metadata,created_by,created_via)
    values (v_org.id,v_lead,'note','Recebido pela landing page ' || v_page.title,jsonb_build_object('landing_page_id',v_page.id,'consent',true,'consented_at',now()),null,'manual');
  return true;
end $$;
revoke all on function public.capture_landing_lead(text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.capture_landing_lead(text,text,text,text,text,text,jsonb) to service_role;
