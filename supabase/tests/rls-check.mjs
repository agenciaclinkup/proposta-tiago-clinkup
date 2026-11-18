// Aplica todas as migrations num Postgres em memória (PGlite) com o schema `auth` simulado
// e verifica isolamento RLS entre organizações, grants e rate limit. Uso: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite();
const dir = process.argv[2];
const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como no Supabase: service_role recebe privilégios nas tabelas novas do public.
  alter default privileges in schema public grant all on tables to service_role;
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

// Hermes logs (auditoria: só o servidor grava; membros leem a própria org)
await asService(`insert into public.hermes_logs (organization_id, user_id, channel, tool_name, input, output, status, duration_ms)
                 values ('${orgA}', '${A}', 'web', 'get_brand_context', '{}', '{"ok":true}', 'success', 12)`);
check("A reads own hermes log", (await as(A, `select tool_name from public.hermes_logs`)).rows[0]?.tool_name === "get_brand_context");
check("B sees no hermes log", (await as(B, `select * from public.hermes_logs`)).rows.length === 0);
await expectFail("A forges hermes log", () => as(A, `insert into public.hermes_logs (organization_id, channel, tool_name, status) values ('${orgA}', 'web', 'fake', 'success')`));
await expectFail("A edits hermes log", () => as(A, `update public.hermes_logs set status = 'error'`));
await expectFail("anon reads hermes logs", async () => { await db.exec("set role anon;"); try { await db.query("select * from public.hermes_logs"); } finally { await db.exec("reset role;"); } });

// Usage counters (consumo atômico por período, limite passado pelo servidor)
const consume = async (metric, amount, limit) =>
  (await asService(`select public.consume_usage('${orgA}', '${metric}', ${amount}, ${limit}) as r`)).rows[0].r;
const u1 = await consume("ai_credits", 3, 5);
const u2 = await consume("ai_credits", 3, 5);
const u3 = await consume("ai_credits", 2, 5);
check("usage allows within limit", u1.allowed === true && u1.used === 3);
check("usage blocks over limit without consuming", u2.allowed === false && u2.used === 3);
check("usage allows exact limit", u3.allowed === true && u3.used === 5);
const u4 = await consume("scraped_leads", 10, 5);
check("usage blocks amount above limit on first use", u4.allowed === false && u4.used === 0);
await expectFail("usage rejects unknown metric", () => consume("hack", 1, 5));
await expectFail("usage rejects non-positive amount", () => consume("ai_credits", 0, 5));
check("A reads own usage", (await as(A, `select used from public.usage_counters where metric = 'ai_credits'`)).rows[0]?.used === 5);
check("B sees no usage", (await as(B, `select * from public.usage_counters`)).rows.length === 0);
await expectFail("A resets own usage", () => as(A, `update public.usage_counters set used = 0`));
await expectFail("authenticated calls consume_usage", () => as(A, `select public.consume_usage('${orgA}', 'ai_credits', 1, 999)`));

// Conversas do Hermes: cada usuário só vê as próprias; mensagens só o servidor grava
const convA = "20000000-0000-0000-0000-00000000000a";
await as(A, `insert into public.hermes_conversations (id, organization_id, title) values ('${convA}', '${orgA}', 'Primeira conversa')`);
check("conversation owner defaults to auth.uid()", (await db.query(`select user_id from public.hermes_conversations where id='${convA}'`)).rows[0]?.user_id === A);
await asService(`insert into public.hermes_messages (conversation_id, organization_id, message_id, role, parts)
                 values ('${convA}', '${orgA}', 'm1', 'user', '[{"type":"text","text":"oi"}]')`);
check("A reads own messages", (await as(A, `select message_id from public.hermes_messages`)).rows[0]?.message_id === "m1");
check("A renames own conversation", (await as(A, `update public.hermes_conversations set title='Renomeada' where id='${convA}' returning id`)).rows.length === 1);
check("B sees no conversation", (await as(B, `select * from public.hermes_conversations`)).rows.length === 0);
check("B sees no messages", (await as(B, `select * from public.hermes_messages`)).rows.length === 0);
check("B cannot rename A conversation", (await as(B, `update public.hermes_conversations set title='x' returning id`)).rows.length === 0);
check("B cannot delete A conversation", (await as(B, `delete from public.hermes_conversations returning id`)).rows.length === 0);
await expectFail("B creates conversation in A org", () => as(B, `insert into public.hermes_conversations (organization_id, title) values ('${orgA}', 'x')`));
await expectFail("A creates conversation as B", () => as(A, `insert into public.hermes_conversations (organization_id, user_id, title) values ('${orgA}', '${B}', 'x')`));
await expectFail("A forges assistant message", () => as(A, `insert into public.hermes_messages (conversation_id, organization_id, message_id, role, parts) values ('${convA}', '${orgA}', 'm2', 'assistant', '[]')`));
await expectFail("duplicate message id in conversation", () => asService(`insert into public.hermes_messages (conversation_id, organization_id, message_id, role, parts) values ('${convA}', '${orgA}', 'm1', 'user', '[]')`));
check("A deletes own conversation (cascade messages)", (await as(A, `delete from public.hermes_conversations where id='${convA}' returning id`)).rows.length === 1
  && (await db.query(`select count(*)::int as n from public.hermes_messages`)).rows[0].n === 0);

// Estorno de uso (stream do Hermes falhou): nunca abaixo de zero, só service_role
await asService(`delete from public.usage_counters`);
await consume("ai_credits", 2, 10);
const refund = async (amount) =>
  (await asService(`select public.refund_usage('${orgA}', 'ai_credits', ${amount}) as used`)).rows[0].used;
check("refund returns credit", (await refund(1)) === 1);
check("refund never goes below zero", (await refund(5)) === 0);
check("refund with no usage row is a no-op", (await asService(`select public.refund_usage('${orgA}', 'scraped_leads', 1) as used`)).rows[0].used === 0);
await expectFail("refund rejects non-positive amount", () => refund(0));
await expectFail("authenticated calls refund_usage", () => as(A, `select public.refund_usage('${orgA}', 'ai_credits', 1)`));

// Integrações (Fase 3.1): membros leem, só admin desconecta, servidor grava; segredos invisíveis
const C = "00000000-0000-0000-0000-00000000000c";
await db.exec(`insert into auth.users (id) values ('${C}')`);
await asService(`insert into public.organization_members (organization_id, user_id, role) values ('${orgA}', '${C}', 'member')`);
const intA = "30000000-0000-0000-0000-00000000000a";
await asService(`insert into public.integrations (id, organization_id, provider, status, external_account_id, display_name)
                 values ('${intA}', '${orgA}', 'instagram', 'connected', 'ig-123', '@clinkup')`);
await asService(`insert into public.integration_secrets (integration_id, organization_id, access_token_encrypted)
                 values ('${intA}', '${orgA}', 'v1:aXY:dGFn:Y3Q')`);
check("member reads org integrations", (await as(C, `select display_name from public.integrations`)).rows[0]?.display_name === "@clinkup");
check("B sees no integrations", (await as(B, `select * from public.integrations`)).rows.length === 0);
check("member cannot disconnect", (await as(C, `delete from public.integrations returning id`)).rows.length === 0);
check("B cannot disconnect", (await as(B, `delete from public.integrations returning id`)).rows.length === 0);
await expectFail("admin cannot insert integration directly", () => as(A, `insert into public.integrations (organization_id, provider, external_account_id) values ('${orgA}', 'telegram', 'x')`));
await expectFail("admin cannot edit integration directly", () => as(A, `update public.integrations set status = 'connected'`));
await expectFail("owner reads secrets", () => as(A, `select * from public.integration_secrets`));
await expectFail("owner writes secrets", () => as(A, `insert into public.integration_secrets (integration_id, organization_id, access_token_encrypted) values ('${intA}', '${orgA}', 'v1:a:b:c')`));
await expectFail("secret must be encrypted (v1 format)", () => asService(`update public.integration_secrets set access_token_encrypted = 'EAAG-plain-token' where integration_id = '${intA}'`));
await expectFail("duplicate account per provider", () => asService(`insert into public.integrations (organization_id, provider, external_account_id) values ('${orgA}', 'instagram', 'ig-123')`));
check("admin disconnects (cascade secret)", (await as(A, `delete from public.integrations where id = '${intA}' returning id`)).rows.length === 1
  && (await db.query(`select count(*)::int as n from public.integration_secrets`)).rows[0].n === 0);

// Códigos de vínculo do Telegram: gerados pelo servidor, uso único, expiram
await asService(`insert into public.telegram_link_codes (code, organization_id, user_id) values ('ABCD2345', '${orgA}', '${A}')`);
await asService(`insert into public.telegram_link_codes (code, organization_id, user_id, expires_at) values ('OLDC0DE9', '${orgA}', '${A}', now() - interval '1 minute')`);
check("user reads own link code", (await as(A, `select code from public.telegram_link_codes where code = 'ABCD2345'`)).rows.length === 1);
check("other member cannot read code", (await as(C, `select * from public.telegram_link_codes`)).rows.length === 0);
await expectFail("user cannot create own code", () => as(A, `insert into public.telegram_link_codes (code, organization_id, user_id) values ('MYCODE11', '${orgA}', '${A}')`));
const consumeCode = async (code) => (await asService(`select * from public.consume_telegram_link_code('${code}')`)).rows;
const firstUse = await consumeCode("ABCD2345");
check("valid code returns org and user", firstUse[0]?.organization_id === orgA && firstUse[0]?.user_id === A);
check("code is single-use", (await consumeCode("ABCD2345")).length === 0);
check("expired code is rejected", (await consumeCode("OLDC0DE9")).length === 0);
await expectFail("authenticated cannot consume codes", () => as(A, `select * from public.consume_telegram_link_code('ABCD2345')`));

// Bot próprio (Fase 3.3c): provedor telegram_bot e código de vínculo restrito à org do bot
await asService(`insert into public.integrations (organization_id, provider, external_account_id, display_name) values ('${orgA}', 'telegram_bot', '555', '@marca_bot')`);
check("telegram_bot provider accepted", (await as(A, `select display_name from public.integrations where provider = 'telegram_bot'`)).rows[0]?.display_name === "@marca_bot");
const orgB = "10000000-0000-0000-0000-00000000000b";
await as(B, `insert into public.organizations (id, name, slug) values ('${orgB}', 'Outra Empresa', 'outra-empresa')`);
await asService(`insert into public.telegram_link_codes (code, organization_id, user_id) values ('BBBB2345', '${orgB}', '${B}')`);
const consumeFor = async (code, org) => (await asService(`select * from public.consume_telegram_link_code('${code}', '${org}')`)).rows;
check("code of org B rejected by org A bot", (await consumeFor("BBBB2345", orgA)).length === 0);
check("rejected code stays usable for its own org", (await consumeFor("BBBB2345", orgB))[0]?.organization_id === orgB);
await expectFail("authenticated cannot consume with org", () => as(A, `select * from public.consume_telegram_link_code('XXXX2345', '${orgA}')`));
