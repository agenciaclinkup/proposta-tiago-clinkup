# CLINKUP HERMES PLATFORM — Arquitetura

## 1. Visão geral

```
┌──────────────── Next.js 15 (App Router) ────────────────┐
│  UI (RSC + Client)      Server Actions   Route Handlers  │
│        │                     │           │  /api/hermes  │
│        └──────────┬──────────┘           │  /api/telegram│
│                   ▼                      │  /api/webhooks│
│        lib/services/<domínio>.ts  ◄──────┘  /api/cron    │
│        (lógica única: manual + Hermes)                    │
│                   │                                       │
│        lib/hermes/tools.ts (Vercel AI SDK tools =         │
│        wrappers finos dos services, mesmos schemas Zod)   │
└───────────────────┼──────────────────────────────────────┘
                    ▼
     Supabase: Postgres + RLS · Auth · Storage · Realtime · Cron
                    │
     Externos: Stripe/Asaas · Meta Graph/Ads · Google (GBP, Calendar,
               Places) · Telegram Bot API · n8n/BootConversa · LLM
```

### Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Planos | `starter`, `growth`, `scale` (Scale = Enterprise/Agency, inclui White-Label) | Spec cita duas nomenclaturas; unificado. |
| Billing | Stripe na Fase 1; adaptador Asaas (Pix/boleto) na Fase 8 | Stripe tem checkout + webhooks prontos; `subscriptions.provider` já prevê os dois. |
| Catálogo de planos | Código (`config/plans.ts`), não tabela | Limites versionados com o código; White-Label edita o arquivo. |
| Tenancy | `organization_members` (N:N user↔org) | Plano Scale/Agency gerencia vários clientes com um login. |
| Fila de postagens | Supabase Cron (pg_cron + pg_net) chama `/api/cron/publish` a cada minuto; jobs lidos com `FOR UPDATE SKIP LOCKED` | Sem Redis no SaaS; no White-Label o mesmo endpoint roda por cron do container. BullMQ só se o volume exigir. |
| IA | Vercel AI SDK; Anthropic por padrão, OpenAI opcional via env | Function calling nativo nos dois. |
| Tokens OAuth | `integration_secrets` cifrado (AES-256-GCM, chave `VAULT_ENCRYPTION_KEY`, `lib/vault.ts`), sem grant para `authenticated` | Token nunca chega ao browser. |
| Auth | Supabase Auth (e-mail/senha + callback PKCE `/auth/callback`) | Padrão `@supabase/ssr`. |
| Bot do Telegram | Híbrido: **SaaS** usa o bot único da plataforma (`TELEGRAM_BOT_TOKEN`, webhook `/api/webhooks/telegram`, vínculo por `/vincular CODIGO`); **White-Label/Enterprise** cadastra o próprio bot (token cifrado em `integration_secrets`, webhook dinâmico `/api/webhooks/telegram/[slug]`, `slug` da organização) | Decisão do produto (2026-11-18): rapidez no SaaS e marca própria no White-Label. |
| Transcrição de áudio | OpenAI Whisper (`whisper-1`, `OPENAI_API_KEY`) por padrão; Groq (`GROQ_API_KEY`) quando configurado | Decisão do produto (2026-11-18). Áudio é transcrito antes de chegar ao Hermes. |
| Sessão | `middleware.ts` + `getClaims()` | Next 15 não executa `proxy.ts`. |

## 2. Schema PostgreSQL

Convenções: `id uuid default gen_random_uuid()`, `created_at/updated_at timestamptz`, `organization_id uuid not null references organizations on delete cascade`, RLS habilitado em todas, `GRANT` explícito para `authenticated`. Helpers `SECURITY DEFINER` ficam no schema `private` (não exposto).

### Fundação (Fase 1)

**organizations**
| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| name | text | |
| slug | text unique | |
| niche | text | |
| plan_id | text | espelho de `subscriptions.plan_id` (leitura rápida) |
| is_white_label | boolean | licença dedicada liberada pelo admin |
| onboarding_completed_at | timestamptz | null = wizard pendente |
| created_by | uuid → auth.users | |

**organization_members** — `(organization_id, user_id)` pk, `role` enum `owner|admin|member`.

**profiles** — `id` pk → auth.users, `full_name`, `avatar_url`, `current_organization_id`, `is_super_admin` (sem grant de update para `authenticated`). Criado por trigger em `auth.users`.

**brand_context** — `organization_id` pk, `company_name`, `niche`, `products_services`, `average_ticket numeric`, `target_audience`, `differentiators`, `tone_of_voice`, `visual_identity jsonb` (`primary_color`, `secondary_color`, `logo_url`, `style_notes`), `master_context text` (Contexto Mestre consolidado para prompts).

**subscriptions** — `organization_id` unique, `plan_id`, `status` enum `trialing|active|past_due|canceled|incomplete`, `provider` (`stripe|asaas|manual`), `provider_customer_id`, `provider_subscription_id`, `current_period_end`, `trial_ends_at`, `cancel_at_period_end`. Leitura por membros; escrita só service role (webhook).

### Hermes (Fase 2)

**hermes_logs** — `organization_id`, `user_id`, `channel` (`web|telegram|webhook|system`), `via` (`manual|hermes`), `tool_name`, `input jsonb`, `output jsonb`, `status` (`success|error`), `error`, `duration_ms`. Alimenta "Atividades recentes". Só leitura para membros; gravação via service role (`lib/services/hermes-log.ts`).

**hermes_conversations / hermes_messages** — histórico do chat (web e Telegram). Conversa privada do usuário na org (`user_id` = `auth.uid()` por default, sem grant de coluna). Mensagens (`message_id` do AI SDK, `role`, `parts jsonb`) só o servidor grava: o cliente envia apenas a nova mensagem de texto e o histórico enviado ao modelo vem do banco, impedindo forjar respostas do assistente ou resultados de Tools.

**usage_counters** — `(organization_id, metric, period_start)` pk, `used`. Métricas mensais: `ai_credits`, `scraped_leads`, `scheduled_posts` (conexões = contagem de `integrations`, não contador). Consumo atômico por `public.consume_usage(org, metric, amount, limit)` (execute só service_role; mês em America/Sao_Paulo), chamado por `lib/services/usage.ts` com o limite de `config/plans.ts`. Estorno por `public.refund_usage(org, metric, amount)` (nunca abaixo de zero; usado quando a resposta do Hermes falha depois da cobrança).

### Integrações (Fase 3)

**integrations** — `organization_id`, `provider` enum (`instagram|facebook_page|meta_ads|google_business|google_calendar|telegram`), `status` (`connected|needs_attention|disconnected`), `external_account_id`, `display_name`, `scopes text[]`, `metadata jsonb` (ex.: `business_id`, `ad_account_id`, `pixel_id`, `chat_id`), `connected_by`. Unique `(organization_id, provider, external_account_id)`. Membros leem; só owner/admin excluem (desconectar); inserção/atualização só pelo servidor (`saveIntegration` em `lib/services/integrations.ts`, após callback OAuth ou webhook validado).

**integration_secrets** — `integration_id` pk, `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`, `organization_id`. Sem grants para `anon/authenticated`. `CHECK` exige o formato do cofre (`v1:iv:tag:ct`): o banco recusa token em texto puro. AAD da cifra = `integration_id`.

**telegram_link_codes** — `code` pk, `organization_id`, `user_id`, `expires_at` (10 min), `used_at`. Código de 8 caracteres `[A-Z0-9]`, gerado só pelo servidor; usuário lê apenas os próprios. Consumo atômico e de uso único por `public.consume_telegram_link_code(code)` (execute só service_role), chamado pelo webhook no comando `/vincular CODIGO`.

### CRM (Fase 4)

**crm_pipelines** — `organization_id`, `name`, `is_default`.
**crm_stages** — `pipeline_id`, `organization_id`, `name`, `position`, `color`, `kind` (`open|won|lost`). Seed: Novo Lead, Qualificado por IA, Reunião Agendada, Proposta Enviada, Fechado.
**crm_leads** — `organization_id`, `pipeline_id`, `stage_id`, `position`, `name`, `company`, `email`, `phone`, `whatsapp`, `instagram`, `website`, `source` (`manual|scraping|landing_page|hermes|webhook`), `value numeric`, `ai_score int`, `owner_id`, `scraped_lead_id`, `next_meeting_at`, `google_event_id`, `notes`.
**crm_activities** — `lead_id`, `organization_id`, `type` (`note|stage_change|meeting|message|ai_action`), `content`, `metadata jsonb`, `created_by`, `created_via`.

**Implementado na Fase 4.1** (`supabase/migrations/20261119003114_crm.sql`, `lib/services/crm.ts`):
- **Integridade no banco por FK composta:** `crm_stages (pipeline_id, organization_id) → crm_pipelines (id, organization_id)`; `crm_leads (stage_id, pipeline_id, organization_id) → crm_stages (id, pipeline_id, organization_id)`; `crm_activities (lead_id, organization_id) → crm_leads (id, organization_id)`. Um lead nunca aponta para etapa de outro funil ou de outra empresa, nem mesmo via service_role.
- **RLS:** membros leem tudo da org, criam/editam leads e adicionam histórico (com `created_by = auth.uid()`); só owner/admin gerenciam funis/etapas e excluem leads; histórico é só de inclusão (sem update/delete).
- **Funil padrão** (`private.create_default_pipeline`): Novo Lead, Qualificado por IA, Reunião Agendada, Proposta Enviada (abertas) e Fechado (`won`), criado no trigger de nova organização e por backfill na própria migration. Um único funil padrão por org (índice parcial).
- **Posição fracionária** (`position double precision`): `computePosition` insere entre vizinhos com a média e só renumera a coluna (passo 1024) quando acaba a precisão.
- **Service dual-control:** `getDefaultBoard`, `createLead` (limite `crmLeads` do plano, primeira etapa por padrão, origem `hermes` quando via agente), `updateLead`, `moveLead` (histórico `stage_change` com `created_via`), `addLeadNote`, `listLeadActivities`; schemas Zod `leadInputSchema`, `leadPatchSchema`, `moveLeadSchema`, `noteSchema` compartilhados com UI e Tools. Toda consulta filtra `organization_id` (contextos sem RLS, como o Telegram).
- **Limite do plano:** `config/plans.ts` ganhou `crmLeads` (total de leads ativos, não mensal): Starter 1.000 · Growth 10.000 · Scale 100.000 (confirmado pelo usuário em 2026-11-18).

**Kanban (Fase 4.2)** — `app/(app)/crm/`:
- `page.tsx` (server) carrega `getDefaultBoard`; `board.tsx` (client) usa `@dnd-kit/core` 6.3 + `@dnd-kit/sortable` 10: `DndContext` com `id` estável (sem divergência de hydration), `PointerSensor` (distância 6 px) + `KeyboardSensor` (`sortableKeyboardCoordinates`), anúncios e instruções de leitor de tela em pt-BR, **alça de arrastar dedicada** por card (botões dentro do card não iniciam arraste), `DragOverlay`.
- Atualização otimista com `moveCardInBoard` (`lib/crm/board.ts`, pura); o servidor confirma via `moveLeadAction` e, se recusar, o quadro volta ao estado anterior com aviso pt-BR (toast). A revalidação substitui o estado local pelo do servidor.
- Actions (`actions.ts`): `moveLeadAction`, `createLeadAction`, `deleteLeadAction`, `createStageAction`, `updateStageAction`, `reorderStagesAction`, `deleteStageAction` — Zod + rate limit `crmUser` (120/min, arrastar gera muitas chamadas) + erro amigável; papel e plano decididos no service (`assertAdmin`: member não altera etapas nem exclui leads; etapa só é excluída vazia e nunca a última; máximo de 20 etapas).
- Dashboard: KPI "Oportunidades no funil" real (`countOpenOpportunities`: leads em etapas `open`).

**Ficha do lead e Funil (Fase 4.3):**
- `app/(app)/crm/leads/[leadId]` (link pelo nome do card): `getLead` (com etapa, filtrado por org; outro tenant → 404), `listStages` (sem carregar leads), atalhos de contato de `lib/crm/lead-view.ts` (`contactLinks`: WhatsApp `wa.me` com DDI 55 para número BR, `mailto:`, `tel:`, site só `http(s)` — bloqueia `javascript:` —, Instagram por @), edição (`updateLeadAction` + `leadPatchSchema`), troca de etapa (reusa `moveLeadAction` + histórico), exclusão só owner/admin que volta ao quadro, linha do tempo com autoria (`activityAuthor`: "por você", "por <nome>", "pelo Hermes") e nova anotação (`addLeadNoteAction`).
- Nomes de membros: `memberNames` confirma via contexto (RLS/filtro de org) quem é membro e só então lê `profiles` com cliente admin (o RLS de `profiles` só deixa ler o próprio perfil).
- Actions revalidam `revalidatePath("/crm", "layout")` (quadro + fichas).
- Funil `/crm?view=funil`: `funnelMetrics` (`lib/crm/funnel.ts`, pura) — foto atual: lead numa etapa conta como tendo passado pelas anteriores; taxa de passagem = chegaram na próxima ÷ chegaram nesta; perdidos fora da progressão, dentro do total; conversão = ganhos ÷ total. Gráfico Recharts 3 (barras horizontais, uma série na cor primária, rótulo direto, tooltip pt-BR, carregado sob demanda) + tabela acessível com os mesmos números.
- Limite conhecido: o quadro carrega todos os leads do funil de uma vez (ok até alguns milhares); paginação/virtualização por coluna entra quando houver clientes perto dos limites maiores.

### Calendário & Estúdio (Fases 5–6)

**social_posts** — `organization_id`, `format` enum (`feed|reels|stories|carousel|gmb_update`), `caption`, `hashtags text[]`, `media jsonb` (paths no Storage), `scheduled_at timestamptz`, `status` (`draft|scheduled|publishing|published|failed`), `published_at`, `external_ids jsonb` (id por canal), `error`, `carousel_id`, `created_by`, `created_via` (`manual|hermes`). Índice parcial `(scheduled_at) where status = 'scheduled'`.

**Implementado em 5.1:** os canais e suas contas ficam normalizados em `social_post_targets`, com FK composta para post e integração da mesma empresa e provedor correspondente. Membros leem por RLS; alterações passam pelo serviço e pela função transacional `save_social_post`, restrita ao `service_role` e com verificação de membro. O serviço obtém o limite do plano em `config/plans.ts`; o banco cobra `scheduled_posts` atomicamente junto à gravação, no mês de criação do agendamento em Brasília. Uma operação em múltiplos canais conta como um post. Editar um post que já está agendado não cobra de novo; voltar a rascunho não estorna e um novo agendamento cobra novamente. Apenas rascunhos e posts agendados são editáveis; publicação e transições do worker serão implementadas nas próximas etapas. Integrações usadas por posts não podem ser excluídas enquanto houver referência.
**carousels** — `organization_id`, `title`, `slides jsonb` (`[{role: hook|content|cta, heading, body, image}]`), `theme jsonb`, `status` (`draft|ready`), `export_paths text[]`, `created_by`, `created_via`.
**landing_pages** — `organization_id`, `slug` (unique por org), `title`, `sections jsonb`, `pipeline_id`, `stage_id` (destino dos leads), `published`.

### Leads & Ads (Fase 7)

**lead_searches** — `organization_id`, `niche`, `location`, `radius_km`, `status`, `results_count`.
**scraped_leads** — `organization_id`, `search_id`, `name`, `category`, `address`, `city`, `phone`, `whatsapp`, `email`, `website`, `instagram`, `rating`, `place_id`, `raw jsonb`, `status` (`new|sent_to_crm|sent_to_audience|discarded`). Unique `(organization_id, place_id)`.
**ad_campaigns** — `organization_id`, `integration_id`, `external_campaign_id`, `name`, `objective`, `daily_budget_cents`, `status`, `audience jsonb` (inclui `custom_audience_id`), `creative jsonb` (`carousel_id`/mídia), `metrics jsonb` (`spend`, `impressions`, `clicks`, `leads`, `roas`), `last_synced_at`, `created_via`.

## 3. Tools do Agente Hermes

Cada Tool = wrapper de um service com o mesmo schema Zod, executada sempre por `runTool` (`lib/hermes/run-tool.ts`): valida com Zod, executa, grava `hermes_logs` e devolve `{ ok, data | error }` — `ServiceError` vira mensagem amigável; erro interno vira mensagem genérica (detalhe só no log). `ai_credits` é cobrado por turno do agente (Fase 2.3), não por Tool. Ações com custo (campanhas, publicação imediata) usam `needsApproval` e pedem confirmação explícita do usuário. Registro: `lib/hermes/tools.ts` (`HERMES_TOOLS`, `buildHermesTools(ctx)`).

| Domínio | Tools |
|---|---|
| Marca | `get_brand_context`, `update_brand_context` |
| Conta | `get_plan_and_usage`, `get_dashboard_kpis`, `list_recent_activity` |
| Integrações | `list_integrations`, `get_integration_setup_guide`, `create_telegram_link_code` |
| Calendário | `create_post`, `list_posts`, `reschedule_post`, `cancel_post`, `publish_post_now`, `plan_week_with_ai` |
| Estúdio | `generate_carousel`, `update_carousel`, `export_carousel_to_calendar`, `generate_landing_page` |
| CRM | `create_lead`, `update_lead`, `move_lead_to_stage`, `list_leads`, `add_lead_note`, `get_funnel_metrics`, `schedule_meeting` |
| Leads | `search_leads`, `list_scraped_leads`, `send_scraped_leads_to_crm`, `create_custom_audience` |
| Ads | `check_ads_readiness`, `create_ad_campaign`, `update_campaign_budget`, `pause_campaign`, `get_campaign_metrics` |

Canais: chat interno (`/api/hermes`, streaming), Telegram (`/api/webhooks/telegram` para o bot da plataforma e `/api/webhooks/telegram/[slug]` para bots White-Label; áudio transcrito por Whisper/Groq antes do agente), webhooks externos n8n/BootConversa (`/api/webhooks/inbound`, assinatura HMAC).

**Núcleo do turno compartilhado (`lib/hermes/turn.ts`, `startHermesTurn`):** todo canal executa o mesmo turno — cobra 1 crédito (`PlanLimitError` sem cobrança), carrega o histórico confiável do banco e o Contexto Mestre e devolve `settings` (modelo `claude-opus-5-5`, system prompt, Tools, `stopWhen`, providerOptions) + `refund()` (idempotente) + `persist()`. O painel passa `settings` para `streamText`; o Telegram para `generateText`.

**OAuth Meta (Fase 3.4) — Instagram, Página do Facebook e Meta Ads:**
- Graph API fixada em `META_GRAPH_VERSION = "v27.0"` (`lib/integrations/meta.ts`, conferida no changelog oficial em 2026-11-18). Escopos (Facebook Login): `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `business_management`, `ads_management`, `ads_read`.
- Anti-CSRF (`lib/integrations/oauth-state.ts`, reaproveitável no Google): `state = base64url(payload).HMAC` com chave derivada de `VAULT_ENCRYPTION_KEY` (`"oauth-state-v1"`), payload `organizationId + userId + provider + nonce + exp (10 min)`; o `nonce` também vai em cookie `oauth_nonce` (`httpOnly`, `SameSite=Lax`, path `/api/integrations`). O callback exige assinatura, validade, nonce igual ao cookie e **mesmo usuário e mesma org da sessão atual**.
- Fluxo: `/api/integrations/meta/start` (só owner/admin, rate limit) → diálogo `facebook.com/v27.0/dialog/oauth` → `/api/integrations/meta/callback` → `code` → token do usuário → token de longa duração (~60 dias) → `/me/permissions`, `/{user}/accounts` (token de Página, sem expiração fixa), `/{page}?fields=instagram_business_account`, `/me/adaccounts` + `/{act}/adspixels`. `mapMetaConnections` (pura) grava `facebook_page` e `instagram` com o **token da Página** e `meta_ads` com o **token do usuário** (`expires_at`), `status: needs_attention` se `account_status != 1`; todos com `metadata.meta_user_id` e escopos concedidos. Resultado volta em `/integrations?meta=<status>`.
- Conformidade: `/api/webhooks/meta/deauthorize` e `/api/webhooks/meta/data-deletion` verificam `signed_request` (HMAC-SHA256 com `META_APP_SECRET`, tempo constante), têm rate limit por IP e removem as integrações daquele `meta_user_id` (segredos em cascata). A exclusão responde `{ url, confirmation_code }` apontando para a página pública `/meta/exclusao-de-dados?codigo=...`.
- Limite conhecido: o token de usuário do `meta_ads` expira em ~60 dias; a renovação/alerta automático fica para a fase de agendamentos (cron), hoje o admin reconecta.

**OAuth Google (Fase 3.5) — Google Meu Negócio e Google Calendar:**
- Endpoints conferidos na doc oficial em 2026-11-18: autorização `accounts.google.com/o/oauth2/v2/auth`, token `oauth2.googleapis.com/token`, revogação `oauth2.googleapis.com/revoke`. Escopos por produto (`lib/integrations/google.ts`): `business` → `https://www.googleapis.com/auth/business.manage`; `calendar` → `calendar.events` + `calendar.calendarlist.readonly`.
- Fluxo: `/api/integrations/google/start?product=business|calendar` (só owner/admin, rate limit) — o produto vai **assinado** no `state` (`context`), mesmo anti-CSRF da Meta — com `access_type=offline` + `prompt=consent` (o Google só devolve `refresh_token` na 1ª autorização sem o prompt). `/callback` exige `refresh_token` (senão `?google=no_refresh`), lê contas → locais do Business Profile (`readMask=name,title`) ou a agenda principal (`calendarList/primary`) e grava cada linha com access token + `expires_at` + **refresh token cifrado**, todas com o mesmo `metadata.google_grant_id`.
- Renovação: `getGoogleAccessToken(org, integration)` devolve o token salvo se ainda vale mais de 1 min; senão usa o refresh token, cifra e grava o novo access token; `invalid_grant` marca a integração como `needs_attention` e pede reconexão.
- Revogação: ao desconectar, o token é lido **antes** de apagar (segredos somem em cascata) e revogado **depois** da remoção, só se for a última linha daquele grant (revogar derruba todas as linhas do mesmo consentimento). `member` é recusado antes de qualquer leitura de token.

**Telegram (bot da plataforma, Fase 3.3a):**
- Vínculo: "Gerar código" em `/integrations` (Server Action, rate limit 5/10 min) → código de 8 caracteres sem ambíguos, 10 min, uso único. O usuário toca em "Abrir o Telegram e vincular" (deep link `t.me/<bot>?start=CODIGO`, chega como `/start CODIGO`) ou envia `/vincular CODIGO`. `linkTelegramChat` consome o código, remove vínculos do mesmo chat em outras orgs (um chat = uma conta) e grava `integrations` (`provider telegram`, `external_account_id = chat_id`, `metadata.user_id`, sem segredo).
- Webhook: segredo em tempo constante (`X-Telegram-Bot-Api-Secret-Token`), Zod no update, responde 200 imediatamente e processa em `after()`; dedupe por `update_id` (reenvios do Telegram não cobram em dobro); rate limit por `chat_id`; só conversas privadas.
- Contexto sem sessão: `loadTelegramSession` confere membership e onboarding e monta `ServiceContext` com cliente **admin** (`channel: "telegram"`). Por isso todo service filtra por `organization_id` e regras de papel usam `ctx.role` explicitamente (ex.: `saveBrandContext` recusa `member`).
- Conversa contínua por chat (id = id da integração), visível também no histórico do painel.
- **Áudio (Fase 3.3b):** `voice` e `audio`, até 5 min e 10 MB (checados pelo update antes de baixar e pelo tamanho real depois). Só transcreve chat vinculado e com crédito disponível. `lib/transcription.ts`: Groq (`whisper-large-v3-turbo`) se `GROQ_API_KEY`, senão OpenAI `whisper-1`, `language: pt`, via `fetch` (sem SDK). O texto entendido segue o mesmo turno do texto (1 crédito, sem extra) e a resposta começa com "🎙️ Entendi: “…”".
- **Bot próprio (Fase 3.3c, Scale ou `is_white_label`, só owner/admin):** provider `telegram_bot` (`external_account_id` = id do bot, token cifrado em `integration_secrets`). Cadastro valida com `getMe`, registra `setWebhook` em `https://<NEXT_PUBLIC_SITE_URL>/api/webhooks/telegram/<slug>` com `secret_token = HMAC-SHA256(TELEGRAM_WEBHOOK_SECRET, "org-bot:<slug>")` (nada a armazenar) e troca de bot remove o anterior e seus vínculos. Isolamento: a rota `[slug]` confere o segredo derivado **antes** de tocar no banco; vínculos pelo bot próprio usam `external_account_id = "<botId>:<chatId>"` + filtro por `organization_id`; `consume_telegram_link_code(code, org)` só aceita código da própria empresa (código alheio nem é consumido); o handler recusa sessão de outra empresa; dedupe de `update_id` por bot. O painel aponta o vínculo rápido para o `@username` do bot próprio quando existe. Limite conhecido: o webhook usa o `slug` — se um dia o slug puder ser alterado, é preciso re-registrar o webhook.
- **Desvincular (Telegram):** qualquer papel remove só o próprio chat (`unlinkOwnTelegram`, filtro `id + org + provider + metadata.user_id`, cliente admin); desconectar integrações de terceiros segue restrito a owner/admin (RLS).

## 4. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **1. Fundação** | Scaffold, design system Clinkup, `tenant-brand.ts`, schema multi-tenant + RLS, Auth, onboarding guiado + Contexto Mestre, planos + checkout Stripe + webhook, app shell, dashboard inicial | Usuário cria conta, conclui onboarding, vê dashboard e assina plano; RLS isola orgs; testes, lint e build verdes |
| **2. Hermes Core** | Chat interno com streaming, registro de Tools, `hermes_logs`, `usage_counters` + limites por plano, primeiras Tools (marca, conta) | Hermes responde usando o Contexto Mestre e executa Tools com log |
| **3. Integrações** | `/integrations` com tutoriais, OAuth Meta/Google, Telegram `/vincular`, secrets cifrados | Contas conectadas; Hermes atende no Telegram |
| **4. CRM** | Kanban `@dnd-kit`, funil, ficha do lead, atividades, Google Calendar, Tools de CRM | Lead move manual e por comando |
| **5. Calendário** | Mês/Semana/Lista, criação de post, postagem instantânea, Cron de publicação, `plan_week_with_ai` | Post agendado publica no horário |
| **6. Estúdio** | Editor de carrosséis, exportação para o calendário, gerador de landing pages → CRM | Carrossel vira post; LP gera lead |
| **7. Leads & Ads** | Google Places + higienização, envio ao CRM/público, gestor Meta Ads | Campanha criada por formulário e por conversa |
| **8. Escala** | KPIs reais + Recharts, `/admin`, Asaas, White-Label (`docker-compose.yml`, banco dedicado) | Instância dedicada sobe com marca própria |

## 5. Segurança & governança

### 5.1 Isolamento multi-tenant
- Toda tabela de domínio: `organization_id` + RLS habilitado + policies `to authenticated` usando `private.is_org_member(organization_id)` (leitura) e `private.is_org_admin(organization_id)` (escrita sensível). UPDATE sempre com `USING` + `WITH CHECK`.
- Colunas privilegiadas (`plan_id`, `is_white_label`, `is_super_admin`) protegidas por grants de coluna; só service role altera.
- Tabelas internas (`integration_secrets`, `private.rate_limits`) sem grants para `anon`/`authenticated`.
- Toda migration nova é validada contra RLS (teste de isolamento entre duas organizações) antes do commit.

### 5.2 Cofre de credenciais (`lib/vault.ts`)
- AES-256-GCM (Node `crypto`), IV aleatório de 12 bytes, tag de autenticação de 16 bytes.
- Formato gravado: `v1:<iv>:<tag>:<ciphertext>` (base64url). O prefixo de versão permite rotação de chave.
- Chave: `VAULT_ENCRYPTION_KEY` (32 bytes em base64), só no servidor. Dados associados (AAD) = id da integração, impedindo copiar um token cifrado para outra linha.
- Aplicação: tokens OAuth Meta/Google e token do bot/`chat_id` do Telegram em `integration_secrets` (Fase 3). Decifrar só dentro de services server-side no momento da chamada à API externa.

### 5.3 Validação, autenticação e rate limiting
| Entrada | Validação | Autenticação | Rate limit |
|---|---|---|---|
| Server Actions | Zod | sessão Supabase (`getUser`) + papel quando aplicável | por usuário/IP |
| Route Handlers internos (`/api/hermes`, scraping, IA) | Zod | sessão Supabase | por organização + consumo de plano |
| Webhook Stripe | SDK + Zod nos metadados | assinatura `stripe-signature` | por IP, generoso (Stripe reenvia) |
| Webhook Telegram (plataforma e `[slug]`) | Zod | header `X-Telegram-Bot-Api-Secret-Token` (segredo por bot) | por `chat_id` |
| Webhooks n8n/BootConversa | Zod | HMAC SHA-256 + timestamp (anti-replay) | por organização |
| Cron (`/api/cron/*`) | — | `CRON_SECRET` | — |

Rate limiting: janela fixa em Postgres (`private.rate_limits` + função `public.rate_limit_hit`, executável só por `service_role`), chamada por `lib/rate-limit.ts`. Funciona igual no SaaS e no White-Label, sem Redis. Falha aberta (registra erro e libera) para não derrubar login se o banco oscilar.

### 5.4 Continuidade & versionamento
- `PROGRESS.md`: estado vivo do projeto (feito, arquivos, testes, próxima microtarefa), atualizado ao fim de cada tarefa — protocolo de revezamento Claude ↔ Codex.
- Git: Conventional Commits por etapa validada; `.gitignore` bloqueia `.env*`, chaves, builds e temporários; skills restauradas por `skills-lock.json`.
