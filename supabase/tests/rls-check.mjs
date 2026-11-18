// Aplica todas as migrations num Postgres em memória (PGlite) com o schema `auth` simulado
// e verifica isolamento RLS entre organizações, grants e rate limit. Uso: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite();
const dir = process.argv[2];
const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);
for (const file of migrations) {
  await db.exec(readFileSync(join(dir, file), "utf8"));
  console.log("applied", file);
}

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${A}', '{"full_name":"Ana"}'), ('${B}', '{}');`);

const as = async (uid, sql) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql); } finally { await db.exec("reset role;"); }
};
const expectFail = async (label, fn) => {
  try { await fn(); console.log("FAIL (should have errored):", label); process.exitCode = 1; }
  catch (e) { console.log("ok  blocked:", label, "->", e.message.split("\n")[0]); }
};
const check = (label, cond) => { console.log(cond ? "ok " : "FAIL", label); if (!cond) process.exitCode = 1; };

const orgA = "10000000-0000-0000-0000-00000000000a";
await as(A, `insert into public.organizations (id, name, slug, niche) values ('${orgA}', 'Clinkup', 'clinkup-abc', 'Marketing')`);
check("profile auto-created", (await db.query(`select full_name from public.profiles where id='${A}'`)).rows[0]?.full_name === "Ana");
check("owner membership", (await as(A, `select role from public.organization_members`)).rows[0]?.role === "owner");
check("trial subscription", (await as(A, `select status from public.subscriptions`)).rows[0]?.status === "trialing");

await as(A, `insert into public.brand_context (organization_id, company_name, niche, products_services, target_audience, differentiators, tone_of_voice, master_context)
             values ('${orgA}', 'Clinkup', 'Marketing', 'x', 'x', 'x', 'x', 'x')`);
await as(A, `update public.organizations set onboarding_completed_at = now() where id='${orgA}'`);
await as(A, `update public.profiles set current_organization_id='${orgA}' where id='${A}'`);
check("current org set", (await db.query(`select current_organization_id from public.profiles where id='${A}'`)).rows[0]?.current_organization_id === orgA);

check("B sees no org", (await as(B, `select * from public.organizations`)).rows.length === 0);
check("B sees no brand", (await as(B, `select * from public.brand_context`)).rows.length === 0);
check("B sees no subscription", (await as(B, `select * from public.subscriptions`)).rows.length === 0);
check("B update brand = 0 rows", (await as(B, `update public.brand_context set niche='hack' returning 1`)).rows.length === 0);
await expectFail("B insert brand into A org", () => as(B, `insert into public.brand_context (organization_id, company_name, niche, products_services, target_audience, differentiators, tone_of_voice, master_context) values ('${orgA}','x','x','x','x','x','x','x')`));
await expectFail("B points profile to A org", () => as(B, `update public.profiles set current_organization_id='${orgA}' where id='${B}'`));
await expectFail("A sets own super admin", () => as(A, `update public.profiles set is_super_admin=true where id='${A}'`));
await expectFail("A upgrades plan directly", () => as(A, `update public.organizations set plan_id='scale' where id='${orgA}'`));
await expectFail("A writes subscription", () => as(A, `update public.subscriptions set status='active'`));
await expectFail("A creates org as B", () => as(A, `insert into public.organizations (name, slug, created_by) values ('Spoof Org', 'spoof-123', '${B}')`));
await expectFail("anon reads orgs", async () => { await db.exec("set role anon;"); try { await db.query("select * from public.organizations"); } finally { await db.exec("reset role;"); } });
await expectFail("authenticated calls handle_new_organization", () => as(A, `select private.handle_new_user()`));

// Rate limit
const asService = async (sql) => {
  await db.exec("set role service_role;");
  try { return await db.query(sql); } finally { await db.exec("reset role;"); }
};
const hits = [];
for (let i = 0; i < 4; i++) hits.push((await asService(`select public.rate_limit_hit('login:1.2.3.4', 3, 60) as ok`)).rows[0].ok);
check("rate limit allows 3 then blocks", JSON.stringify(hits) === "[true,true,true,false]");
check("rate limit keys independent", (await asService(`select public.rate_limit_hit('login:5.6.7.8', 3, 60) as ok`)).rows[0].ok === true);
await expectFail("rate limit rejects bad args", () => asService(`select public.rate_limit_hit('k', 0, 60)`));
await expectFail("authenticated calls rate_limit_hit", () => as(A, `select public.rate_limit_hit('x', 100, 60)`));
await expectFail("anon calls rate_limit_hit", async () => { await db.exec("set role anon;"); try { await db.query(`select public.rate_limit_hit('x', 100, 60)`); } finally { await db.exec("reset role;"); } });
await expectFail("authenticated reads rate_limits", () => as(A, `select * from private.rate_limits`));
