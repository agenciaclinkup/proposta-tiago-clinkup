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
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como no Supabase: service_role recebe privilégios nas tabelas novas do public.
  alter default privileges in schema public grant all on tables to service_role;
`);
// Empresa "antiga": criada antes da migration do CRM, para provar o backfill do funil padrão.
const LEGACY_USER = "00000000-0000-0000-0000-0000000000ff";
const LEGACY_ORG = "10000000-0000-0000-0000-0000000000ff";
for (const file of migrations) {
  if (file.endsWith("_crm.sql")) {
    await db.exec(`insert into auth.users (id) values ('${LEGACY_USER}');
      insert into public.organizations (id, name, slug, created_by) values ('${LEGACY_ORG}', 'Empresa Antiga', 'empresa-antiga', '${LEGACY_USER}');`);
  }
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
const mediaBucket = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'social-media'`)).rows[0];
check("social media bucket is private and size limited", mediaBucket?.public === false && Number(mediaBucket.file_size_limit) === 52428800 && !mediaBucket.allowed_mime_types.includes("text/html"));
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

// CRM (Fase 4.1): funil padrão, isolamento por empresa e integridade etapa↔empresa garantida no banco
const stagesOf = async (org) =>
  (await asService(`select s.name, s.kind, s.position from public.crm_stages s join public.crm_pipelines p on p.id = s.pipeline_id
                    where p.organization_id = '${org}' and p.is_default order by s.position`)).rows;
check("new org gets default funnel", JSON.stringify((await stagesOf(orgA)).map((s) => s.name)) ===
  JSON.stringify(["Novo Lead", "Qualificado por IA", "Reunião Agendada", "Proposta Enviada", "Fechado"]));
check("last default stage is won", (await stagesOf(orgA)).at(-1)?.kind === "won");
check("existing org got funnel by backfill", (await stagesOf(LEGACY_ORG)).length === 5);
check("org B has its own funnel", (await stagesOf(orgB)).length === 5);

const stageA = (await asService(`select s.id, s.pipeline_id from public.crm_stages s join public.crm_pipelines p on p.id = s.pipeline_id where p.organization_id = '${orgA}' order by s.position limit 1`)).rows[0];
const stageB = (await asService(`select s.id, s.pipeline_id from public.crm_stages s join public.crm_pipelines p on p.id = s.pipeline_id where p.organization_id = '${orgB}' order by s.position limit 1`)).rows[0];
const leadA = "40000000-0000-0000-0000-00000000000a";
await as(C, `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, name, position, created_by)
             values ('${leadA}', '${orgA}', '${stageA.pipeline_id}', '${stageA.id}', 'Maria Clínica', 1024, '${C}')`);
check("member creates lead in own org", (await as(A, `select name from public.crm_leads`)).rows[0]?.name === "Maria Clínica");
check("B sees no leads of A", (await as(B, `select * from public.crm_leads`)).rows.length === 0);
check("B sees no stages of A", (await as(B, `select * from public.crm_stages where pipeline_id = '${stageA.pipeline_id}'`)).rows.length === 0);
check("B cannot update lead of A", (await as(B, `update public.crm_leads set name = 'x' returning id`)).rows.length === 0);
await expectFail("lead cannot point to stage of another org (FK)", () =>
  asService(`insert into public.crm_leads (organization_id, pipeline_id, stage_id, name, position) values ('${orgA}', '${stageB.pipeline_id}', '${stageB.id}', 'x', 1)`));
await expectFail("lead cannot move to stage of another org (FK)", () =>
  asService(`update public.crm_leads set stage_id = '${stageB.id}' where id = '${leadA}'`));
await expectFail("B cannot insert lead into A org", () =>
  as(B, `insert into public.crm_leads (organization_id, pipeline_id, stage_id, name, position, created_by) values ('${orgA}', '${stageA.pipeline_id}', '${stageA.id}', 'x', 1, '${B}')`));
await expectFail("member cannot spoof lead creator", () =>
  as(C, `insert into public.crm_leads (organization_id, pipeline_id, stage_id, name, position, created_by) values ('${orgA}', '${stageA.pipeline_id}', '${stageA.id}', 'x', 1, '${A}')`));
check("member cannot delete lead", (await as(C, `delete from public.crm_leads returning id`)).rows.length === 0);
check("member cannot rename stage", (await as(C, `update public.crm_stages set name = 'x' returning id`)).rows.length === 0);
check("admin renames stage", (await as(A, `update public.crm_stages set name = 'Novo Contato' where id = '${stageA.id}' returning id`)).rows.length === 1);

await as(C, `insert into public.crm_activities (organization_id, lead_id, type, content, created_by, created_via)
             values ('${orgA}', '${leadA}', 'note', 'Pediu orçamento', '${C}', 'manual')`);
check("member reads lead history", (await as(A, `select content from public.crm_activities`)).rows[0]?.content === "Pediu orçamento");
check("B sees no history of A", (await as(B, `select * from public.crm_activities`)).rows.length === 0);
await expectFail("history is append-only", () => as(A, `update public.crm_activities set content = 'editado'`));
await expectFail("activity cannot reference lead of another org", () =>
  asService(`insert into public.crm_activities (organization_id, lead_id, type, content) values ('${orgB}', '${leadA}', 'note', 'x')`));
check("admin deletes lead (history cascades)", (await as(A, `delete from public.crm_leads where id = '${leadA}' returning id`)).rows.length === 1
  && (await db.query(`select count(*)::int as n from public.crm_activities`)).rows[0].n === 0);

// Calendário: mutações somente via serviço, cobrança e gravação na mesma transação.
const socialInt = "60000000-0000-0000-0000-00000000000a";
await asService(`insert into public.integrations (id, organization_id, provider, status, external_account_id) values ('${socialInt}', '${orgA}', 'instagram', 'connected', 'social-test')`);
const socialPayload = JSON.stringify({ format: "feed", caption: "Olá", hashtags: [], media: [], scheduled_at: "2030-01-01T12:00:00Z", targets: [{ channel: "instagram", integration_id: socialInt }] });
const saveSocial = (org, user, post, status, limit, payload = socialPayload) => asService(`select public.save_social_post('${org}', '${user}', ${post ? `'${post}'` : 'null'}, 'manual', '${status}', '${payload}'::jsonb, ${limit}) as result`);
const saved = (await saveSocial(orgA, A, null, "scheduled", 1)).rows[0].result;
check("scheduled post consumes quota", saved.status === "scheduled");
check("member reads social post", (await as(C, `select id from public.social_posts`)).rows.length === 1);
check("other org cannot read social post", (await as(B, `select id from public.social_posts`)).rows.length === 0);
await expectFail("user cannot bypass quota with direct insert", () => as(A, `insert into public.social_posts (organization_id) values ('${orgA}')`));
await expectFail("user cannot call privileged social RPC", () => as(A, `select public.save_social_post('${orgA}', '${A}', null, 'manual', 'scheduled', '${socialPayload}'::jsonb, 999)`));
await expectFail("quota enforced for second schedule", () => saveSocial(orgA, A, null, "scheduled", 1));
check("quota failure rolls back post", (await as(A, `select id from public.social_posts`)).rows.length === 1);
await expectFail("other org cannot reference integration", () => saveSocial(orgB, B, null, "scheduled", 1));
await expectFail("non-member cannot use service RPC", () => saveSocial(orgA, B, null, "draft", 1));
check("rescheduling existing post does not charge twice", (await saveSocial(orgA, A, saved.id, "scheduled", 1)).rows[0].result.id === saved.id);
const socialFacebook = "60000000-0000-0000-0000-00000000000b";
await asService(`insert into public.integrations (id, organization_id, provider, status, external_account_id) values ('${socialFacebook}', '${orgA}', 'facebook_page', 'connected', 'social-page')`);
const multiPayload = JSON.stringify({ format: "feed", caption: "Olá", hashtags: [], media: [], scheduled_at: "2030-01-01T12:00:00Z", targets: [{ channel: "instagram", integration_id: socialInt }, { channel: "facebook", integration_id: socialFacebook }] });
await saveSocial(orgA, A, saved.id, "scheduled", 1, multiPayload);
check("multi-channel post keeps both targets", (await as(A, `select * from public.social_post_targets where post_id = '${saved.id}'`)).rows.length === 2);
check("cancel to draft is allowed", (await saveSocial(orgA, A, saved.id, "draft", 1)).rows[0].result.status === "draft");
await expectFail("scheduling again consumes a new unit", () => saveSocial(orgA, A, saved.id, "scheduled", 1));
check("failed reschedule preserves draft", (await as(A, `select status from public.social_posts where id = '${saved.id}'`)).rows[0].status === "draft");
check("other org cannot see targets", (await as(B, `select * from public.social_post_targets`)).rows.length === 0);
await expectFail("target cannot link integration of another organization", () => asService(`insert into public.social_post_targets (post_id, organization_id, channel, integration_id, provider) values ('${saved.id}', '${orgA}', 'facebook', '${socialInt}', 'facebook_page')`));
const invalidPayload = JSON.stringify({ format: "feed", caption: "x", hashtags: [], media: [], scheduled_at: "2030-01-01T12:00:00Z", targets: [{ channel: "facebook", integration_id: socialInt }] });
await expectFail("wrong integration provider rejected", () => saveSocial(orgB, B, null, "scheduled", 2, invalidPayload));
check("failed schedule rolls back usage", (await asService(`select used from public.usage_counters where organization_id = '${orgB}' and metric = 'scheduled_posts'`)).rows.length === 0);
await asService(`update public.social_posts set status = 'publishing' where id = '${saved.id}'`);
await expectFail("cannot edit post being published", () => saveSocial(orgA, A, saved.id, "draft", 1));

// Fila: uma captura por post, tokens de posse e recuperação conservadora.
await asService(`update public.social_posts set status = 'scheduled', scheduled_at = now() - interval '1 minute' where id = '${saved.id}'`);
const claim = (await asService("select * from public.claim_social_posts(5)" )).rows;
check("queue claims due post", claim.length === 1 && claim[0].id === saved.id);
check("second worker cannot claim same post", (await asService("select * from public.claim_social_posts(5)")).rows.length === 0);
await expectFail("authenticated cannot claim queue", () => as(A, "select * from public.claim_social_posts(5)"));
check("worker starts target once", (await asService(`select public.start_social_target('${saved.id}', '${orgA}', '${socialInt}', '${claim[0].lease_token}') as ok`)).rows[0].ok === true);
await expectFail("worker cannot start target twice", () => asService(`select public.start_social_target('${saved.id}', '${orgA}', '${socialInt}', '${claim[0].lease_token}')`));
await expectFail("wrong organization cannot finish target", () => asService(`select public.finish_social_target('${saved.id}', '${orgB}', '${socialInt}', '${claim[0].lease_token}', 'published', 'id-external', null)`));
check("worker can persist success", (await asService(`select public.finish_social_target('${saved.id}', '${orgA}', '${socialInt}', '${claim[0].lease_token}', 'published', 'id-external', null) as ok`)).rows[0].ok === true);
check("completed post marked published", (await as(A, `select status from public.social_posts where id = '${saved.id}'`)).rows[0].status === "published");
await expectFail("late worker cannot replay result", () => asService(`select public.finish_social_target('${saved.id}', '${orgA}', '${socialInt}', '${claim[0].lease_token}', 'published', 'id-external', null)`));
const interrupted = (await saveSocial(orgA, A, null, "scheduled", 3)).rows[0].result;
await asService(`update public.social_posts set scheduled_at = now() - interval '1 minute' where id = '${interrupted.id}'`);
const expiredClaim = (await asService("select * from public.claim_social_posts(5)")).rows[0];
await asService(`select public.start_social_target('${interrupted.id}', '${orgA}', '${socialInt}', '${expiredClaim.lease_token}')`);
await asService(`update public.social_posts set lease_expires_at = now() - interval '1 second' where id = '${interrupted.id}'`);
check("expired publication is not reclaimed", (await asService("select * from public.claim_social_posts(5)")).rows.length === 0);
check("expired publication becomes uncertain", (await as(A, `select publish_state from public.social_post_targets where post_id = '${interrupted.id}'`)).rows[0].publish_state === "uncertain");
check("expired post becomes failed", (await as(A, `select status from public.social_posts where id = '${interrupted.id}'`)).rows[0].status === "failed");
await expectFail("expired worker cannot report success", () => asService(`select public.finish_social_target('${interrupted.id}', '${orgA}', '${socialInt}', '${expiredClaim.lease_token}', 'published', 'id-external', null)`));
const partial = (await saveSocial(orgA, A, null, "scheduled", 3, multiPayload)).rows[0].result;
await asService(`update public.social_posts set scheduled_at = now() - interval '1 minute' where id = '${partial.id}'`);
const partialClaim = (await asService("select * from public.claim_social_posts(1)")).rows[0];
await asService(`select public.start_social_target('${partial.id}', '${orgA}', '${socialInt}', '${partialClaim.lease_token}')`);
await asService(`select public.finish_social_target('${partial.id}', '${orgA}', '${socialInt}', '${partialClaim.lease_token}', 'published', 'ig-id', null)`);
check("partial success remains publishing", (await as(A, `select status from public.social_posts where id = '${partial.id}'`)).rows[0].status === "publishing");
await asService(`select public.start_social_target('${partial.id}', '${orgA}', '${socialFacebook}', '${partialClaim.lease_token}')`);
await asService(`select public.finish_social_target('${partial.id}', '${orgA}', '${socialFacebook}', '${partialClaim.lease_token}', 'failed', null, 'Canal recusou')`);
const partialResult = (await as(A, `select status, external_ids from public.social_posts where id = '${partial.id}'`)).rows[0];
check("partial failure preserves successful external id", partialResult.status === "failed" && partialResult.external_ids.instagram === "ig-id");
const pendingPost = (await saveSocial(orgA, A, null, "scheduled", 4)).rows[0].result;
await asService(`update public.social_posts set scheduled_at = now() - interval '1 minute' where id = '${pendingPost.id}'`);
const pendingClaim = (await asService("select * from public.claim_social_posts(1)")).rows[0];
await asService(`select public.start_social_target('${pendingPost.id}', '${orgA}', '${socialInt}', '${pendingClaim.lease_token}')`);
await asService(`select public.finish_social_target('${pendingPost.id}', '${orgA}', '${socialInt}', '${pendingClaim.lease_token}', 'uncertain', 'remote-id', 'A conferir')`);
check("wrong org cannot reconcile", (await asService(`select public.reconcile_social_target('${pendingPost.id}', '${orgB}', '${socialInt}', 'remote-id', 'published') as ok`)).rows[0].ok === false);
await expectFail("authenticated cannot reconcile", () => as(A, `select public.reconcile_social_target('${pendingPost.id}', '${orgA}', '${socialInt}', 'remote-id', 'published')`));
check("processing result remains uncertain", (await asService(`select public.reconcile_social_target('${pendingPost.id}', '${orgA}', '${socialInt}', 'remote-id', 'pending') as ok`)).rows[0].ok === true && (await as(A, `select publish_state from public.social_post_targets where post_id = '${pendingPost.id}'`)).rows[0].publish_state === "uncertain");
check("read-only confirmation marks post published", (await asService(`select public.reconcile_social_target('${pendingPost.id}', '${orgA}', '${socialInt}', 'remote-id', 'published') as ok`)).rows[0].ok === true && (await as(A, `select status from public.social_posts where id = '${pendingPost.id}'`)).rows[0].status === "published");
check("repeated reconciliation is harmless", (await asService(`select public.reconcile_social_target('${pendingPost.id}', '${orgA}', '${socialInt}', 'remote-id', 'published') as ok`)).rows[0].ok === false);

// Retry somente para falha comprovadamente anterior ao envio visível.
const retryPost = (await saveSocial(orgA, A, null, "scheduled", 5)).rows[0].result;
await asService(`update public.social_posts set scheduled_at = now() - interval '1 minute' where id = '${retryPost.id}'`);
for (let attempt = 1; attempt <= 3; attempt++) {
  const row = (await asService("select * from public.claim_social_posts(1)")).rows[0];
  check(`retry attempt ${attempt} acquired`, row?.id === retryPost.id);
  await asService(`select public.start_social_target('${retryPost.id}', '${orgA}', '${socialInt}', '${row.lease_token}')`);
  await asService(`select public.finish_social_target('${retryPost.id}', '${orgA}', '${socialInt}', '${row.lease_token}', 'retry', null, 'Falha transitória antes do envio')`);
  const target = (await as(A, `select publish_state, attempt_count, next_attempt_at from public.social_post_targets where post_id = '${retryPost.id}'`)).rows[0];
  check(`retry attempt ${attempt} counted`, target.attempt_count === attempt);
  if (attempt < 3) {
    check(`retry ${attempt} waits for backoff`, target.publish_state === "retry_wait" && target.next_attempt_at !== null && (await asService("select * from public.claim_social_posts(1)")).rows.length === 0);
    await expectFail("post with attempted destinations cannot be edited", () => saveSocial(orgA, A, retryPost.id, "draft", 5));
    await asService(`update public.social_posts set retry_after = now() - interval '1 second' where id = '${retryPost.id}'`);
    await asService(`update public.social_post_targets set next_attempt_at = now() - interval '1 second' where post_id = '${retryPost.id}'`);
  } else check("retry exhaustion is terminal", target.publish_state === "failed" && (await as(A, `select status from public.social_posts where id = '${retryPost.id}'`)).rows[0].status === "failed");
}
check("uncertain destination is never auto retried", (await as(A, `select publish_state from public.social_post_targets where post_id = '${interrupted.id}'`)).rows[0].publish_state === "uncertain");
await expectFail("authenticated cannot call manual retry RPC", () => as(A, `select public.request_social_retry('${orgA}', '${A}', '${partial.id}', '${socialFacebook}', true)`));
await expectFail("manual retry rejects non-member", () => asService(`select public.request_social_retry('${orgA}', '${B}', '${partial.id}', '${socialFacebook}', true)`));
await expectFail("manual retry requires acknowledgement", () => asService(`select public.request_social_retry('${orgA}', '${A}', '${partial.id}', '${socialFacebook}', false)`));
check("manual retry schedules only selected unsuccessful destination", (await asService(`select public.request_social_retry('${orgA}', '${A}', '${partial.id}', '${socialFacebook}', true) as ok`)).rows[0].ok === true && (await as(A, `select publish_state from public.social_post_targets where post_id = '${partial.id}' and integration_id = '${socialInt}'`)).rows[0].publish_state === "published");
check("manual retry records who confirmed", (await as(A, `select retry_confirmed_by from public.social_post_targets where post_id = '${partial.id}' and integration_id = '${socialFacebook}'`)).rows[0].retry_confirmed_by === A);
await expectFail("manual retry cannot overwrite active retry", () => asService(`select public.request_social_retry('${orgA}', '${A}', '${partial.id}', '${socialFacebook}', true)`));
await expectFail("manual retry cannot repeat published destination", () => asService(`select public.request_social_retry('${orgA}', '${A}', '${pendingPost.id}', '${socialInt}', true)`));
await expectFail("manual retry cannot exceed attempt limit", () => asService(`select public.request_social_retry('${orgA}', '${A}', '${retryPost.id}', '${socialInt}', true)`));
await asService(`update public.social_post_targets set external_id = 'external-unknown' where post_id = '${interrupted.id}' and integration_id = '${socialInt}'`);
await expectFail("manual retry rejects inconclusive external id", () => asService(`select public.request_social_retry('${orgA}', '${A}', '${interrupted.id}', '${socialInt}', true)`));
const partialRetry = (await saveSocial(orgA, A, null, "scheduled", 6, multiPayload)).rows[0].result;
await asService(`update public.social_posts set scheduled_at = now() - interval '1 minute' where id = '${partialRetry.id}'`);
const firstLease = (await asService("select * from public.claim_social_posts(1)")).rows[0];
await asService(`select public.start_social_target('${partialRetry.id}', '${orgA}', '${socialInt}', '${firstLease.lease_token}')`);
await asService(`select public.finish_social_target('${partialRetry.id}', '${orgA}', '${socialInt}', '${firstLease.lease_token}', 'published', 'ig-published', null)`);
await asService(`select public.start_social_target('${partialRetry.id}', '${orgA}', '${socialFacebook}', '${firstLease.lease_token}')`);
await asService(`select public.finish_social_target('${partialRetry.id}', '${orgA}', '${socialFacebook}', '${firstLease.lease_token}', 'retry', null, 'Falha anterior ao envio')`);
await asService(`update public.social_posts set retry_after = now() - interval '1 second' where id = '${partialRetry.id}'`);
await asService(`update public.social_post_targets set next_attempt_at = now() - interval '1 second' where post_id = '${partialRetry.id}' and publish_state = 'retry_wait'`);
const secondLease = (await asService("select * from public.claim_social_posts(1)")).rows[0];
check("partial retry selects only unpublished target", (await asService(`select integration_id from public.social_post_targets where post_id = '${partialRetry.id}' and publish_state = 'pending'`)).rows.map((row) => row.integration_id).join() === socialFacebook);
await expectFail("published target cannot start again", () => asService(`select public.start_social_target('${partialRetry.id}', '${orgA}', '${socialInt}', '${secondLease.lease_token}')`));
await asService(`select public.start_social_target('${partialRetry.id}', '${orgA}', '${socialFacebook}', '${secondLease.lease_token}')`);
await asService(`select public.finish_social_target('${partialRetry.id}', '${orgA}', '${socialFacebook}', '${secondLease.lease_token}', 'published', 'fb-published', null)`);
check("partial retry finishes without losing first result", (await as(A, `select external_ids from public.social_posts where id = '${partialRetry.id}'`)).rows[0].external_ids.instagram === "ig-published");
