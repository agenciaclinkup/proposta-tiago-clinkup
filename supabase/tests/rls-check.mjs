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

// Confirmação persistente: vínculo de canal, usuário e conversa e consumo único transacional.
const proofHash = "a".repeat(64);
const conversation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
await asService(`insert into public.social_confirmations (organization_id,user_id,channel,conversation_id,operation,proof_hash,payload) values ('${orgA}','${A}','web','${conversation}','weekly','${proofHash}','[${socialPayload}]'::jsonb)`);
await expectFail("confirmation table is private", () => as(A, "select * from public.social_confirmations"));
const confirm = (org, user, channel, conv, hash, limit = 99) => asService(`select public.confirm_social_action('${org}','${user}','${channel}',${conv ? `'${conv}'` : "null"},'${hash}',${limit}) as result`);
await expectFail("confirmation rejects other organization", () => confirm(orgB, B, "web", conversation, proofHash));
await expectFail("confirmation rejects other channel", () => confirm(orgA, A, "telegram", conversation, proofHash));
await expectFail("confirmation rejects other conversation", () => confirm(orgA, A, "web", null, proofHash));
check("confirmation schedules the exact stored plan", (await confirm(orgA, A, "web", conversation, proofHash)).rows[0].result.posts.length === 1);
await expectFail("confirmation cannot be replayed", () => confirm(orgA, A, "web", conversation, proofHash));
const expiredProof = "b".repeat(64);
await asService(`insert into public.social_confirmations (organization_id,user_id,channel,conversation_id,operation,proof_hash,payload,expires_at) values ('${orgA}','${A}','web','${conversation}','weekly','${expiredProof}','[${socialPayload}]'::jsonb,now() - interval '1 second')`);
await expectFail("confirmation expires", () => confirm(orgA, A, "web", conversation, expiredProof));
const quotaProof = "c".repeat(64);
await asService(`insert into public.social_confirmations (organization_id,user_id,channel,conversation_id,operation,proof_hash,payload) values ('${orgA}','${A}','web','${conversation}','weekly','${quotaProof}','[${socialPayload},${socialPayload}]'::jsonb)`);
const beforeQuota = Number((await asService(`select count(*) as n from public.social_posts where organization_id = '${orgA}'`)).rows[0].n);
await expectFail("weekly plan rolls back entirely when quota is exceeded", () => confirm(orgA, A, "web", conversation, quotaProof, 1));
check("failed weekly plan creates no posts", Number((await asService(`select count(*) as n from public.social_posts where organization_id = '${orgA}'`)).rows[0].n) === beforeQuota);
check("failed weekly plan remains unconsumed", (await asService(`select consumed_at from public.social_confirmations where proof_hash = '${quotaProof}'`)).rows[0].consumed_at === null);

const immediate = (await saveSocial(orgA, A, null, "draft", 99)).rows[0].result;
const immediateHash = "d".repeat(64);
await asService(`insert into public.social_confirmations (organization_id,user_id,channel,operation,proof_hash,payload) select '${orgA}','${A}','web','publish_now','${immediateHash}',jsonb_build_object('postId',id,'updatedAt',updated_at) from public.social_posts where id = '${immediate.id}'`);
const claimedNow = (await confirm(orgA, A, "web", null, immediateHash)).rows[0].result;
check("immediate publication reserves a single lease", claimedNow.operation === "publish_now" && claimedNow.postId === immediate.id && claimedNow.leaseToken);
await expectFail("immediate publication cannot be confirmed twice", () => confirm(orgA, A, "web", null, immediateHash));
check("cron cannot claim an immediately reserved post", !(await asService("select * from public.claim_social_posts(10)")).rows.some((row) => row.id === immediate.id));
await asService(`select public.start_social_target('${immediate.id}', '${orgA}', '${socialInt}', '${claimedNow.leaseToken}')`);
await expectFail("immediate destination cannot start twice", () => asService(`select public.start_social_target('${immediate.id}', '${orgA}', '${socialInt}', '${claimedNow.leaseToken}')`));
const changed = (await saveSocial(orgA, A, null, "draft", 99)).rows[0].result;
const changedHash = "e".repeat(64);
await asService(`insert into public.social_confirmations (organization_id,user_id,channel,operation,proof_hash,payload) select '${orgA}','${A}','web','publish_now','${changedHash}',jsonb_build_object('postId',id,'updatedAt',updated_at) from public.social_posts where id = '${changed.id}'`);
await asService(`update public.social_posts set caption = 'alterado' where id = '${changed.id}'`);
await expectFail("immediate confirmation rejects changed content", () => confirm(orgA, A, "web", null, changedHash));
const accountHash = "f".repeat(64);
await asService(`insert into public.social_confirmations (organization_id,user_id,channel,operation,proof_hash,payload) select '${orgA}','${A}','web','publish_now','${accountHash}',jsonb_build_object('postId',id,'updatedAt',updated_at) from public.social_posts where id = '${changed.id}'`);
await asService(`update public.integrations set external_account_id = 'another-account' where id = '${socialInt}'`);
await expectFail("confirmation rejects a changed external account", () => confirm(orgA, A, "web", null, accountHash));

// Agendar rascunho existente (exportação do Estúdio pelo Hermes): atualiza o mesmo post, sem duplicar.
const draftToSchedule = (await saveSocial(orgA, A, null, "draft", 99, JSON.stringify({ format: "feed", caption: "Rascunho", hashtags: [], media: [], scheduled_at: null, targets: [] }))).rows[0].result;
const scheduleHash = "1".repeat(64);
const insertSchedule = (hash, post) => asService(`insert into public.social_confirmations (organization_id,user_id,channel,conversation_id,operation,proof_hash,payload) select '${orgA}','${A}','telegram','${conversation}','schedule_post','${hash}',jsonb_build_object('postId',id,'updatedAt',updated_at,'post','${socialPayload}'::jsonb) from public.social_posts where id = '${post}'`);
await insertSchedule(scheduleHash, draftToSchedule.id);
check("schedule confirmation snapshots the chosen account", Object.keys((await asService(`select integration_snapshot from public.social_confirmations where proof_hash = '${scheduleHash}'`)).rows[0].integration_snapshot).join() === socialInt);
const postsBeforeSchedule = Number((await asService(`select count(*) as n from public.social_posts where organization_id = '${orgA}'`)).rows[0].n);
await expectFail("schedule confirmation rejects other user", () => confirm(orgA, B, "telegram", conversation, scheduleHash));
const scheduledDraft = (await confirm(orgA, A, "telegram", conversation, scheduleHash)).rows[0].result;
check("schedule confirmation updates the same draft", scheduledDraft.operation === "schedule_post" && scheduledDraft.post.id === draftToSchedule.id && scheduledDraft.post.status === "scheduled");
check("schedule confirmation creates no extra post", Number((await asService(`select count(*) as n from public.social_posts where organization_id = '${orgA}'`)).rows[0].n) === postsBeforeSchedule);
await expectFail("schedule confirmation cannot be replayed", () => confirm(orgA, A, "telegram", conversation, scheduleHash));
const editedDraft = (await saveSocial(orgA, A, null, "draft", 99, JSON.stringify({ format: "feed", caption: "Outro", hashtags: [], media: [], scheduled_at: null, targets: [] }))).rows[0].result;
const editedHash = "2".repeat(64);
await insertSchedule(editedHash, editedDraft.id);
await asService(`update public.social_posts set caption = 'mudou' where id = '${editedDraft.id}'`);
await expectFail("schedule confirmation rejects a changed draft", () => confirm(orgA, A, "telegram", conversation, editedHash));
const quotaDraft = (await saveSocial(orgA, A, null, "draft", 99, JSON.stringify({ format: "feed", caption: "Cota", hashtags: [], media: [], scheduled_at: null, targets: [] }))).rows[0].result;
const quotaScheduleHash = "3".repeat(64);
await insertSchedule(quotaScheduleHash, quotaDraft.id);
await expectFail("schedule confirmation respects the monthly quota", () => confirm(orgA, A, "telegram", conversation, quotaScheduleHash, 0));
check("failed schedule keeps the draft and the confirmation", (await asService(`select p.status, c.consumed_at from public.social_posts p, public.social_confirmations c where p.id = '${quotaDraft.id}' and c.proof_hash = '${quotaScheduleHash}'`)).rows[0].status === "draft");

// Estúdio: gravações transacionais, isolamento e cobrança idempotente de geração.
const studioBucket = (await db.query(`select public, file_size_limit from storage.buckets where id = 'studio-assets'`)).rows[0];
check("studio asset bucket is private", studioBucket?.public === false && Number(studioBucket.file_size_limit) === 52428800);
const studioPayload = JSON.stringify({ title: "Campanha", status: "draft", theme: {}, slides: [{ role: "hook", heading: "Olá", body: "", imagePath: null }] });
const studio = (await asService(`select public.save_studio_carousel('${orgA}', '${A}', null, 'manual', '${studioPayload}'::jsonb) as result`)).rows[0].result;
check("members read their carousel and slides", (await as(A, `select * from public.studio_slides where carousel_id = '${studio.id}'`)).rows.length === 1);
const badStudio = JSON.stringify({ title: "Alterado", status: "draft", theme: {}, slides: [{ role: "hook", heading: "x", body: "", imagePath: `${orgB}/foreign.png` }] });
await expectFail("database rejects another tenant's slide asset", () => asService(`select public.save_studio_carousel('${orgA}','${A}','${studio.id}','manual','${badStudio}'::jsonb)`));
check("invalid slide update rolls back title and slides", (await as(A, `select title from public.carousels where id='${studio.id}'`)).rows[0].title === "Campanha" && (await as(A, `select * from public.studio_slides where carousel_id='${studio.id}'`)).rows.length === 1);
check("another organization cannot read studio data", (await as(B, `select * from public.carousels`)).rows.length === 0 && (await as(B, `select * from public.studio_slides`)).rows.length === 0);
await expectFail("users cannot bypass studio service", () => as(A, `insert into public.carousels (organization_id, title, created_via) values ('${orgA}', 'x', 'manual')`));
await expectFail("nonmember cannot mutate carousel", () => asService(`select public.save_studio_carousel('${orgA}', '${B}', '${studio.id}', 'hermes', '${studioPayload}'::jsonb)`));
await expectFail("slide cannot reference carousel of another tenant", () => asService(`insert into public.studio_slides (organization_id,carousel_id,position,role) values ('${orgB}','${studio.id}',1,'hook')`));
const generationId = "30000000-0000-4000-8000-000000000001";
const generation = (id, org, user, carousel, limit) => asService(`select public.begin_studio_generation('${org}', '${user}', '${id}', '${carousel}', 'carousel', 'Criar conteúdo', 'manual', ${limit}) as result`);
const usageBefore = Number((await asService(`select used from public.usage_counters where organization_id = '${orgA}' and metric = 'ai_credits'`)).rows[0].used);
const firstGeneration = (await generation(generationId, orgA, A, studio.id, usageBefore + 1)).rows[0].result;
const replayGeneration = (await generation(generationId, orgA, A, studio.id, usageBefore + 1)).rows[0].result;
check("generation replay is explicitly identified", firstGeneration.created === true && replayGeneration.created === false);
await expectFail("idempotency key cannot be reused for another prompt", () => asService(`select public.begin_studio_generation('${orgA}','${A}','${generationId}','${studio.id}','carousel','Outro pedido','manual',999)`));
check("generation replay does not charge twice", Number((await asService(`select used from public.usage_counters where organization_id = '${orgA}' and metric = 'ai_credits'`)).rows[0].used) === usageBefore + 1);
await expectFail("generation limit blocks a new request", () => generation('30000000-0000-4000-8000-000000000002', orgA, A, studio.id, usageBefore + 1));
await expectFail("generation cannot reference another tenant's carousel", () => generation('30000000-0000-4000-8000-000000000003', orgB, B, studio.id, 100));
check("generation history isolated", (await as(B, `select * from public.studio_generations`)).rows.length === 0);
await expectFail("other user cannot finalize generation", () => asService(`select public.finish_studio_generation('${orgA}','${B}','${generationId}','succeeded','{}'::jsonb,null)`));
await asService(`select public.finish_studio_generation('${orgA}','${A}','${generationId}','failed',null,'Falha na geração')`);
check("failed generation refunds the original period exactly once", Number((await asService(`select used from public.usage_counters where organization_id = '${orgA}' and metric = 'ai_credits'`)).rows[0].used) === usageBefore && (await as(A, `select credit_refunded from public.studio_generations where id = '${generationId}'`)).rows[0].credit_refunded === true);
await expectFail("generation cannot finish twice", () => asService(`select public.finish_studio_generation('${orgA}','${A}','${generationId}','failed',null,'Falha na geração')`));
check("replayed failure does not refund twice", Number((await asService(`select used from public.usage_counters where organization_id = '${orgA}' and metric = 'ai_credits'`)).rows[0].used) === usageBefore);
const oldGeneration = '30000000-0000-4000-8000-000000000004';
await generation(oldGeneration, orgA, A, studio.id, usageBefore + 1);
await asService(`update public.studio_generations set period_start = '2020-01-01' where id = '${oldGeneration}'`);
await asService(`insert into public.usage_counters (organization_id,metric,period_start,used) values ('${orgA}','ai_credits','2020-01-01',1)`);
await asService(`select public.finish_studio_generation('${orgA}','${A}','${oldGeneration}','failed',null,'Falha')`);
check("refund uses the generation period, not the current month", Number((await asService(`select used from public.usage_counters where organization_id = '${orgA}' and metric = 'ai_credits' and period_start = '2020-01-01'`)).rows[0].used) === 0 && Number((await asService(`select used from public.usage_counters where organization_id = '${orgA}' and metric = 'ai_credits' and period_start <> '2020-01-01'`)).rows[0].used) === usageBefore + 1);
await expectFail("landing cannot link another tenant's funnel", () => asService(`insert into public.landing_pages (organization_id,title,slug,sections,pipeline_id,stage_id,created_via) select '${orgB}','Página','pagina','[]'::jsonb,pipeline_id,id,'manual' from public.crm_stages where organization_id='${orgA}' limit 1`));
const landingPayload = JSON.stringify({ title: "Página", slug: "pagina", sections: [], pipelineId: null, stageId: null, published: false });
await asService(`select public.save_studio_landing('${orgA}','${A}',null,'manual','${landingPayload}'::jsonb)`);
await expectFail("landing slugs are unique per organization", () => asService(`select public.save_studio_landing('${orgA}','${A}',null,'manual','${landingPayload}'::jsonb)`));
await asService(`select public.save_studio_landing('${orgB}','${B}',null,'manual','${landingPayload}'::jsonb)`);
check("landing pages remain isolated", (await as(A, `select * from public.landing_pages`)).rows.length === 1 && (await as(B, `select * from public.landing_pages`)).rows.length === 1);

// Captura pública nunca confia em IDs ou limites recebidos do visitante.
const landingStageA = (await asService(`select id,pipeline_id from public.crm_stages where organization_id='${orgA}' order by position limit 1`)).rows[0];
await asService(`update public.landing_pages set published=true,pipeline_id='${landingStageA.pipeline_id}',stage_id='${landingStageA.id}',sections='[{"type":"form","heading":"Contato","body":"","imagePath":null}]'::jsonb where organization_id='${orgA}' and slug='pagina'`);
const lpLimits = JSON.stringify({ starter: 1000, growth: 10000, scale: 100000 });
const capture = (org, slug, limits = lpLimits) => asService(`select public.capture_landing_lead('${org}','${slug}','Ana','ana@example.com',null,'Olá','${limits}'::jsonb) as ok`);
await expectFail("anonymous cannot execute capture transaction", () => as(A, `select public.capture_landing_lead('clinkup-abc','pagina','Ana','ana@example.com',null,'Olá','${lpLimits}'::jsonb)`));
check("published landing captures lead", (await capture('clinkup-abc','pagina')).rows[0].ok === true);
const captured = (await as(A, `select id,stage_id,source from public.crm_leads where email='ana@example.com'`)).rows[0];
check("lead has configured stage and source", captured?.stage_id === landingStageA.id && captured?.source === 'landing_page');
check("lead has initial activity", (await as(A, `select * from public.crm_activities where lead_id='${captured.id}'`)).rows.length === 1);
check("unpublished landing cannot capture", (await capture('clinkup-abc','missing')).rows[0].ok === false);
check("limit blocks capture", (await capture('clinkup-abc','pagina', '{"starter":0,"growth":0,"scale":0}')).rows[0].ok === false);
await asService(`update public.landing_pages set published=false where organization_id='${orgA}' and slug='pagina'`);
check("draft landing rejects direct submissions", (await capture('clinkup-abc','pagina')).rows[0].ok === false);
await asService(`update public.landing_pages set published=true,stage_id=null,pipeline_id=null where organization_id='${orgA}' and slug='pagina'`);
check("landing without configured stage rejects submissions", (await capture('clinkup-abc','pagina')).rows[0].ok === false);
check("other tenant's same slug cannot capture a draft", (await capture('outra-empresa','pagina')).rows[0].ok === false);

// Fase 7: reserva idempotente, deduplicação, isolamento e transferência ao CRM.
const searchId = '40000000-0000-4000-8000-000000000001';
const beginSearch = (org, user, id, limit = 10) => asService(`select public.begin_lead_search('${org}','${user}','${id}','Dentista','Recife',10,2,'manual',${limit}) as result`);
await expectFail("authenticated cannot start search directly", () => as(A, `select public.begin_lead_search('${orgA}','${A}','${searchId}','Dentista','Recife',10,2,'manual',10)`));
const startedSearch = (await beginSearch(orgA, A, searchId)).rows[0].result;
const repeatSearch = (await beginSearch(orgA, A, searchId)).rows[0].result;
check("search replay is idempotent", startedSearch.created === true && repeatSearch.created === false);
await expectFail("nonmember cannot start search", () => beginSearch(orgA, B, '40000000-0000-4000-8000-000000000006'));
await expectFail("request ID cannot change query", () => asService(`select public.begin_lead_search('${orgA}','${A}','${searchId}','Outro','Recife',10,2,'manual',10)`));
check("search hidden from other tenant", (await as(B, `select * from public.lead_searches`)).rows.length === 0);
const results = JSON.stringify([{ placeId: 'place-1', name: 'Clínica', category: null, address: null, city: null, phone: null, whatsapp: null, email: null, website: null, instagram: null, rating: null }, { placeId: 'place-1', name: 'Duplicada', category: null, address: null, city: null, phone: null, whatsapp: null, email: null, website: null, instagram: null, rating: null }]);
const completed = (await asService(`select public.finish_lead_search('${orgA}','${A}','${searchId}','succeeded','${results}'::jsonb) as result`)).rows[0].result;
check("duplicate results are charged only once", completed.results_count === 1);
check("prospect hidden from another tenant", (await as(B, `select * from public.scraped_leads`)).rows.length === 0);
check("search associations hidden from another tenant", (await as(B, `select * from public.lead_search_results`)).rows.length === 0);
const prospect = (await as(A, `select id from public.scraped_leads where organization_id='${orgA}' and place_id='place-1'`)).rows[0];
await expectFail("other tenant cannot transfer prospect", () => asService(`select public.send_scraped_lead_to_crm('${orgB}','${B}','${prospect.id}',null,'manual',1000)`));
const sent = (await asService(`select public.send_scraped_lead_to_crm('${orgA}','${A}','${prospect.id}',null,'manual',1000) as result`)).rows[0].result;
const sentAgain = (await asService(`select public.send_scraped_lead_to_crm('${orgA}','${A}','${prospect.id}',null,'manual',1000) as result`)).rows[0].result;
check("CRM transfer is idempotent", sent.id === sentAgain.id && (await as(A, `select * from public.crm_activities where lead_id='${sent.id}'`)).rows.length === 1);
const secondSearchId = '40000000-0000-4000-8000-000000000002';
const beforeRepeat = Number((await asService(`select used from public.usage_counters where organization_id='${orgA}' and metric='scraped_leads'`)).rows[0].used);
await beginSearch(orgA, A, secondSearchId);
await asService(`update public.scraped_leads set phone='11999990000' where id='${prospect.id}'`);
const enrichment = JSON.stringify([{ placeId: 'place-1', name: 'Alterado', email: 'contato@example.com', phone: '11888880000' }]);
const again = (await asService(`select public.finish_lead_search('${orgA}','${A}','${secondSearchId}','succeeded','${enrichment}'::jsonb) as result`)).rows[0].result;
check("existing results remain associated without another charge", again.results_count === 1 && again.charged_count === 0 && (await as(A, `select * from public.lead_search_results where search_id='${secondSearchId}'`)).rows.length === 1 && Number((await asService(`select used from public.usage_counters where organization_id='${orgA}' and metric='scraped_leads'`)).rows[0].used) === beforeRepeat);
const enriched = (await as(A, `select name,email,phone from public.scraped_leads where id='${prospect.id}'`)).rows[0];
check("enrichment fills blanks without overwriting existing data", enriched.name === 'Clínica' && enriched.email === 'contato@example.com' && enriched.phone === '11999990000');
const orgBSearchId = '40000000-0000-4000-8000-000000000005';
await beginSearch(orgB, B, orgBSearchId);
await expectFail("cannot link search results across tenants", () => asService(`insert into public.lead_search_results(organization_id,search_id,scraped_lead_id) values('${orgB}','${orgBSearchId}','${prospect.id}')`));
await asService(`select public.finish_lead_search('${orgB}','${B}','${orgBSearchId}','succeeded','${results}'::jsonb)`);
const prospectB = (await as(B, `select id from public.scraped_leads where organization_id='${orgB}' and place_id='place-1'`)).rows[0].id;
await expectFail("CRM limit blocks prospect transfer", () => asService(`select public.send_scraped_lead_to_crm('${orgB}','${B}','${prospectB}',null,'manual',0)`));
await expectFail("other organization's stage is rejected", () => asService(`select public.send_scraped_lead_to_crm('${orgB}','${B}','${prospectB}','${landingStageA.id}','manual',1000)`));
check("failed transfers do not change prospect", (await as(B, `select status from public.scraped_leads where id='${prospectB}'`)).rows[0].status === 'new');
const staleId = '40000000-0000-4000-8000-000000000003';
await beginSearch(orgA, A, staleId);
await asService(`update public.lead_searches set created_at=now()-interval '16 minutes' where id='${staleId}'`);
const recovered = (await asService(`select public.recover_lead_search('${orgA}','${A}','${staleId}') as result`)).rows[0].result;
check("stale search releases reservation once", recovered.status === 'failed' && Number((await asService(`select used from public.usage_counters where organization_id='${orgA}' and metric='scraped_leads'`)).rows[0].used) === beforeRepeat);
await asService(`select public.recover_lead_search('${orgA}','${A}','${staleId}')`);
check("recovery cannot refund twice", Number((await asService(`select used from public.usage_counters where organization_id='${orgA}' and metric='scraped_leads'`)).rows[0].used) === beforeRepeat);
await expectFail("quota prevents over-reservation", () => beginSearch(orgA, A, '40000000-0000-4000-8000-000000000004', beforeRepeat));
const previousPeriodSearch = '40000000-0000-4000-8000-000000000007';
await beginSearch(orgA, A, previousPeriodSearch);
await asService(`update public.lead_searches set period_start='2019-01-01',created_at=now()-interval '16 minutes' where id='${previousPeriodSearch}'`);
await asService(`insert into public.usage_counters(organization_id,metric,period_start,used) values('${orgA}','scraped_leads','2019-01-01',2)`);
await asService(`select public.recover_lead_search('${orgA}','${A}','${previousPeriodSearch}')`);
check("expired search refunds original month", Number((await asService(`select used from public.usage_counters where organization_id='${orgA}' and metric='scraped_leads' and period_start='2019-01-01'`)).rows[0].used) === 0 && Number((await asService(`select used from public.usage_counters where organization_id='${orgA}' and metric='scraped_leads' and period_start<>'2019-01-01'`)).rows[0].used) === beforeRepeat + 2);

const b2bSearchId = '40000000-0000-4000-8000-000000000008';
await beginSearch(orgA, A, b2bSearchId, 100);
const provenanceHash = 'a'.repeat(64);
const recordSource = (org, user, hash = provenanceHash) => asService(`select public.record_prospect_source('${org}','${user}','${b2bSearchId}','import','Base própria','Contrato','${hash}') as ok`);
await expectFail("authenticated cannot forge B2B source", () => as(A, `select public.record_prospect_source('${orgA}','${A}','${b2bSearchId}','import','Base própria','Contrato','${provenanceHash}')`));
await expectFail("other tenant cannot declare source", () => recordSource(orgB, B));
check("authorized source recorded", (await recordSource(orgA, A)).rows[0].ok === true);
check("other tenant cannot read B2B source", (await as(B, `select * from public.prospect_sources`)).rows.length === 0);
await expectFail("idempotency key cannot change B2B contents", () => recordSource(orgA, A, 'b'.repeat(64)));

// Fase 7.3: confirmação persistente e transacional de transferência de prospecção ao CRM pelo Hermes.
const prospectStageB = (await asService(`select id, pipeline_id from public.crm_stages where organization_id = '${orgB}' order by position limit 1`)).rows[0];
const confirmProspectConv = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const prospectProof1 = '4'.repeat(64);
await expectFail("prospect confirmation rejects another organization's stage", () =>
  asService(`insert into public.prospect_confirmations(organization_id,user_id,channel,conversation_id,proof_hash,pipeline_id,stage_id,prospect_ids) values('${orgB}','${B}','telegram','${confirmProspectConv}','${prospectProof1}','${landingStageA.pipeline_id}','${landingStageA.id}',array['${prospectB}']::uuid[])`)
);
await asService(`insert into public.prospect_confirmations(organization_id,user_id,channel,conversation_id,proof_hash,pipeline_id,stage_id,prospect_ids) values('${orgB}','${B}','telegram','${confirmProspectConv}','${prospectProof1}','${prospectStageB.pipeline_id}','${prospectStageB.id}',array['${prospectB}']::uuid[])`);
await expectFail("prospect confirmation table is private", () => as(B, `select * from public.prospect_confirmations`));
const confirmProspect = (org, user, channel, conv, hash, limit = 1000) =>
  asService(`select public.confirm_prospect_transfer('${org}','${user}','${channel}',${conv ? `'${conv}'` : 'null'},'${hash}',${limit}) as result`);
await expectFail("authenticated cannot call confirm_prospect_transfer directly", () => as(B, `select public.confirm_prospect_transfer('${orgB}','${B}','telegram','${confirmProspectConv}','${prospectProof1}',1000)`));
await expectFail("prospect confirmation rejects other organization", () => confirmProspect(orgA, A, 'telegram', confirmProspectConv, prospectProof1));
await expectFail("prospect confirmation rejects other channel", () => confirmProspect(orgB, B, 'web', confirmProspectConv, prospectProof1));
await expectFail("prospect confirmation rejects other conversation", () => confirmProspect(orgB, B, 'telegram', null, prospectProof1));
await expectFail("prospect confirmation rolls back when CRM limit is exceeded", () => confirmProspect(orgB, B, 'telegram', confirmProspectConv, prospectProof1, 0));
check("failed prospect confirmation remains unconsumed", (await asService(`select consumed_at from public.prospect_confirmations where proof_hash='${prospectProof1}'`)).rows[0].consumed_at === null);
const transferred = (await confirmProspect(orgB, B, 'telegram', confirmProspectConv, prospectProof1, 1000)).rows[0].result;
check("prospect confirmation transfers selected leads atomically", transferred.transferredCount === 1 && transferred.stageId === prospectStageB.id && (await as(B, `select status from public.scraped_leads where id='${prospectB}'`)).rows[0].status === 'sent_to_crm');
await expectFail("prospect confirmation cannot be replayed", () => confirmProspect(orgB, B, 'telegram', confirmProspectConv, prospectProof1, 1000));
const expiredProspectProof = '5'.repeat(64);
await asService(`insert into public.prospect_confirmations(organization_id,user_id,channel,conversation_id,proof_hash,pipeline_id,stage_id,prospect_ids,expires_at) values('${orgB}','${B}','telegram','${confirmProspectConv}','${expiredProspectProof}','${prospectStageB.pipeline_id}','${prospectStageB.id}',array['${prospectB}']::uuid[],now() - interval '1 second')`);
await expectFail("expired prospect confirmation is rejected", () => confirmProspect(orgB, B, 'telegram', confirmProspectConv, expiredProspectProof, 1000));

// Fase 8.1: Meta Ads — isolamento multi-tenant, FKs compostas, teto financeiro e confirmação persistente.
const metaAdsIntA = (await asService(`insert into public.integrations(organization_id,provider,status,external_account_id,display_name) values('${orgA}','meta_ads','connected','act_1001','Conta A') returning id`)).rows[0].id;
await expectFail("ad account rejects another tenant's meta_ads integration", () =>
  asService(`insert into public.meta_ad_accounts(organization_id,integration_id,external_ad_account_id,name) values('${orgB}','${metaAdsIntA}','act_1001','Cross Tenant')`)
);
const adAccA = (await asService(`insert into public.meta_ad_accounts(organization_id,integration_id,external_ad_account_id,name) values('${orgA}','${metaAdsIntA}','act_1001','Conta A') returning id`)).rows[0].id;
check("member reads own meta ad account", (await as(A, `select * from public.meta_ad_accounts where id='${adAccA}'`)).rows.length === 1);
check("other tenant cannot read meta ad account", (await as(B, `select * from public.meta_ad_accounts`)).rows.length === 0);
await expectFail("member cannot mutate meta ad account directly", () => as(A, `update public.meta_ad_accounts set daily_budget_cap_cents=99999 where id='${adAccA}'`));
await expectFail("ad action confirmations table is private", () => as(A, `select * from public.ad_action_confirmations`));

const adConv = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const adProofNoCap = '6'.repeat(64);
const adPayload = JSON.stringify({ adAccountId: adAccA, requestId: '70000000-0000-4000-8000-000000000001', name: 'Campanha A', objective: 'OUTCOME_LEADS', dailyBudgetCents: 5000, initialStatus: 'active' });
await asService(`insert into public.ad_action_confirmations(organization_id,user_id,channel,conversation_id,ad_account_id,operation,proof_hash,payload) values('${orgA}','${A}','web','${adConv}','${adAccA}','create_campaign','${adProofNoCap}','${adPayload}'::jsonb)`);
const confirmAd = (org, user, channel, conv, hash, maxActive = 20) =>
  asService(`select public.consume_ad_action_confirmation('${org}','${user}','${channel}',${conv ? `'${conv}'` : 'null'},'${hash}',${maxActive}) as result`);
await expectFail("authenticated cannot call consume_ad_action_confirmation", () => as(A, `select public.consume_ad_action_confirmation('${orgA}','${A}','web','${adConv}','${adProofNoCap}',20)`));
await expectFail("ad confirmation blocked when budget cap is zero", () => confirmAd(orgA, A, 'web', adConv, adProofNoCap, 20));
await asService(`update public.meta_ad_accounts set daily_budget_cap_cents=4000, monthly_budget_cap_cents=120000 where id='${adAccA}'`);
await expectFail("ad confirmation blocked when daily budget exceeds cap", () => confirmAd(orgA, A, 'web', adConv, adProofNoCap, 20));
await asService(`update public.meta_ad_accounts set daily_budget_cap_cents=10000, monthly_budget_cap_cents=120000 where id='${adAccA}'`);
await expectFail("ad confirmation blocked when projected monthly spend exceeds monthly cap", () => confirmAd(orgA, A, 'web', adConv, adProofNoCap, 20));
await asService(`update public.meta_ad_accounts set daily_budget_cap_cents=10000, monthly_budget_cap_cents=300000 where id='${adAccA}'`);
await expectFail("ad confirmation blocked when plan active campaign limit is 0", () => confirmAd(orgA, A, 'web', adConv, adProofNoCap, 0));
await expectFail("ad confirmation rejects other organization", () => confirmAd(orgB, B, 'web', adConv, adProofNoCap, 20));
const adConsumed = (await confirmAd(orgA, A, 'web', adConv, adProofNoCap, 20)).rows[0].result;
check("ad confirmation succeeds within caps and returns account binding", adConsumed.operation === 'create_campaign' && adConsumed.adAccountId === adAccA && adConsumed.externalAdAccountId === 'act_1001');
await expectFail("ad confirmation cannot be replayed", () => confirmAd(orgA, A, 'web', adConv, adProofNoCap, 20));

const adCampA = (await asService(`insert into public.ad_campaigns(organization_id,ad_account_id,integration_id,external_campaign_id,name,objective,daily_budget_cents,status,created_via) values('${orgA}','${adAccA}','${metaAdsIntA}','ext_c1','Campanha A','OUTCOME_LEADS',5000,'active','manual') returning id`)).rows[0].id;
await expectFail("ad set cannot reference campaign of another tenant", () =>
  asService(`insert into public.ad_sets(organization_id,campaign_id,external_ad_set_id,name) values('${orgB}','${adCampA}','ext_s1','Cross')`)
);
const adSetA = (await asService(`insert into public.ad_sets(organization_id,campaign_id,external_ad_set_id,name) values('${orgA}','${adCampA}','ext_s1','Conjunto 1') returning id`)).rows[0].id;
await asService(`insert into public.ad_ads(organization_id,ad_set_id,external_ad_id,name) values('${orgA}','${adSetA}','ext_ad1','Anuncio 1')`);
await asService(`insert into public.ad_metric_snapshots(organization_id,campaign_id,date_start,date_stop,spend_cents,impressions,clicks,leads,roas) values('${orgA}','${adCampA}','2026-11-01','2026-11-20',12000,4000,150,10,2.5)`);
await asService(`insert into public.ad_action_logs(organization_id,ad_account_id,campaign_id,action,actor_id,via,status) values('${orgA}','${adAccA}','${adCampA}','create_campaign','${A}','manual','succeeded')`);
check("other tenant sees zero meta ads campaigns, sets, ads, snapshots and logs",
  (await as(B, `select * from public.ad_campaigns`)).rows.length === 0 &&
  (await as(B, `select * from public.ad_sets`)).rows.length === 0 &&
  (await as(B, `select * from public.ad_ads`)).rows.length === 0 &&
  (await as(B, `select * from public.ad_metric_snapshots`)).rows.length === 0 &&
  (await as(B, `select * from public.ad_action_logs`)).rows.length === 0
);
