-- Hardening pós-advisor (Supabase Cloud):
-- 1) Revoga EXECUTE da função padrão public.rls_auto_enable() para public/anon/authenticated quando existir.
-- 2) Substitui policies FOR ALL por INSERT/UPDATE/DELETE em crm_pipelines e crm_stages,
--    eliminando múltiplas policies permissivas em SELECT.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

drop policy if exists "admins manage pipelines" on public.crm_pipelines;
create policy "admins create pipelines" on public.crm_pipelines for insert to authenticated
  with check ((select private.is_org_admin(organization_id)));
create policy "admins update pipelines" on public.crm_pipelines for update to authenticated
  using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));
create policy "admins delete pipelines" on public.crm_pipelines for delete to authenticated
  using ((select private.is_org_admin(organization_id)));

drop policy if exists "admins manage stages" on public.crm_stages;
create policy "admins create stages" on public.crm_stages for insert to authenticated
  with check ((select private.is_org_admin(organization_id)));
create policy "admins update stages" on public.crm_stages for update to authenticated
  using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));
create policy "admins delete stages" on public.crm_stages for delete to authenticated
  using ((select private.is_org_admin(organization_id)));
