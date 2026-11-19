# PROGRESS — CLINKUP HERMES PLATFORM

> Protocolo de revezamento Claude ↔ Codex. **Leia antes de começar; atualize ao fim de cada tarefa/módulo** (feito, arquivos, testes, próxima microtarefa). Regras: `AGENTS.md` §6. Plano: `ARCHITECTURE.md` §4.

## Estado atual

- **Fase:** 4 — CRM Inteligente: Kanban e Funil de Vendas (Fases 2 e 3 ✅ concluídas)
- **Etapa em andamento:** 4.3 — Ficha completa do lead e Visão de Funil
- **Decidido:** limite de leads no CRM por plano (`crmLeads`) — Starter 1.000 · Growth 10.000 · Scale 100.000 (confirmado pelo usuário em 2026-11-18).
- **Adiado pelo usuário:** 1.3 (validação com credenciais reais) fica para o final da construção — ver CHECKLIST DE GO-LIVE abaixo.
- **Última atualização:** 2026-11-18 — Claude

## Próxima microtarefa (exata)

**4.3 Ficha completa do lead e Visão de Funil** (TDD; carregar a skill `dataviz` antes de escrever o gráfico):
1. **Service:** `getLead(ctx, leadId)` (dados + nome da etapa), reaproveitando `listLeadActivities`, `updateLead`, `addLeadNote`; testes de isolamento por org e "lead não encontrado".
2. **Ficha** `app/(app)/crm/leads/[leadId]/page.tsx` (link pelo nome do card no Kanban): dados de contato com links de ação (WhatsApp `wa.me`, e-mail, site, Instagram), valor, origem, responsável, próxima reunião; formulário de edição (`updateLeadAction` com `leadPatchSchema`); seletor de etapa (reusa `moveLeadAction`); exclusão só owner/admin; **linha do tempo** (notas, mudanças de etapa, reuniões; ícone por tipo; "por você", "por fulano" ou "pelo Hermes"); campo de nova anotação (`addLeadNoteAction` com `noteSchema`).
3. **Funil:** `funnelMetrics(stages)` pura em `lib/crm/funnel.ts` — por etapa: quantidade, valor, % do total e **taxa de passagem** para a próxima (leads que estão na etapa ou além ÷ os que estão na anterior ou além, etapas abertas na ordem + ganho; perdidos à parte) e conversão geral; testes com casos de zero.
4. **Visão de Funil** em `/crm?view=funil` (abas "Quadro | Funil"): gráfico de funil/barras com Recharts (instalar versão fixa, cores dos tokens, tooltip pt-BR) + **tabela acessível** com os mesmos números; estado vazio didático.
5. Nota de produto: a taxa de passagem é calculada pela foto atual do funil; histórico real por período (a partir de `crm_activities.stage_change`) fica como evolução.

**Plano da Fase 4:**
- 4.1 dados + services ✅.
- 4.2 `/crm` Kanban ✅.
- 4.3 Ficha do lead + Visão de Funil (acima).
- 4.4 Tools do Hermes: `create_lead`, `update_lead`, `move_lead_to_stage`, `list_leads`, `add_lead_note`, `get_funnel_metrics` (rótulos pt-BR) — mesmas funções da UI.
- 4.5 Reunião na Agenda do Google a partir do lead (`schedule_meeting`, usa `getGoogleAccessToken` da 3.5; cria evento com convite) + KPI "Oportunidades no funil" e "Taxa de conversão" no dashboard.

**Plano da Fase 3 (concluída):**
- 3.1 dados + cofre ✅.
- 3.2 `/integrations` ✅.
- 3.3 Telegram ✅: **3.3a** bot da plataforma, **3.3b** áudio, **3.3c** bot próprio White-Label. Decisões fechadas em 2026-11-18, ver `ARCHITECTURE.md` §1:
  - SaaS: bot único da plataforma (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`), webhook `/api/webhooks/telegram`; "Gerar código" na UI (Server Action, código de 8 caracteres `[A-Z0-9]` sem ambíguos, gravado via admin) e `/vincular CODIGO` → `consume_telegram_link_code` → `saveIntegration(provider: "telegram", externalAccountId: chat_id, metadata: { user_id })`.
  - White-Label/Enterprise: admin cadastra o token do próprio bot (cifrado em `integration_secrets`), plataforma chama `setWebhook` para `/api/webhooks/telegram/[slug]` com segredo próprio por bot.
  - Mensagens: Zod no update, header `X-Telegram-Bot-Api-Secret-Token`, rate limit por `chat_id`, Hermes no canal `telegram` (mesmas Tools, 1 crédito por mensagem, estorno em falha; resposta via `generateText`).
  - Áudio: OpenAI Whisper `whisper-1` (`OPENAI_API_KEY`) por padrão; Groq (`GROQ_API_KEY`) quando configurado; limitar duração/tamanho do áudio.
- 3.4 OAuth Meta (Instagram, Página do Facebook, Meta Ads) ✅.
- 3.5 OAuth Google (Google Meu Negócio + Calendar) ✅.

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
- [ ] **Bot do Telegram (Fase 3.3a):** criar o bot no @BotFather (`/newbot`), guardar o token em `TELEGRAM_BOT_TOKEN` e o username em `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`; definir descrição e foto do bot com a marca.
- [ ] **Registrar o webhook do Telegram (Fase 3.3a):** `curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" -d "url=https://<domínio>/api/webhooks/telegram" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" -d 'allowed_updates=["message"]'` e conferir com `getWebhookInfo` (sem `last_error_message`).
- [ ] **Fluxo Telegram de ponta a ponta (Fase 3.3a):** gerar código em `/integrations`, tocar em "Abrir o Telegram e vincular" (deep link) e também testar `/vincular CODIGO` manual; código vencido/usado deve ser recusado; mensagem de texto responde pelo Hermes; conferir `integrations` (provider `telegram`), conversa "Conversa no Telegram" em `/hermes`, `hermes_logs` com canal `telegram` e `ai_credits` +1. Como `member`, pedir para mudar o tom de voz → deve ser recusado (checagem de papel sem RLS).
- [ ] Hospedagem executa `after()` do Next.js até o fim (na Vercel usa `waitUntil`; respeita `maxDuration = 120` em `/api/webhooks/telegram`). Se não executar, as respostas do Telegram nunca chegam.
- [ ] Monitorar logs `[telegram]` (falha ao enviar mensagem ou processar update).
- [ ] **Áudio no Telegram (Fase 3.3b):** com `OPENAI_API_KEY` (e depois com `GROQ_API_KEY`), enviar áudio de voz e arquivo de áudio: a resposta começa com "🎙️ Entendi: “…”" e cobra 1 crédito; áudio acima de 5 min é recusado sem cobrança; sem crédito no mês, recusa sem transcrever; sem nenhuma chave configurada, mostra "A transcrição de áudio ainda não está disponível…".
- [ ] **Desvincular o próprio Telegram (Fase 3.3b):** como `member`, ver o botão "Desvincular meu Telegram" só na linha do próprio chat e conseguir desvincular; não ver botão nas linhas de outras pessoas; como admin, "Desconectar" continua disponível para as demais linhas.
- [ ] Custo da transcrição (Whisper/Groq) considerado no preço dos planos (hoje o áudio custa 1 crédito, igual ao texto).
- [ ] `db push` aplica também a migration `telegram_own_bot` (Fase 3.3c: valor `telegram_bot` no enum + `consume_telegram_link_code(code, org)`).
- [ ] **Bot próprio de ponta a ponta (Fase 3.3c):** com uma org no plano Scale (ou `is_white_label = true`), como owner, cadastrar o token de um bot de teste em `/integrations` → conferir `getWebhookInfo` do bot apontando para `https://<domínio>/api/webhooks/telegram/<slug>` sem erro; vincular pelo botão (deve abrir o `@username` do bot próprio); conversar por texto e áudio; créditos debitados **na própria org**.
- [ ] **Isolamento do bot próprio (Fase 3.3c):** gerar código na org B e enviá-lo ao bot da org A → deve ser recusado e o código continuar válido para a org B; o segredo do bot da plataforma e o de outra empresa devem receber 401 na rota `[slug]`; remover o bot próprio deve apagar os vínculos feitos por ele.
- [ ] `NEXT_PUBLIC_SITE_URL` em produção com `https://` e o domínio final (usado no `setWebhook` do bot próprio; sem https o cadastro é recusado).
- [ ] Trocar `TELEGRAM_WEBHOOK_SECRET` invalida os webhooks de todos os bots próprios (segredo derivado): se precisar rotacionar, re-registrar cada bot (reconectar o token em `/integrations`).

### App na Meta Developers (Fase 3.4 — obrigatório para "Conectar com a Meta")
- [ ] Criar o app em developers.facebook.com (tipo **Business**), adicionar o produto **Facebook Login for Business** e vincular ao Business Manager verificado da Clinkup.
- [ ] Copiar App ID e App Secret para `META_APP_ID` e `META_APP_SECRET` (somente servidor; já no `.env.example`).
- [ ] **Valid OAuth Redirect URIs:** `https://<domínio>/api/integrations/meta/callback` (exatamente igual ao usado pela plataforma; inclui `https`).
- [ ] **Deauthorize Callback URL:** `https://<domínio>/api/webhooks/meta/deauthorize`.
- [ ] **Data Deletion Request URL:** `https://<domínio>/api/webhooks/meta/data-deletion` (status público em `/meta/exclusao-de-dados`).
- [ ] Domínio do app, URL da **Política de Privacidade** e dos **Termos de Uso** publicadas e preenchidas nas configurações básicas do app.
- [ ] **App Review** (acesso avançado) com screencast para cada escopo: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `business_management`, `ads_management`, `ads_read`. Enquanto não aprovado, só usuários com papel no app (administradores/testadores) conseguem conectar.
- [ ] **Verificação de empresa** (Business Verification) concluída na Meta — exigida para acesso avançado a `ads_management`/`business_management`.
- [ ] Teste de ponta a ponta com conta de teste: Conectar com a Meta → Páginas, Instagram e contas de anúncios aparecem em `/integrations`; `integration_secrets` com `v1:`; cancelar no diálogo mostra "A conexão com a Meta foi cancelada"; abrir o callback com `state` alterado mostra o aviso de segurança.
- [ ] **Validar na prática os endpoints não confirmados na doc durante a 3.4:** `/me/adaccounts?fields=id,name,account_status,business{id,name}` e `/{act}/adspixels` (contas de anúncios e Pixel) e o formato do `signed_request` da **desautorização** (assumido igual ao da exclusão de dados).
- [ ] Remover o app nas configurações do Facebook (Configurações > Apps e sites) com a conta de teste → conferir que as integrações Meta daquele usuário somem (callback de desautorização) e que o pedido de exclusão retorna `confirmation_code` e a página de status abre.
- [ ] Token do `meta_ads` expira em ~60 dias: até existir o alerta automático (fase de agendamentos), orientar admins a reconectar; monitorar logs `[meta]`.

### Google Cloud (Fase 3.5 — obrigatório para "Conectar com o Google")
- [ ] Criar o projeto no Google Cloud Console da Clinkup e ativar as APIs: **Google Calendar API**, **My Business Account Management API** e **My Business Business Information API**.
- [ ] **Pedido de acesso à Business Profile API** (formulário de solicitação de acesso do Google Business Profile): sem aprovação, as APIs do Business Profile não aparecem no console e o "Conectar com o Google" do card Google Meu Negócio cai em `?google=error`. A aprovação é manual e pode levar dias.
- [ ] **OAuth Consent Screen** (Google Auth Platform): tipo **Externo**, nome e logo da marca, e-mail de suporte, domínio autorizado, links da **Política de Privacidade** e dos **Termos de Uso**; escopos cadastrados: `https://www.googleapis.com/auth/business.manage`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
- [ ] **Verificação do app pelo Google** para os escopos sensíveis (vídeo de demonstração + justificativa de uso). Enquanto em modo "Teste", só usuários de teste cadastrados conseguem conectar e o refresh token pode expirar em 7 dias.
- [ ] Credencial **OAuth client ID** tipo **Web application** → `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (somente servidor; já no `.env.example`).
- [ ] **Authorized redirect URIs:** `https://<domínio>/api/integrations/google/callback` (exatamente igual ao usado pela plataforma).
- [ ] `db push` não precisa de migration nova para a 3.5 (usa `integrations`/`integration_secrets` existentes).
- [ ] Teste de ponta a ponta: conectar Google Meu Negócio (locais aparecem no card) e Google Calendar (agenda principal aparece); `integration_secrets.refresh_token_encrypted` preenchido com `v1:`; cancelar no Google mostra "A conexão com o Google foi cancelada".
- [ ] **Validar na prática o que não foi confirmado na doc durante a 3.5:** parâmetros da renovação (`grant_type=refresh_token`), campo `title` no `readMask` dos locais e a leitura `GET /calendar/v3/users/me/calendarList/primary`.
- [ ] Renovação: forçar `expires_at` no passado em staging e conferir que a próxima chamada renova o token sem pedir login; revogar o acesso em myaccount.google.com e conferir que a integração vira "Precisa de atenção".
- [ ] Revogação ao desconectar: desconectar a **última** integração de um consentimento revoga no Google (o app some de myaccount.google.com → Segurança → Apps de terceiros); com dois locais do mesmo consentimento, desconectar um **não** derruba o outro.
- [ ] Monitorar logs `[google]` (falha no callback, renovação ou revogação).

### CRM (Fase 4)
- [ ] `db push` aplica a migration `crm` (Fase 4.1) — ela também **altera o trigger `handle_new_organization`** (cria o funil padrão) e faz **backfill** do funil para todas as empresas já existentes. Conferir depois: `select count(*) from organizations o where not exists (select 1 from crm_pipelines p where p.organization_id = o.id and p.is_default)` deve dar 0.
- [ ] Rodar advisors do Supabase depois do `db push` (novas FKs compostas, índices e policies do CRM).
- [x] **Confirmar com o produto o limite de leads no CRM por plano** (`config/plans.ts` → `crmLeads`: 1.000 / 10.000 / 100.000) antes de publicar a página de preços, que já mostra "Leads no CRM". — Evidência: confirmado pelo usuário em 2026-11-18 (mensagem de abertura da 4.2).
- [ ] **Kanban em produção (Fase 4.2):** arrastar com mouse, toque (celular) e teclado (Tab até a alça ⋮⋮, espaço, setas, espaço) com leitor de tela anunciando em português; mover para outra etapa gera "Movido de … para …" no histórico; abrir o mesmo quadro em duas abas, excluir um lead numa e tentar movê-lo na outra → o card volta ao lugar com aviso.
- [ ] Etapas: como owner/admin, criar, renomear/mudar cor, reordenar com as setas e excluir etapa vazia; tentar excluir etapa com leads → mensagem "ainda tem N leads"; como member, nenhum desses controles aparece e excluir lead não aparece.
- [ ] Dashboard: "Oportunidades no funil" igual à soma dos leads nas etapas abertas (não conta "Fechado").
- [ ] Teste real de isolamento: com duas empresas, criar lead na empresa A e tentar, pela API REST com o token de um usuário da B, ler/alterar o lead e mover para uma etapa da B (deve falhar por RLS e pela FK composta).

### Variáveis de ambiente (produção, só no painel da hospedagem — nunca no Git)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `SUPABASE_SECRET_KEY` (somente servidor)
- [ ] `NEXT_PUBLIC_SITE_URL` (domínio de produção)
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`
- [ ] `VAULT_ENCRYPTION_KEY` (32 bytes base64; guardar backup seguro — perder a chave = perder todos os tokens de integração)
- [ ] `ANTHROPIC_API_KEY` (Fase 2.2+, Agente Hermes)
- [ ] Planejadas para a Fase 3.3 (entram no `.env.example` quando o código usar): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPENAI_API_KEY` (Whisper), `GROQ_API_KEY` (opcional).
- [ ] `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (somente servidor) e `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` — já no `.env.example` (Fase 3.3a).
- [ ] `OPENAI_API_KEY` (Whisper `whisper-1`) e, opcional, `GROQ_API_KEY` (se presente, tem prioridade) — somente servidor, já no `.env.example` (Fase 3.3b).
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

### 4.2 Quadro Kanban com arrastar e soltar — ✅ (2026-11-18)
- **Deps:** `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2 (peer `react >=16.8`, ok com React 19.1).
- **Service (`lib/services/crm.ts`):** `createStage` (máx. 20), `updateStage`, `reorderStages` (só aceita exatamente as etapas do funil), `deleteStage` (só vazia e nunca a última), `deleteLead`, `countOpenOpportunities`; `assertAdmin` explícito (member recusado mesmo em canais sem RLS); `getDefaultPipeline` reaproveitado.
- **`lib/crm/board.ts`:** `moveCardInBoard` (pura, imutável) para a atualização otimista.
- **Actions `app/(app)/crm/actions.ts`:** move, criar/excluir lead, criar/editar/reordenar/excluir etapa — Zod, rate limit `crmUser` 120/min, erro amigável (interno nunca vaza), `revalidatePath("/crm")`.
- **UI:** `/crm` com aviso para member e contagem de leads vs. limite do plano; `board.tsx` com alça de arrastar acessível, teclado e anúncios pt-BR, `DragOverlay`, rollback com toast, criação rápida por coluna, edição/cor/reordenação/exclusão de etapas e exclusão de lead (só owner/admin, com confirmação), estado vazio didático.
- Menu "CRM" ativo; KPI "Oportunidades no funil" real no dashboard com atalho para o CRM.

**Testes:** `npm test` 238/238 (19 novos, RED verificado antes) · `npm run test:db` 96/96 · `tsc --noEmit` OK · lint limpo · build OK. Interação de arrastar (mouse/teclado/toque) e leitor de tela **não** testados no navegador — itens no checklist.

### 4.1 Dados do CRM + services — ✅ (2026-11-18)
- **Migration** `supabase/migrations/20261119003114_crm.sql`: enums `crm_stage_kind`, `crm_lead_source`, `crm_activity_type`; tabelas `crm_pipelines`, `crm_stages`, `crm_leads`, `crm_activities` com **FKs compostas** (lead → etapa do mesmo funil e da mesma empresa; atividade → lead da mesma empresa), índices de quadro e histórico, `updated_at`. RLS: membros leem e operam leads/histórico (`created_by = auth.uid()`), só owner/admin gerenciam funis/etapas e excluem leads, histórico só de inclusão.
- **Funil padrão** `private.create_default_pipeline`: chamado pelo trigger `handle_new_organization` (recriado com a etapa extra) e por **backfill** na migration.
- **`lib/services/crm.ts`** (dual-control, filtra `organization_id` sempre): `computePosition`, `getDefaultBoard`, `createLead` (limite `crmLeads` do plano → mensagem pt-BR com upgrade), `updateLead`, `moveLead` (renumeração rara + histórico `stage_change` com `created_via`), `addLeadNote`, `listLeadActivities`; schemas `leadInputSchema` (campos vazios do formulário viram ausentes), `leadPatchSchema`, `moveLeadSchema`, `noteSchema`.
- **Plano:** `config/plans.ts` ganhou `crmLeads` e a tabela de preços mostra "Leads no CRM".
- **Teste de banco:** o runner cria uma "empresa antiga" antes da migration do CRM para provar o backfill.

**Testes:** `npm test` 219/219 (10 novos, RED verificado antes) · `npm run test:db` 96/96 (20 novos: funil padrão em empresa nova e antiga, isolamento, FK composta, papéis, histórico) · `tsc --noEmit` OK · lint limpo · build OK.

### 3.5 OAuth Google — Google Meu Negócio e Google Calendar — ✅ (2026-11-18) · **Fase 3 concluída**
- **Conferido na doc oficial antes de codar:** endpoints de autorização/token/revogação, `access_type=offline` + `prompt=consent` (o `refresh_token` só vem na 1ª autorização sem o prompt), `error=access_denied`, escopo `business.manage` (com aprovação de acesso à API), escopos do Calendar, contas (`mybusinessaccountmanagement v1`) e locais (`mybusinessbusinessinformation v1`, `readMask`). Não confirmados na leitura (marcados no checklist): parâmetros exatos da renovação, campo `title` no `readMask` e `calendarList/primary`.
- **`lib/integrations/oauth-state.ts`:** campo `context` assinado (produto Google) — reaproveitado sem nova lógica de segurança.
- **`lib/integrations/google.ts`:** `GOOGLE_SCOPES` por produto, `googleAuthorizeUrl`, `exchangeGoogleCode`, `fetchGoogleBusinessLocations`, `fetchGooglePrimaryCalendar`, `mapGoogleConnections` (pura; `google_grant_id` comum às linhas de um consentimento), `getGoogleAccessToken` (renova e regrava cifrado; `invalid_grant` → `needs_attention`), `googleTokenToRevoke` (só a última linha do grant), `revokeGoogleToken` (melhor esforço).
- **Rotas:** `api/integrations/google/start?product=business|calendar` e `/callback` (só owner/admin, rate limit, Zod, state + nonce + mesmo usuário/org, exige refresh token, resultado em `/integrations?google=`).
- **Desconectar:** `disconnectIntegrationAction` recusa `member` antes de tudo, lê o token a revogar, remove a integração e só então revoga.
- **UI:** "Conectar com o Google" ativo nos cards Google Meu Negócio e Google Calendar (admin; member vê orientação); avisos de retorno pt-BR; guias do catálogo com o nome real do botão. Nenhum card de `/integrations` tem mais o aviso "em breve".
- `.env.example`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. `ARCHITECTURE.md`: fluxo OAuth Google, renovação e revogação.

**Testes:** `npm test` 209/209 (19 novos; RED verificado antes — exceto o teste do `context` no state, que já passou porque o campo era assinado pelo spread; só o tipo foi ajustado) · `npm run test:db` 76/76 · `tsc --noEmit` OK · lint limpo · build OK. Chamadas reais às APIs do Google só cobertas por mocks — validação real no checklist.

### 3.4 OAuth Meta — Instagram, Página do Facebook e Meta Ads — ✅ (2026-11-18)
- **Conferido na doc oficial antes de codar:** Graph API **v27.0**, diálogo/troca de código/token de longa duração, token de Página via `/{user}/accounts`, `instagram_business_account`, escopos e o formato do `signed_request` de exclusão de dados. Não confirmados na leitura (marcados no checklist): `/me/adaccounts`, `/{act}/adspixels` e o callback de desautorização.
- **`lib/integrations/oauth-state.ts`:** state assinado (chave derivada de `VAULT_ENCRYPTION_KEY`, sem env nova), nonce em cookie `httpOnly`, validade de 10 min, exige mesmo usuário/org/provedor. Pronto para o Google.
- **`lib/integrations/meta.ts`:** `META_GRAPH_VERSION`, `META_SCOPES`, `metaAuthorizeUrl`, `verifySignedRequest`, `exchangeMetaCode` (curto → longa duração), `fetchMetaAccounts`, `mapMetaConnections` (pura). `saveIntegration` aceita `status`.
- **Rotas:** `api/integrations/meta/start` e `/callback` (só owner/admin, rate limit, Zod nos parâmetros, cookie limpo sempre, resultado em `/integrations?meta=`); `api/webhooks/meta/deauthorize` e `/data-deletion` (`lib/integrations/meta-compliance.ts`: rate limit por IP, `signed_request` verificado) + `deleteMetaUserData`; página pública `app/meta/exclusao-de-dados` (rota `/meta` liberada no middleware).
- **UI:** "Conectar com a Meta" ativo nos cards Instagram, Página do Facebook e Meta Ads (admin; member vê orientação); avisos de retorno pt-BR (conectado, nada autorizado, cancelado, segurança, sem permissão, indisponível, erro); guias do catálogo com o nome real do botão.
- `.env.example`: `META_APP_ID`, `META_APP_SECRET`. `ARCHITECTURE.md`: fluxo OAuth Meta, tokens por tipo de conta, conformidade.

**Testes:** `npm test` 190/190 (21 novos, RED verificado antes) · `npm run test:db` 76/76 · `tsc --noEmit` OK · lint limpo · build OK · smoke `next start`: página de status 200, `signed_request` forjado → 400 nos dois callbacks, início OAuth sem sessão → 401. `exchangeMetaCode`/`fetchMetaAccounts` (chamadas reais à Graph API) só cobertos via mocks nas rotas — validação real no checklist.

### 3.3c Telegram — bot próprio White-Label/Scale — ✅ (2026-11-18) · **módulo Telegram concluído**
- **Migration** `supabase/migrations/20261118235159_telegram_own_bot.sql`: `telegram_bot` no enum `integration_provider`; `consume_telegram_link_code(p_code, p_organization_id default null)` — com org, código de outra empresa nem é consumido.
- **`lib/telegram/telegram.ts`:** `TelegramScope`, `deriveBotWebhookSecret(slug)` (HMAC-SHA256 do segredo mestre), `callTelegram` (getMe/setWebhook/deleteWebhook via fetch).
- **`lib/services/telegram-bot.ts`:** `canUseOwnBot` (Scale ou `is_white_label`), `findOrganizationBySlug`, `getOwnTelegramBot`, `connectOwnTelegramBot` (só owner/admin; exige `NEXT_PUBLIC_SITE_URL` https; `getMe` → remove bot anterior → `setWebhook` com segredo derivado → token cifrado como `telegram_bot`), `disconnectOwnTelegramBot` (deleteWebhook + remove config e vínculos do bot).
- **Isolamento:** vínculos pelo bot próprio com `external_account_id = "<botId>:<chatId>"` + filtro de org em `findTelegramLink`; `linkTelegramChat` com escopo não apaga vínculos de outras empresas; handler recusa sessão de outra org; dedupe de `update_id` por bot.
- **Rota `app/api/webhooks/telegram/[slug]/route.ts`:** slug validado, segredo derivado conferido antes do banco (segredo da plataforma ou de outra empresa → 401), 404 sem org/bot, token do cofre, mesmo handler com escopo.
- **UI:** `own-bot-panel.tsx` no card do Telegram (só owner/admin): passo a passo do @BotFather + token (Zod, rate limit 5/10 min), estado do bot e "Remover bot próprio" com confirmação; fora do plano mostra convite para Scale/White-Label. Vínculo rápido usa o `@username` do bot próprio quando configurado.

**Testes:** `npm test` 169/169 (RED verificado antes nos 19 novos; 1 teste antigo ajustado porque a assinatura de `linkTelegramChat` ganhou o 3º parâmetro) · `npm run test:db` 76/76 · `tsc --noEmit` OK · lint limpo · build OK · smoke `next start`: `[slug]` sem segredo 401, com segredo mestre da plataforma 401, slug inválido 404.

### 3.3b Telegram — áudio + desvincular o próprio chat — ✅ (2026-11-18)
- **`lib/transcription.ts`:** `transcribeAudio` via `fetch` + `FormData` (sem dependência nova): Groq `whisper-large-v3-turbo` se `GROQ_API_KEY`, senão OpenAI `whisper-1`; `language: pt`; sem chave → `ServiceError` amigável.
- **`lib/telegram/telegram.ts`:** schema aceita `voice` e `audio` (`file_id`, `duration`, `file_size`); `downloadTelegramFile` (getFile → download, limite checado antes e depois, devolve `File` com extensão real).
- **`lib/telegram/handler.ts`:** áudio até 5 min / 10 MB; só transcreve chat vinculado e com crédito no mês; transcrição vazia ou com erro → "Não consegui entender…" sem cobrar; texto entendido segue o mesmo turno (**1 crédito**, sem extra) e a resposta vem com "🎙️ Entendi: “…”". Refatorado em `linkedSession` + `answer` (texto e áudio sem duplicação).
- **Desvincular:** `unlinkOwnTelegram` (admin client filtrando `id + org + provider + metadata.user_id`) + `unlinkTelegramAction` (Zod, rate limit, `revalidatePath`). Card do Telegram mostra "Desvincular meu Telegram" só na linha do próprio usuário (qualquer papel); "Desconectar" de terceiros segue só para owner/admin.
- Textos: "áudio em breve" removido (catálogo, chat, bot); dica de desvincular no guia.
- `.env.example`: `OPENAI_API_KEY`, `GROQ_API_KEY`; linha do Telegram com caractere corrompido (gravada em ANSI na 3.3a) corrigida.

**Testes:** `npm test` 150/150 (16 novos, RED verificado antes; um deles pegou bug real: transcrição só com espaços não era tratada como vazia) · `npm run test:db` 72/72 · `tsc --noEmit` OK · lint limpo · build OK.

### 3.3a Telegram — bot da plataforma, vínculo e texto — ✅ (2026-11-18)
- **Núcleo compartilhado `lib/hermes/turn.ts` (`startHermesTurn`):** crédito, histórico, Contexto Mestre, modelo, prompt, Tools, estorno idempotente e persistência num só lugar. `app/api/hermes/route.ts` refatorado para usá-lo (os 11 testes da rota web seguiram verdes sem mudança).
- **`ServiceContext.role`** (vem de `workspace.role`, novo em `lib/workspace.ts`); `saveBrandContext` recusa `member` explicitamente (necessário no Telegram, onde o contexto usa cliente admin). Billing e `/integrations` passaram a usar `workspace.role` (2 consultas duplicadas removidas).
- **`lib/telegram/telegram.ts`:** schema Zod do update, `parseCommand` (`/start`, `/start CODIGO` do deep link, `/vincular CODIGO`), `verifyWebhookSecret` (tempo constante), `splitMessage`, `sendTelegramMessage` (fetch, texto puro). **`session.ts`:** `loadTelegramSession` (membership + onboarding). **`handler.ts`:** dedupe por `update_id`, só chat privado, rate limit 20/min por chat, vínculo, Hermes por `generateText`, estorno em falha, textos pt-BR didáticos.
- **`app/api/webhooks/telegram/route.ts`:** 401 sem segredo (falha fechado se a env estiver vazia), 503 sem token, 200 imediato + `after()`.
- **Integrações:** `createTelegramLinkCode` (alfabeto sem 0/1/I/O, `crypto.randomInt`, retry em colisão), `linkTelegramChat` (um chat = uma conta), `findTelegramLink`; `saveIntegration` aceita conexão sem token. `ensureTelegramConversation` (uma conversa por chat, visível no painel).
- **UI:** card Telegram com "Gerar código" ativo (`telegram-link.tsx`: código, validade, botão "Abrir o Telegram e vincular", comando com Copiar); aviso "em breve" removido desse card; guia do Telegram e chat atualizados.
- `.env.example`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`. `ARCHITECTURE.md`: núcleo do turno e fluxo do Telegram.

**Testes:** `npm test` 134/134 · `npm run test:db` 72/72 · `tsc --noEmit` OK · lint limpo · build OK · smoke `next start`: webhook sem segredo 401, segredo errado 401, certo 200. TDD com RED verificado em todo o código novo, **exceto** os 4 testes de `linkTelegramChat`/`findTelegramLink`, escritos depois da implementação.

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
