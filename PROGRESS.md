# PROGRESS — CLINKUP HERMES PLATFORM

> Protocolo de revezamento Claude ↔ Codex. **Leia antes de começar; atualize ao fim de cada tarefa/módulo** (feito, arquivos, testes, próxima microtarefa). Regras: `AGENTS.md` §6. Plano: `ARCHITECTURE.md` §4.

## Estado atual

- **Fase:** 3 — Integrações (Fase 2 — Hermes Core ✅ concluída)
- **Etapa em andamento:** 3.3a — Telegram: bot da plataforma, vínculo e mensagens de texto
- **Adiado pelo usuário:** 1.3 (validação com credenciais reais) fica para o final da construção — ver CHECKLIST DE GO-LIVE abaixo.
- **Última atualização:** 2026-11-18 — Claude

## Próxima microtarefa (exata)

**3.3a Telegram — bot da plataforma, vínculo e texto** (TDD):
1. `createTelegramLinkCode(ctx)` em `lib/services/integrations.ts` (código de 8 caracteres de alfabeto sem ambíguos, gerado com `crypto`, gravado via admin; testar formato e entropia) + Server Action "Gerar código" (Zod, rate limit) no card Telegram de `/integrations` mostrando código, validade e link do bot (`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`); remover o aviso "em breve" desse card.
2. `lib/telegram/` com schema Zod do update (só `message.text`/`message.voice` usados), parser de `/vincular CODIGO` e cliente mínimo `sendMessage` via `fetch` (sem dependência nova).
3. `app/api/webhooks/telegram/route.ts`: header `X-Telegram-Bot-Api-Secret-Token` comparado em tempo constante com `TELEGRAM_WEBHOOK_SECRET`, Zod, rate limit por `chat_id`, sempre responde 200 rápido ao Telegram. `/vincular` → `consume_telegram_link_code` → `saveIntegration(provider "telegram", externalAccountId chat_id, metadata { user_id }, accessToken: marcador cifrado)`; chat não vinculado recebe instruções didáticas.
4. Mensagem de texto de chat vinculado → Hermes no canal `telegram` (mesmo system prompt e Tools, `generateText`, 1 crédito com estorno em falha, `hermes_logs`) e resposta no chat. Reaproveitar o máximo de `app/api/hermes/route.ts` extraindo o núcleo do turno para `lib/hermes/` (sem duplicar lógica).
5. `.env.example` + checklist: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, comando `setWebhook` documentado.

**Plano da Fase 3:**
- 3.1 dados + cofre ✅.
- 3.2 `/integrations` ✅.
- 3.3 Telegram, dividido em **3.3a** (acima), **3.3b** áudio (Whisper/Groq) e **3.3c** bot próprio White-Label. Decisões fechadas em 2026-11-18, ver `ARCHITECTURE.md` §1:
  - SaaS: bot único da plataforma (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`), webhook `/api/webhooks/telegram`; "Gerar código" na UI (Server Action, código de 8 caracteres `[A-Z0-9]` sem ambíguos, gravado via admin) e `/vincular CODIGO` → `consume_telegram_link_code` → `saveIntegration(provider: "telegram", externalAccountId: chat_id, metadata: { user_id })`.
  - White-Label/Enterprise: admin cadastra o token do próprio bot (cifrado em `integration_secrets`), plataforma chama `setWebhook` para `/api/webhooks/telegram/[slug]` com segredo próprio por bot.
  - Mensagens: Zod no update, header `X-Telegram-Bot-Api-Secret-Token`, rate limit por `chat_id`, Hermes no canal `telegram` (mesmas Tools, 1 crédito por mensagem, estorno em falha; resposta via `generateText`).
  - Áudio: OpenAI Whisper `whisper-1` (`OPENAI_API_KEY`) por padrão; Groq (`GROQ_API_KEY`) quando configurado; limitar duração/tamanho do áudio.
- 3.4 OAuth Meta (Instagram, Facebook Pages, Meta Ads/BM): rota de callback com `state` assinado (anti-CSRF), tokens cifrados, refresh de token longo. Requer app Meta (envs `META_APP_ID`, `META_APP_SECRET`).
- 3.5 OAuth Google (Google Meu Negócio + Calendar): mesmo padrão; requer `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e verificação do app no Google Cloud.

**Plano da Fase 2 (concluída):** 2.1 dados + services ✅ · 2.2 Tools ✅ · 2.3 chat `/hermes` ✅ · 2.4 uso do plano, atividades, estorno e exclusão de conversa ✅.

## CHECKLIST OBRIGATÓRIO DE GO-LIVE (NÃO PULAR)

> Executar antes de qualquer deploy de produção. Todo agente que criar env, webhook, migration ou configuração externa **acrescenta o item aqui na mesma tarefa**. Nunca remover itens; marcar `[x]` só com evidência.

### Etapa 1.3 — Validação em ambiente real (adiada pelo usuário para o fim da construção)
- [ ] Criar projeto Supabase e preencher `.env.local` (modelo: `.env.example`).
- [ ] `npx supabase link --project-ref <ref>` e `npx supabase db push` (migrations: `foundation`, `rate_limits`, `hermes_logs_and_usage`).
- [ ] Rodar advisors (`npx supabase db advisors` ou MCP `get_advisors`) e corrigir alertas.
- [ ] Fluxo manual: cadastro → confirmação de e-mail → onboarding → dashboard; segundo usuário não enxerga a org do primeiro.
- [ ] Stripe modo teste: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, checkout, conferir `subscriptions` e `organizations.plan_id`.
- [ ] Registrar resultado aqui e commitar `test(e2e): ...` / `fix(...)` conforme achados.
- [ ] `db push` aplica também a migration `hermes_chat` (Fase 2.3) — conferir `npx supabase migration list`.
- [ ] **Validar o código `42501` (Fase 2.2):** com um segundo usuário de papel `member` na org (inserir em `organization_members` via SQL, pois ainda não há convites), tentar alterar a memória da marca pelo Hermes ("mude o tom de voz para descontraído"). Esperado: "Apenas proprietários e administradores podem alterar a memória da marca." Se o Supabase devolver outro código para violação de RLS no `upsert`, ajustar `saveBrandContext` em `lib/services/brand.ts` e o teste correspondente.
- [ ] Chat do Hermes com `ANTHROPIC_API_KEY` real: mensagem em `/hermes` com streaming; pergunta que dispara Tool ("Qual é o meu plano?"); conferir linhas em `hermes_messages`, `hermes_logs` e `usage_counters` (`ai_credits` +1 por mensagem); recarregar a página e ver o histórico.
- [ ] Confirmar que a API aceita `fallbacks: "default"` + beta `server-side-fallback-2026-07-01` com `claude-opus-5-5` via `@ai-sdk/anthropic` (se retornar 400, remover essas duas opções em `app/api/hermes/route.ts`).
- [ ] `db push` aplica também a migration `usage_refund` (Fase 2.4).
- [ ] **Estorno de crédito (Fase 2.4):** forçar falha do modelo (ex.: `ANTHROPIC_API_KEY` inválida temporariamente em staging) e confirmar que `usage_counters.ai_credits` volta ao valor anterior e que o chat mostra "Tive um problema para concluir a resposta…". Clicar em "Parar resposta" **não** deve estornar.
- [ ] **Excluir conversa (Fase 2.4):** excluir pela lista e pelo cabeçalho do chat; conferir que `hermes_messages` da conversa sumiram (cascade) e que outro usuário da mesma org não consegue excluir a conversa alheia (RLS; resposta "Não encontramos esta conversa…").
- [ ] Alerta de 80% no card "Uso do plano": ajustar manualmente `usage_counters.used` em staging e conferir o aviso amarelo (80%) e vermelho (100%) no `/dashboard` e no `/billing`.
- [ ] `db push` aplica também a migration `integrations` (Fase 3.1).
- [ ] **Cofre em produção (Fase 3.1):** depois de conectar a primeira integração real, conferir no SQL Editor que `integration_secrets.access_token_encrypted` começa com `v1:` e não contém o token; e que `select * from integration_secrets` com a chave publishable/usuário logado retorna erro de permissão.
- [ ] **Desconectar integração (Fase 3.2):** com integração real conectada, desconectar como owner/admin em `/integrations` (confirmação aparece; linha some e `integration_secrets` correspondente é apagado em cascata). Logado como `member`, conferir que o botão Desconectar não aparece e que o aviso "Apenas proprietários e administradores…" é exibido.

### Variáveis de ambiente (produção, só no painel da hospedagem — nunca no Git)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `SUPABASE_SECRET_KEY` (somente servidor)
- [ ] `NEXT_PUBLIC_SITE_URL` (domínio de produção)
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`
- [ ] `VAULT_ENCRYPTION_KEY` (32 bytes base64; guardar backup seguro — perder a chave = perder todos os tokens de integração)
- [ ] `ANTHROPIC_API_KEY` (Fase 2.2+, Agente Hermes)
- [ ] Planejadas para a Fase 3.3 (entram no `.env.example` quando o código usar): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPENAI_API_KEY` (Whisper), `GROQ_API_KEY` (opcional).
- [ ] White-Label (opcional): `NEXT_PUBLIC_BRAND_*`

### Supabase (painel)
- [ ] Auth → URL Configuration: Site URL = domínio de produção; Redirect URLs inclui `https://<domínio>/auth/callback`.
- [ ] Auth → SMTP próprio configurado (plano free não permite customizar templates de e-mail no SMTP padrão).
- [ ] Data API: confirmar que as tabelas do `public` respondem para `authenticated` (grants explícitos já nas migrations).

### Stripe (painel, modo live)
- [ ] 3 produtos/prices mensais (Starter, Growth, Scale) → IDs nas envs `STRIPE_PRICE_*`.
- [ ] Webhook `https://<domínio>/api/webhooks/stripe` com eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` → secret em `STRIPE_WEBHOOK_SECRET`.
- [ ] Customer Portal: habilitar troca de plano entre os 3 prices, cancelamento e atualização de pagamento.

### Segurança operacional
- [ ] Deploy atrás de proxy que define `x-forwarded-for` (ex.: Vercel); senão o rate limit por IP pode ser burlado.
- [ ] Monitorar logs `[rate-limit]` e `[hermes-log]` (ambos falham aberto/silencioso por design).
- [ ] Repositório GitHub privado; nenhum `.env*` no histórico (`git log --all -- .env*` vazio).
- [ ] Hospedagem suporta `maxDuration = 120` s em `/api/hermes` (streaming do chat); planos gratuitos podem cortar antes.
- [ ] Anthropic Console: limite de gasto e rate limit da organização compatíveis com o volume (1 crédito de IA = 1 turno, mas o custo real por turno varia com Tools e tamanho da conversa).
- [ ] Monitorar logs `[hermes]` (falha ao salvar mensagens ou no streaming).
- [ ] Monitorar logs `[usage]` (falha no estorno de crédito; o usuário fica cobrado por uma resposta que falhou).

## Concluído

### 3.2 Página `/integrations` — ✅ (2026-11-18)
- **`app/(app)/integrations/page.tsx`:** um card por provedor (ícone, descrição, selo Conectado / Precisa de atenção / Não conectado, contas conectadas), guia expansível com `<details>` nativo (requisitos, passos numerados, dicas) vindo de `lib/integrations/catalog.ts`, botões "Conectar com a Meta/Google" e "Gerar código" desabilitados com aviso acolhedor de liberação em breve (3.3–3.5), aviso para `member`, atalho "Pedir ajuda ao Hermes".
- **`app/(app)/integrations/actions.ts`:** `disconnectIntegrationAction` (Zod uuid, rate limit `integrationsUser` 20/min, `disconnectIntegration` via RLS de admin, `revalidatePath`, mensagens pt-BR). Botão só aparece para owner/admin; a regra real é o RLS.
- **`components/confirm-action-button.tsx`:** botão genérico de Server Action com confirmação, carregando e mensagens de erro/sucesso; `DeleteConversationButton` passou a usá-lo (sem código duplicado).
- Menu: "Integrações" ativo. Dashboard: "Próximos passos" com links para `/integrations`.

**Testes:** `npm test` 98/98 (4 novos da action; RED verificado antes) · `npm run test:db` 72/72 · `tsc --noEmit` OK · lint limpo · build OK. Página verificada só por build/tipos (sem navegador).

### 3.1 Dados das integrações + cofre — ✅ (2026-11-18)
- **Migration** `supabase/migrations/20261118191755_integrations.sql`: enums `integration_provider` e `integration_status`; `integrations` (membros leem, só admin exclui, servidor grava; unique por org/provedor/conta); `integration_secrets` (sem grants para usuários; `CHECK` exige formato `v1:` do cofre); `telegram_link_codes` (8 caracteres, 10 min, só servidor cria, usuário lê os próprios) + `public.consume_telegram_link_code` (atômico, uso único, só `service_role`).
- **`lib/integrations/catalog.ts`:** guias pt-BR para iniciantes (requisitos, passos com onde clicar, dicas) de Instagram, Página do Facebook, Meta Ads/BM (conta de anúncios, pagamento, Pixel), Google Meu Negócio, Google Calendar e Telegram (incl. bot próprio via @BotFather). Fonte única para UI e Hermes.
- **`lib/services/integrations.ts`:** `listIntegrations` (nunca toca segredos), `summarizeIntegrations` (todos os provedores com status), `saveIntegration` (admin; tokens cifrados com AAD = id da integração), `getIntegrationToken` (decifra no servidor, filtra por org), `disconnectIntegration` (RLS admin).
- **Tools:** `list_integrations`, `get_integration_setup_guide` (`provider` validado por `z.enum`); rótulos em `tool-labels.ts`; system prompt atualizado com as novas capacidades.
- **Decisões da Fase 3** registradas em `ARCHITECTURE.md` (Telegram híbrido, Whisper/Groq) e no plano acima.

**Testes:** `npm test` 94/94 · `npm run test:db` 72/72 (inclui usuário `member`: lê mas não desconecta; ninguém lê/grava segredos; texto puro recusado; código de vínculo de uso único e com expiração) · `tsc --noEmit` OK · lint limpo · build OK. TDD: RED verificado antes de cada implementação.

### 2.4 Uso do plano, atividades, estorno e exclusão de conversa — ✅ (2026-11-18) · **Fase 2 concluída**
- **Migration** `supabase/migrations/20261118151441_usage_refund.sql`: `public.refund_usage` (mesmo período do consumo, nunca abaixo de zero, execute só `service_role`).
- **`lib/services/usage.ts`:** `refundUsage` (não lança, registra `[usage]`), `usageLevel` (percentual, alerta ≥ 80%, esgotado ≥ 100%; limite 0 = esgotado).
- **Estorno em `app/api/hermes/route.ts`:** 1 crédito devolvido uma única vez se o stream falhar (`onError` ou `onEnd` com `outcome.status === "failed"`) ou se a preparação falhar depois da cobrança; interrupção pelo usuário (`aborted`) não estorna.
- **`lib/hermes/tool-labels.ts`:** `toolLabel` + `CHANNEL_LABELS` compartilhados (chat e dashboard); teste exige rótulo para toda Tool registrada.
- **`components/usage-card.tsx`:** barras por métrica com alerta amarelo (80%) e vermelho (100%) e link para planos; usado em `/dashboard` e `/billing`.
- **Dashboard:** feed "Atividades recentes" (últimas 6 ações: rótulo pt-BR, Hermes/manual, canal, horário; estado vazio explicativo) e coluna com uso do plano + próximos passos.
- **Excluir conversa:** `deleteConversation` (RLS; 0 linhas → "Não encontramos esta conversa…"), Server Action `app/(app)/hermes/actions.ts` (Zod uuid, rate limit 30/min por usuário) e `delete-conversation-button.tsx` (confirmação antes de excluir) na lista e no cabeçalho do chat.
- `ARCHITECTURE.md`: estorno documentado; nome da chave do cofre corrigido para `VAULT_ENCRYPTION_KEY`.

**Testes:** `npm test` 84/84 · `npm run test:db` 54/54 · `tsc --noEmit` OK · lint limpo · build OK. TDD: RED verificado antes de cada implementação (banco, `refundUsage`/`usageLevel`, rótulos, estorno na rota, ação de excluir).

### 2.3 Chat `/hermes` com streaming — ✅ (2026-11-18)
- **Migration** `supabase/migrations/20261118042206_hermes_chat.sql`: `hermes_conversations` (privada do usuário na org; `user_id` sempre `auth.uid()`) e `hermes_messages` (só servidor grava; unique `(conversation_id, message_id)`).
- **`lib/hermes/chat.ts`:** `chatRequestSchema` (só a nova mensagem de texto do usuário, até 4.000 caracteres), `conversationTitle`, `messagesToPersist`.
- **`lib/hermes/system-prompt.ts`:** prompt em pt-BR acolhedor, Contexto Mestre como dados (`<contexto_mestre>`), regras de Tools/segurança, recursos "em breve"; data por último (cache).
- **`lib/services/conversations.ts`:** `listConversations`, `ensureConversation`, `loadConversationMessages` (últimas 40), `saveConversationMessages` (admin, idempotente).
- **`app/api/hermes/route.ts`:** sessão obrigatória (`loadWorkspace`), Zod, rate limit 20/min por usuário, 1 crédito por turno (402 no limite), conversa alheia → 404, histórico do banco, `streamText` com `claude-opus-5-5`, effort `medium`, `fallbacks: "default"`, até 6 passos; salva mensagens no `onEnd`.
- **`lib/workspace.ts`:** `loadWorkspace` (sem redirect, para APIs) + `requireWorkspace`. **Middleware:** `/api/*` sem sessão → 401 JSON.
- **UI:** `app/(app)/hermes/page.tsx` (lista de conversas, nova conversa) + `chat.tsx` (boas-vindas didática, o que já faz/em breve, sugestões, status das Tools em pt-BR, erros amigáveis, parar resposta, aviso de crédito). Menu ganhou "Agente Hermes"; dashboard leva ao chat.
- **Deps:** `@ai-sdk/react`; React atualizado para patch `~19.1.2` (exigência do `@ai-sdk/react` + correções de segurança do 19.1.x). `ANTHROPIC_API_KEY` no `.env.example`.

**Testes:** `npm test` 69/69 (inclui rota com mocks: 401/403/400/429/402/404 e payload enviado ao modelo) · `npm run test:db` 49/49 · `tsc --noEmit` OK · lint limpo · build OK · smoke `next start`: `/api/hermes` sem sessão → 401 JSON, `/hermes` → 307 `/login?next=/hermes`. Sem chamada real ao modelo (sem chave) → item no checklist.

### 2.2 Registro de Tools do Hermes — ✅ (2026-11-18)
- **Deps:** `ai@^7` (Vercel AI SDK; API `tool({ description, inputSchema, execute, needsApproval })`) e `@ai-sdk/anthropic@^4`.
- **`lib/services/errors.ts`:** `ServiceError` (mensagem segura para o usuário); `PlanLimitError` agora estende `ServiceError`.
- **`lib/hermes/run-tool.ts`:** `defineTool`, `runTool` (Zod → execute → `recordHermesLog`; erro interno nunca vaza para o usuário).
- **`lib/hermes/tools.ts`:** `HERMES_TOOLS` + `buildHermesTools(ctx)` com `get_brand_context`, `update_brand_context` (patch parcial revalidado), `get_plan_and_usage`, `list_recent_activity`.
- **Services novos:** `account.ts` (`getPlanAndUsage`), `activity.ts` (`listRecentActivity`, sem coluna `error`); `brand.ts` ganhou `inputFromBrandRow`, `mergeBrandPatch` e erro amigável para membro sem permissão (RLS `42501`).

**Testes:** `npm test` 53/53 · `npm run test:db` 37/37 (corrigido em 2.3; antes reportado como 41) · `tsc --noEmit` OK · lint limpo · build OK. TDD: RED verificado antes de cada implementação.

### 2.1 Dados do Hermes + camada de services — ✅ (2026-11-18)
- **Migration** `supabase/migrations/20261118040239_hermes_logs_and_usage.sql`: `hermes_logs` (auditoria; membros só leem, servidor grava), `usage_counters` + `public.consume_usage` (consumo atômico mensal, fuso de Brasília, execute só `service_role`).
- **Services** (`lib/services/`): `context.ts` (`ServiceContext` + `serviceContext(workspace, via, channel)`), `usage.ts` (`limitFor`, `currentPeriodStart`, `consumeUsage` → `PlanLimitError` com mensagem pt-BR, `getUsageSummary`), `hermes-log.ts` (`recordHermesLog`, não derruba a ação se falhar), `brand.ts` (`getBrandContext`, `saveBrandContext`, `brandRowFromInput`).
- **Refactor dual-control:** `app/onboarding/actions.ts` usa `saveBrandContext`.
- **Teste de banco:** stub do `service_role` agora com `bypassrls` + default privileges (igual Supabase).

**Testes:** `npm test` 39/39 · `npm run test:db` 37/37 (corrigido em 2.3; antes reportado como 41) · lint limpo · build OK. TDD: RED verificado antes de cada implementação.

### 1.2 Blindagem de segurança — ✅ (2026-11-18)
- **Governança:** regras permanentes em `AGENTS.md` §6, `CLAUDE.md` e `ARCHITECTURE.md` §5 (revezamento via `PROGRESS.md`, Git semântico, segurança multi-tenant). `.gitignore` rigoroso (env, chaves, certificados, builds, temporários Supabase, skills) e `.gitattributes` (LF).
- **Rate limiting:** `supabase/migrations/20261118035149_rate_limits.sql` (`private.rate_limits` + `public.rate_limit_hit`, execute só `service_role`); `lib/rate-limit.ts` (limites em `RATE_LIMITS`, falha aberta). Aplicado em `signIn` (IP + e-mail), `signUp`, `/auth/callback`, `completeOnboarding`, `startCheckout`/`openBillingPortal`, `/api/webhooks/stripe` (429).
- **Zod:** `planId` do checkout (`z.enum`), params do callback, `organization_id` (uuid) nos metadados do webhook Stripe.
- **Cofre:** `lib/vault.ts` AES-256-GCM (`v1:iv:tag:ct`, AAD = dono do segredo), `VAULT_ENCRYPTION_KEY` no `.env.example`. Uso real na Fase 3 (`integration_secrets`).
- **Testes de banco no repo:** `supabase/tests/rls-check.mjs` + `npm run test:db` (PGlite).
- `signOut` sem rate limit (sem payload, idempotente).

**Testes:** `npm test` 31/31 · `npm run test:db` 22/22 · `npm run lint` limpo · `npm run build` OK.

### 1.1 Fundação — ✅ (2026-11-18)
- **Scaffold:** Next.js 15.5 (App Router, Turbopack), TypeScript, Tailwind 4, shadcn (radix-nova), Framer Motion, Lucide, Zod 4, Vitest 5, Supabase CLI (`supabase/config.toml`), Stripe SDK.
- **Docs:** `AGENTS.md` (spec + convenções + governança), `CLAUDE.md` (importa AGENTS.md), `ARCHITECTURE.md` (decisões, schema completo, Tools do Hermes, 8 fases, segurança).
- **Design system:** tema dark Clinkup em `app/globals.css` (tokens, `.glass`, `.text-gradient`, `.bg-grid`), Inter + Plus Jakarta Sans, `config/tenant-brand.ts` (White-Label por env).
- **Banco:** `supabase/migrations/20261118032531_foundation.sql` — `organizations`, `organization_members`, `profiles`, `brand_context`, `subscriptions`; helpers `private.is_org_member/is_org_admin`; triggers (perfil no signup; owner + trial Starter 14 dias na criação da org); RLS + grants explícitos + grants de coluna (`plan_id`, `is_white_label`, `is_super_admin` protegidos).
- **Auth:** `lib/supabase/{client,server,admin,middleware}.ts`, `middleware.ts` (`getClaims`, rotas protegidas), `app/(auth)` login/cadastro, `app/auth/callback` (PKCE), `lib/safe-redirect.ts` (anti open-redirect).
- **Onboarding:** `app/onboarding` wizard 4 etapas (validação por etapa + servidor), `lib/onboarding.ts` (schema Zod, Contexto Mestre, slug).
- **App shell:** `app/(app)/layout.tsx` + `nav.tsx` (módulos futuros "Em breve"), `lib/workspace.ts` (usuário + org + assinatura; redireciona para onboarding), `/dashboard` inicial.
- **Planos & billing:** `config/plans.ts` (Starter R$197 / Growth R$497 / Scale R$1.297 + limites), `components/pricing-table.tsx` (landing `/#planos` e `/billing`), checkout Stripe + portal (`app/(app)/billing/actions.ts`; assinante ativo troca de plano pelo portal), webhook assinado `app/api/webhooks/stripe/route.ts`, `lib/billing.ts` (mapeamento de status).
- **Landing:** `app/page.tsx` (hero, recursos, planos).

**Testes:** `npm test` 21/21 · `npm run lint` limpo · `npm run build` OK · smoke `next start` (`/` 200, rotas protegidas 307) · migration validada no PGlite com `auth` simulado (16/16 checks de RLS/grants).

## Pendências conhecidas
- Não testado contra Supabase real nem Stripe ponta a ponta (sem Docker local). → 1.3
- Sem convite de membros, upload de logo (Storage) e `/admin` (Fase 8).
- Stripe: configurar 3 prices mensais (`STRIPE_PRICE_*`), webhook `/api/webhooks/stripe` e troca de plano no Customer Portal.
- Skills fora do Git: restaurar com `npx skills experimental_install` (lê `skills-lock.json`).

## Como validar localmente
```bash
npm install
cp .env.example .env.local   # preencher
npm test && npm run test:db && npm run lint && npm run build
npx supabase link && npx supabase db push
npm run dev
```
