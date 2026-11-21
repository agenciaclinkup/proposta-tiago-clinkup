# Runbook de Go-Live — Clinkup Hermes Platform

> Guia operacional objetivo para colocar a **Clinkup Hermes Platform** em Staging e Produção (SaaS Multi-Tenant na Vercel ou instalação dedicada White-Label em VPS Hostinger/Docker).
>
> **Regra obrigatória:** execute este runbook em conjunto com a seção `## CHECKLIST OBRIGATÓRIO DE GO-LIVE (NÃO PULAR)` de [`PROGRESS.md`](../PROGRESS.md), marcando `[x]` apenas com evidência real.

---

## 1. Resumo da Auditoria de Prontidão

- **Código e testes:** todas as 9 fases concluídas (`npm test` 489/489, `npm run test:db` verde, `npx tsc --noEmit`, `npm run lint` e `npm run build` limpos).
- **Migrations:** **23 migrations** versionadas em `supabase/migrations/`, todas validadas contra isolamento multi-tenant (RLS + FKs compostas + tabelas privadas sem grant para `anon`/`authenticated`).
- **Variáveis de ambiente:** 100% das variáveis lidas via `process.env.*` no código estão documentadas em [`.env.example`](../.env.example).
- **Provedores ativos vs. não utilizados:**
  - IA do Hermes e Estúdio: **Anthropic** (`ANTHROPIC_API_KEY`); transcrição de áudio no Telegram: **OpenAI Whisper** (`OPENAI_API_KEY`) ou **Groq** (`GROQ_API_KEY`). Gemini não é utilizado.
  - Publicação em redes sociais: integração nativa direta via **Meta Graph API `v27.0`** e **Google Business Profile API** (Zernio não é utilizado).
  - Billing: **Stripe** (cartão/portal) e **Asaas** (Pix/boleto recorrente).

---

## 2. Banco de Dados — Ordem Exata das Migrations (Supabase)

### 2.1 Comandos de aplicação

```bash
# 1. Vincular ao projeto Supabase de Staging/Produção
npx supabase link --project-ref <SEU_PROJECT_REF>

# 2. Conferir migrations pendentes antes de aplicar
npx supabase migration list

# 3. Aplicar todas as 23 migrations em ordem cronológica
npx supabase db push

# 4. Rodar advisors de segurança e performance
npx supabase db advisors
```

### 2.2 Ordem exata das 23 migrations (conferência)

1. `20261118032531_foundation.sql` — fundação multi-tenant (`organizations`, `organization_members`, `profiles`, `brand_context`, `subscriptions`, RLS)
2. `20261118035149_rate_limits.sql` — `private.rate_limits` + `public.rate_limit_hit`
3. `20261118040239_hermes_logs_and_usage.sql` — `hermes_logs`, `usage_counters`, `consume_usage`
4. `20261118042206_hermes_chat.sql` — `hermes_conversations`, `hermes_messages`
5. `20261118151441_usage_refund.sql` — `refund_usage`
6. `20261118191755_integrations.sql` — `integrations`, `integration_secrets` (formato `v1:`), `telegram_link_codes`
7. `20261118235159_telegram_own_bot.sql` — provedor `telegram_bot` e `consume_telegram_link_code(code, org)`
8. `20261119003114_crm.sql` — `crm_pipelines`, `crm_stages`, `crm_leads`, `crm_activities` + backfill do funil padrão
9. `20261119022436_social_posts.sql` — `social_posts`, `social_post_targets`, `save_social_post`
10. `20261119024027_social_media_bucket.sql` — bucket privado `social-media` (50 MB)
11. `20261119025634_social_publish_queue.sql` — fila `FOR UPDATE SKIP LOCKED` e posse por lease
12. `20261119032105_social_publish_retry.sql` — retry por destino e bloqueio de edição pós-tentativa
13. `20261119035734_social_confirmation.sql` — `social_confirmations` e `confirm_social_action`
14. `20261119041214_studio_data.sql` — `carousels`, `studio_slides`, `landing_pages`, `studio_generations`, bucket privado `studio-assets`
15. `20261119162544_social_schedule_confirmation.sql` — operação `schedule_post` em `social_confirmations`
16. `20261119165745_landing_public_capture.sql` — captura transacional pública `capture_landing_lead`
17. `20261121004212_lead_prospecting.sql` — `lead_searches`, `scraped_leads`, `lead_search_results`, reserva/estorno e envio ao CRM
18. `20261121012536_b2b_prospect_provenance.sql` — `prospect_sources` (origem e base legal) e enriquecimento sem sobrescrita
19. `20261121143851_prospect_transfer_confirmation.sql` — `prospect_confirmations` e `confirm_prospect_transfer`
20. `20261121145101_meta_ads_module.sql` — `meta_ad_accounts`, `ad_campaigns`, `ad_sets`, `ad_ads`, `ad_metric_snapshots`, `ad_action_logs`, `ad_action_confirmations`, `consume_ad_action_confirmation`
21. `20261121174835_super_admin_audit.sql` — `admin_audit_logs` (imutável), `usage_counters.bonus` e `grant_usage_bonus`
22. `20261121175831_asaas_billing.sql` — `billing_invoices` e `billing_webhook_events` (deduplicação por `event_id`)
23. `20261121202545_organization_white_label_brand.sql` — `organization_brands` e `private.can_manage_org_brand`

### 2.3 Configurações obrigatórias no Painel do Supabase

- **Authentication → URL Configuration:**
  - Site URL: `https://<DOMINIO_PRODUCAO>`
  - Redirect URLs: incluir `https://<DOMINIO_PRODUCAO>/auth/callback`
- **Authentication → SMTP:** configurar SMTP próprio (templates customizados de confirmação/recuperação).
- **Conferência SQL pós-`db push`:**
  ```sql
  -- Deve retornar 0 (toda organização possui funil padrão)
  select count(*) from public.organizations o
  where not exists (select 1 from public.crm_pipelines p where p.organization_id = o.id and p.is_default);
  ```

---

## 3. Variáveis de Ambiente (Vercel / VPS Hostinger)

> **Nunca** coloque segredos em variáveis `NEXT_PUBLIC_*` nem no repositório Git.

### 3.1 Geração de chaves criptográficas e segredos

```bash
# VAULT_ENCRYPTION_KEY (32 bytes em base64 — faça backup seguro em cofre!)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# CRON_SECRET (mínimo 32 caracteres aleatórios)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# TELEGRAM_WEBHOOK_SECRET (1-256 caracteres [A-Za-z0-9_-])
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ASAAS_WEBHOOK_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3.2 Mapa de variáveis

| Grupo | Variáveis obrigatórias | Opcionais / condicionais | Escopo |
|---|---|---|---|
| **Supabase** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | — | `NEXT_PUBLIC_*` cliente+servidor; `SUPABASE_SECRET_KEY` **só servidor** |
| **App & Cron** | `NEXT_PUBLIC_SITE_URL` (`https://...`), `CRON_SECRET` | — | `CRON_SECRET` **só servidor** |
| **Criptografia** | `VAULT_ENCRYPTION_KEY` | — | **Só servidor** (perder esta chave invalida tokens salvos) |
| **Super-Admin** | `SUPER_ADMIN_EMAILS` (e-mails separados por vírgula) | — | **Só servidor** |
| **IA (Hermes & Estúdio)** | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` (Whisper), `GROQ_API_KEY` (prioridade sobre OpenAI) | **Só servidor** |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | — | Token/secret **só servidor** |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE` | — | **Só servidor** |
| **Asaas (Pix/Boleto)** | `ASAAS_API_KEY`, `ASAAS_ENV` (`production` ou `sandbox`), `ASAAS_WEBHOOK_TOKEN` | — | **Só servidor** |
| **Meta (OAuth + Ads)** | `META_APP_ID`, `META_APP_SECRET` | — | **Só servidor** |
| **Google (GBP + Calendar)** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `GOOGLE_PLACES_API_KEY` (desconectada da persistência) | **Só servidor** |
| **Prospecção B2B** | — | `B2B_PROSPECTING_API_URL`, `B2B_PROSPECTING_API_KEY` | **Só servidor** |
| **White-Label (Build)** | — | `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO_URL`, `NEXT_PUBLIC_BRAND_FAVICON_URL`, `NEXT_PUBLIC_BRAND_SUPPORT_EMAIL`, `NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP`, `NEXT_PUBLIC_BRAND_PRIMARY`, `NEXT_PUBLIC_BRAND_SECONDARY` | Embutidas no build (reconstruir imagem ao alterar) |

---

## 4. Configuração de Webhooks e Provedores Externos

### 4.1 Stripe (modo Live)
- Criar 3 produtos/preços mensais (Starter, Growth, Scale) e preencher `STRIPE_PRICE_*`.
- Habilitar Customer Portal (troca de plano, cancelamento e cartão).
- Webhook URL: `https://<DOMINIO>/api/webhooks/stripe`
- Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

### 4.2 Asaas (Pix e Boleto recorrente)
- Webhook URL: `https://<DOMINIO>/api/webhooks/asaas`
- Cabeçalho de autenticação: `asaas-access-token` = valor exato de `ASAAS_WEBHOOK_TOKEN`.
- Eventos: `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`, `SUBSCRIPTION_DELETED`.

### 4.3 Telegram Bot (Bot da Plataforma)
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<DOMINIO>/api/webhooks/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message"]'

# Validar ausência de last_error_message:
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```
> Bots próprios White-Label (plano Scale / `is_white_label`) registram automaticamente `/api/webhooks/telegram/<slug>` via `/integrations`.

### 4.4 Meta Developers (Instagram, Facebook Pages e Meta Ads)
- App tipo **Business** com **Facebook Login for Business** + Business Verification + App Review aprovado (`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `business_management`, `ads_management`, `ads_read`).
- **Valid OAuth Redirect URI:** `https://<DOMINIO>/api/integrations/meta/callback`
- **Deauthorize Callback URL:** `https://<DOMINIO>/api/webhooks/meta/deauthorize`
- **Data Deletion Request URL:** `https://<DOMINIO>/api/webhooks/meta/data-deletion` (status público em `/meta/exclusao-de-dados`).

### 4.5 Google Cloud (Business Profile e Calendar)
- Ativar: **Google Calendar API**, **My Business Account Management API** e **My Business Business Information API** (requer aprovação prévia de acesso à Business Profile API).
- **Authorized Redirect URI:** `https://<DOMINIO>/api/integrations/google/callback`

### 4.6 Cron de Publicação (`/api/cron/publish`)
- **Só ativar após validar integrações reais da Meta e Google Business Profile.**
- Chamada `GET https://<DOMINIO>/api/cron/publish` a cada minuto com `Authorization: Bearer <CRON_SECRET>`.
- **Vercel / Supabase:** configurar via Supabase `pg_cron` + `pg_net` (segredo no Vault).
- **VPS Docker:** ativar apenas o perfil dedicado (`docker compose --profile scheduler up -d`) — nunca rodar dois agendadores simultâneos.

---

## 5. Deploy (Vercel SaaS vs. VPS Hostinger Dedicada)

### 5.1 Vercel (SaaS Multi-Tenant)
1. Conectar repositório privado no painel da Vercel e cadastrar todas as variáveis da Seção 3.
2. Confirmar que o plano suporta `maxDuration = 120` s (`/api/hermes`, `/api/webhooks/telegram`, `/studio`) e `after()` (`waitUntil`).
3. Conferir que o proxy define `x-forwarded-for` confiável (protege rate limiting por IP).
4. Executar deploy e validar `GET https://<DOMINIO>/api/health` → `200 OK`.

### 5.2 VPS Hostinger (Docker Compose / White-Label Dedicado)
1. Clonar o repositório privado na VPS e criar `.env` privado a partir de `.env.example` (`chmod 600 .env`).
2. Configurar proxy reverso HTTPS (Nginx/Caddy/Traefik) apontando para `127.0.0.1:3000` e sobrescrevendo `X-Forwarded-For` com o IP real do cliente.
3. Subir a aplicação:
   ```bash
   docker compose up -d --build
   curl -fsS http://127.0.0.1:3000/api/health
   ```
4. Sempre que alterar qualquer variável `NEXT_PUBLIC_*`, reconstruir sem cache: `docker compose build --no-cache && docker compose up -d`.
5. Somente após validar integrações reais, ativar o agendador: `docker compose --profile scheduler up -d`.

---

## 6. Roteiro de Smoke Test Pós-Deploy

Executar na ordem abaixo com **duas organizações de teste distintas (Org A e Org B)** antes de liberar tráfego de clientes:

1. **Auth, Onboarding e Isolamento Multi-Tenant:**
   - Criar conta na Org A, confirmar e-mail, concluir `/onboarding` e abrir `/dashboard`.
   - Criar conta na Org B e confirmar que não enxerga leads, posts, carrosséis, faturas, contas Meta Ads nem marca White-Label da Org A.
   - Tentar consultar `integration_secrets`, `admin_audit_logs`, `billing_webhook_events`, `social_confirmations`, `prospect_confirmations` e `ad_action_confirmations` com token de usuário autenticado → esperado: erro de permissão.
2. **Billing (Stripe + Asaas):**
   - Testar checkout Stripe (modo teste) e assinatura Pix/Boleto Asaas (sandbox) em `/billing` como `owner`; confirmar bloqueio para `member`.
   - Reenviar o mesmo `event_id` no webhook `/api/webhooks/asaas` → esperado: `{ received: true, duplicate: true }` sem duplicar efeitos.
3. **Agente Hermes (Web e Telegram):**
   - Enviar pergunta no `/hermes` que dispare Tool ("Qual é o meu plano?"); conferir `hermes_messages`, `hermes_logs` e `usage_counters.ai_credits + 1`.
   - Vincular Telegram via `/integrations` (`t.me/<bot>?start=CODIGO`), enviar texto e áudio (conferir prefixo `🎙️ Entendi:` e consumo de 1 crédito).
4. **CRM, Calendário e Estúdio:**
   - Criar e mover lead no Kanban (`/crm`), abrir ficha e agendar reunião no Google Calendar.
   - Criar carrossel no `/studio`, gerar slides com IA (conferir crédito e estorno em falha simulada) e exportar para `/calendar` como rascunho; testar agendamento pelo Hermes via `CONFIRMAR <código>`.
   - Publicar landing page e enviar formulário em `/p/<orgSlug>/<slug>` → conferir lead criado na etapa configurada do CRM.
5. **Prospecção B2B e Meta Ads:**
   - Em `/leads-ads` e pelo Hermes, consultar CNPJ declarando origem e base legal; testar `propose_send_prospects_to_crm` + `CONFIRMAR <código>` em nova mensagem.
   - Em `/meta-ads` (plano Growth/Scale), verificar bloqueio enquanto o teto diário estiver em `R$ 0,00`; configurar tetos como `admin`, sincronizar conta de teste, testar proposta + aprovação explícita e pausa segura; validar aviso de plano no `Starter`.
6. **Dashboard Executivo, Super-Admin e White-Label:**
   - Abrir `/dashboard?period=7d|30d|90d` e conferir KPIs reais e gráficos Recharts.
   - Acessar `/admin` como usuário comum → redirecionado para `/dashboard` sem vazamento; acessar como e-mail em `SUPER_ADMIN_EMAILS`, aplicar ajuste de plano e bônus de créditos e conferir registro imutável na trilha de auditoria.
   - Em `/settings` (Org com plano Scale ou `is_white_label = true`), salvar marca própria, cores, WhatsApp de suporte e `hide_clinkup = true` → conferir aplicação imediata no menu lateral.
