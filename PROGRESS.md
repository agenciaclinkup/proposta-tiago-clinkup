# PROGRESS — CLINKUP HERMES PLATFORM

> Protocolo de revezamento Claude ↔ Codex. **Leia antes de começar; atualize ao fim de cada tarefa/módulo** (feito, arquivos, testes, próxima microtarefa). Regras: `AGENTS.md` §6. Plano: `ARCHITECTURE.md` §4.

## Estado atual

- **Fase:** 6 — Estúdio (Fases 2, 3, 4 e 5 ✅ concluídas)
- **Etapa em andamento:** 6.2 — Interface do Estúdio e exportação para o calendário
- **Decidido:** limite de leads no CRM por plano (`crmLeads`) — Starter 1.000 · Growth 10.000 · Scale 100.000 (confirmado pelo usuário em 2026-11-18).
- **Adiado pelo usuário:** 1.3 (validação com credenciais reais) fica para o final da construção — ver CHECKLIST DE GO-LIVE abaixo.
- **Última atualização:** 2026-11-19 — Codex

## Próxima microtarefa (exata)

**6.2 Estúdio — interface e exportação para o calendário:** criar `/studio` para listar e editar carrosséis, slides hook/conteúdo/CTA, tema e imagens, reutilizando os schemas e serviços de 6.1; fornecer estados acessíveis, claros e responsivos. Implementar exportação dos slides para um rascunho no calendário usando o serviço social compartilhado, copiando assets autorizados de `studio-assets` para `social-media` sob a mesma empresa, sem publicar ou agendar implicitamente. Definir geração real com cobrança idempotente e estorno explícito apenas quando o provedor estiver integrado; não disparar uma geração novamente quando `created` for `false`. Tratar interrupções de gerações `started` e limpeza de arquivos órfãos antes de integrar provedores. Cobrir permissões, isolamento, falhas, limites e testes de interface; manter checklist e preparar a próxima microtarefa da Fase 6.

**Plano da Fase 4:**
- 4.1 dados + services ✅.
- 4.2 `/crm` Kanban ✅.
- 4.3 Ficha do lead + Visão de Funil ✅.
- 4.4 Tools do Hermes para o CRM ✅.
- 4.5 Reunião na Agenda do Google e indicadores no dashboard ✅.

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
- [ ] **Reuniões e dashboard (Fase 4.5):** com Google Calendar real conectado, agendar pela ficha e pelo Hermes, conferir convite recebido, fuso de Brasília, renovação de token, registro na linha do tempo e isolamento entre empresas; conferir conversão e valor do dashboard contra a visão do funil. Validar ausência de conexão e recuperação após falha parcial antes de tentar novamente.
- [ ] **Calendário (Fase 5.1):** aplicar migration `20261119022436_social_posts.sql`, rodar advisors e validar com duas empresas os grants/RLS, integridade dos destinos, limite mensal sob concorrência e rollback. Uma integração referenciada por post não pode ser desconectada até as referências serem tratadas; validar o fluxo de desconexão antes do lançamento.
- [ ] **Calendário (Fase 5.2):** aplicar `20261119024027_social_media_bucket.sql`; conferir bucket `social-media` privado, limite de 50 MB e MIME permitidos, upload assinado e acesso entre duas empresas. Definir limpeza segura de uploads órfãos antes do lançamento. Validar visualmente `/calendar` em desktop e celular, navegação por teclado, mês/semana/lista, edição, fuso e erros com Supabase real; o ambiente desta etapa não tinha navegador disponível nem credenciais. A listagem atualmente avisa ao atingir 1.000 posts; implementar paginação antes de operações maiores.
- [ ] **Publicador (Fase 5.3, parcial):** aplicar `20261119025634_social_publish_queue.sql` e rodar advisors. Configurar `CRON_SECRET` aleatório de pelo menos 32 caracteres somente no servidor e no agendador; configurar chamada GET autenticada para `/api/cron/publish` a cada minuto via Supabase Cron/pg_net com segredo no Vault, ou cron equivalente na instalação dedicada. Não ativar até validar a 5.3b.
- [ ] Validar em staging com contas e permissões reais da Meta e Google Business Profile, tipos de mídia, URLs assinadas, fuso, renovação OAuth, falhas e resultados parciais. Testar concorrência real com transações independentes, duração da função, recuperação de posse expirada e ausência de duplicações após timeout. O teste PGlite atual verifica capturas sucessivas e posse, mas não simula transações simultâneas independentes.
- [ ] Medir atraso da fila sob carga: cada execução captura até cinco posts em paralelo e ocorre no máximo uma vez por minuto na configuração prevista; não há garantia de publicação no segundo exato nem de ausência de fila quando o volume ultrapassar a capacidade.
- [ ] Validar a reconciliação por leitura de IDs externos: Google em `PROCESSING` e vídeos/Reels Facebook aceitos são marcados "A conferir" até confirmação, sem novo envio. Concluir fluxo seguro de conferência e repetição de destinos não publicados e verificar limites e cobertura de Stories para Facebook com documentação Meta atual e permissões aprovadas.
- [ ] **Retry e Stories Facebook (Fase 5.3b):** aplicar `20261119032105_social_publish_retry.sql`, verificar backfill conservador e advisors; validar em PostgreSQL real concorrência, bloqueio de edição após tentativa, retry por destino, espera de 1 e 2 minutos, limite de três tentativas e auditoria da confirmação manual. Confirmar que timeouts após envio final jamais são repetidos automaticamente e que destinos já publicados não são reenviados.
- [ ] **Contratos da Meta a validar antes de ativar o Cron:** a documentação oficial acessível para Stories de Páginas não pôde ser confirmada nesta etapa. Validar com conta e permissões reais `/{page_id}/photos` com `published=false`, `/{page_id}/photo_stories` com `photo_id`, `/{page_id}/video_stories` com fases `start`/`finish`, upload hospedado para `rupload.facebook.com`, campos e IDs das respostas, autenticação, disponibilidade, limites de arquivo/duração e consulta do estado assíncrono. Validar também se Stories aceita conteúdo sem legenda/hashtags e se mídias temporárias devem ser removidas após falha.
- [ ] **Hermes e calendário (Fase 5.4):** validar web e Telegram com usuários e organizações distintos, cotas, datas e seleção de posts; a confirmação da proposta semanal entre turnos e sob chamadas paralelas ainda não é garantida pelo servidor. Publicação imediata ainda não foi implementada e deve permanecer indisponível até 5.4b e os testes de go-live.
- [ ] **Ficha do lead (Fase 4.3):** abrir pelo nome do card; atalhos de WhatsApp (abre conversa no número com 55), e-mail, telefone, site e Instagram funcionam no celular e no computador; salvar dados, trocar etapa (histórico "Movido de…"), adicionar anotação; linha do tempo mostra "por você", "por <nome do colega>" e "pelo Hermes" corretamente; excluir (só admin) volta ao quadro; abrir a URL de um lead de outra empresa → página não encontrada.
- [ ] **Aba Funil (Fase 4.3):** números da tabela batem com o quadro; tooltip em português; gráfico só carrega ao abrir a aba; com zero leads aparece o estado vazio; sem etapa "ganho" a conversão mostra "—" com explicação. Conferir o gráfico visualmente (rótulos sem colisão em nomes longos de etapa).
- [ ] Desempenho do quadro com volume real: o `/crm` carrega todos os leads do funil; medir com ~5 mil leads e, se ficar lento, priorizar paginação por coluna.
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

- [ ] **Confirmações e publicação imediata (5.4b):** aplicar `20261119035734_social_confirmation.sql` e rodar advisors; validar web e Telegram entre turnos com usuários, organizações, canais e conversas distintos; testar expiração, replay, mudança de conta/post, limite e concorrência real com conexões PostgreSQL separadas. Validar publicação imediata com contas reais e conciliação antes de ativar o Cron. O item anterior da 5.4 registra o estado histórico anterior a esta implementação.

- [ ] **Dados e assets do Estúdio (6.1):** aplicar `20261119041214_studio_data.sql`, verificar advisors e o bucket privado `studio-assets`; testar com duas empresas uploads e URLs assinadas, RLS, funis, consumo/estorno no mês original e concorrência real de solicitações repetidas e limites. Validar as políticas globais de `storage.objects` para garantir que não concedam acesso amplo ao bucket. Antes da exportação, conferir a cópia autorizada entre buckets e os limites de armazenamento; definir recuperação de gerações interrompidas e limpeza de assets órfãos antes de integrar provedores.

## Concluído

### 6.1 Dados e serviços compartilhados do Estúdio — ✅ (2026-11-19)
- Migration `20261119041214_studio_data.sql`: carrosséis, slides, landing pages e histórico de gerações com RLS, FKs compostas por empresa, slug único por organização e bucket privado de imagens.
- `lib/services/studio.ts`: schemas Zod e operações compartilhadas para painel e Hermes, checagem de associação e caminhos de assets, URLs assinadas, histórico e destino seguro de leads no CRM. A geração registra uma chave idempotente, cobra um crédito do plano atomicamente e estorna uma única vez no período original em caso de falha explícita; não chama provedores.
- **Testes:** `npm test` 328/328; `npm run test:db`, `npm run lint` e `npm run build` verdes; testes reais de Storage e concorrência PostgreSQL permanecem no checklist.

### 5.4b Confirmação persistente e publicação imediata — ✅ (2026-11-19)
- `social_confirmation`: autorização privada, vinculada a empresa, usuário, canal, conversa, operação, conteúdo e contas externas; expira em 15 minutos, exige prova de uso único e bloqueio transacional. Propostas semanais e cota são gravadas integralmente ou revertidas.
- `lib/services/social-confirmations.ts`, `lib/hermes/approval-proof.ts`, `tools.ts` e `turn.ts`: a prova vem exclusivamente da mensagem real do usuário; a proposta é persistida entre turnos web e Telegram. O agendamento de posts novos pelo Hermes passa pela proposta confirmada.
- Calendário manual e `publish_post_now`: exibição do conteúdo salvo e confirmação explícita, reserva atômica com posse, cota e execução do mesmo publicador da fila. Post alterado ou conta trocada invalida a confirmação; destinos inconclusivos não são reenviados automaticamente.
- **Testes:** `npm test` 318/318; `npm run test:db`, `npm run lint` e `npm run build` verdes. Banco em memória cobre isolamento, expiração, replay, falha de cota, alteração de conteúdo e conta, reserva e duplicação de destino; concorrência com conexões PostgreSQL reais e provedores depende do checklist.

### 5.4a Tools de gestão do calendário — parcial (2026-11-19)
- `lib/hermes/tools.ts`: `list_posts`, `list_calendar_accounts`, `create_post`, `update_post`, `reschedule_post` e `cancel_post` usam serviços e schemas compartilhados; `plan_week_with_ai` devolve apenas uma proposta baseada na memória da marca, sem gravar. A seleção de posts é explícita e cancelamento mantém rascunho. O bloqueio local depois da prévia não substitui confirmação persistente nem protege todas as chamadas paralelas ou turnos posteriores.
- `lib/services/social-posts.ts`: `getSocialPost` filtra a empresa mesmo com cliente privilegiado. `system-prompt.ts` e `tool-labels.ts`: orientação e rótulos pt-BR. Sem Tool de exclusão ou publicação imediata.
- **Testes:** `npm test` 311/311; `npm run test:db` OK; `npm run lint` limpo; `npm run build` OK. RED das Tools e da prévia verificado; testes incluem contexto Telegram, limites e isolamento no service com cliente simulado. Sem chamada real ao modelo ou Supabase. A 5.4 permanece aberta até 5.4b.

### 5.3b Retry seguro e Stories Facebook — ✅ (2026-11-19)
- Migration `20261119032105_social_publish_retry.sql`: contagem por destino, backoff de 1 e 2 minutos, no máximo três tentativas, preservação dos resultados publicados, bloqueio de edição após tentativa e backfill conservador. Repetição manual exige confirmação, verifica membro/empresa, registra usuário e horário e só aceita destino sem ID externo e com tentativas disponíveis.
- `lib/services/social-publish-{queue,worker}.ts` e `lib/integrations/social-publish.ts`: só falhas transitórias comprovadamente anteriores ao envio público geram retry automático; falhas no envio final seguem inconclusivas e não são reenviadas. Stories de Página com uma foto ou vídeo usam preparação e envio separados; vídeo aceito fica em conciliação. A implementação de Stories depende da validação real e dos contratos listados no checklist.
- `app/(app)/calendar` e `lib/services/social-posts.ts`: status de nova tentativa, confirmação explícita após verificar o canal e Server Action autenticada com rate limit. Resultados bem-sucedidos não são repetidos; a reexecução não consome nova cota.
- **Testes:** `npm test` 299/299; `npm run test:db` OK; `npm run lint` limpo; `npm run build` OK. RED da migração e da classificação de retry verificado. Sem testes contra Meta real ou PostgreSQL com conexões simultâneas; não ativar o Cron antes do checklist.

### 5.3a Fila e adaptadores de publicação — parcial (2026-11-19)
- `supabase/migrations/20261119025634_social_publish_queue.sql`: captura com `FOR UPDATE SKIP LOCKED`, posse por token e prazo, resultados por canal e recuperação conservadora de tarefas expiradas. Nenhuma tentativa inconclusiva é reenviada automaticamente.
- `app/api/cron/publish/route.ts`, `lib/services/social-publish-{queue,worker}.ts`: endpoint com `CRON_SECRET`, rate limit e worker limitado a cinco posts paralelos por execução; validação e filtro explícito por empresa, segredos só no servidor e mensagens seguras em português.
- `lib/integrations/social-publish.ts` e `google.ts`: publicação Meta e Google com URLs de mídia assinadas, resolução da conta Google, renovação de token Google e validação de formato. Google `PROCESSING` e vídeos/Reels Facebook aceitos são conciliados em consultas posteriores por ID, sem repetir a criação; casos sem confirmação permanecem inconclusivos. Stories Facebook ainda é recusado. Fontes consultadas: documentação [Meta Pages](https://developers.facebook.com/documentation/pages-api/posts), [Meta Instagram](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Meta Reels](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api) e [Google Local Posts](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create).
- `app/(app)/calendar/view.tsx` mostra resultados individuais e "A conferir"; `lib/services/social-posts.ts` impede combinações ainda incompatíveis antes de consumir cota.
- **Testes:** `npm test` 292/292; `npm run test:db` OK; `npm run lint` limpo; `npm run build` OK. RED inicial das funções da fila, adaptadores e rota verificado. Sem chamadas externas reais nem teste de concorrência com conexões independentes; pendências acima. Complementada em 5.3b.

### 5.2 Interface do calendário editorial — ✅ (2026-11-18)
- `/calendar`: visões de mês, semana e lista, rascunhos, edição, escolha de contas e canais, formatos, legenda, hashtags e agendamento em horário de Brasília; cobrança e disponibilidade futura da publicação explicadas na interface. Navegação ativada.
- `app/(app)/calendar/actions.ts`: Server Actions autenticadas, validação e rate limit, usando os serviços compartilhados. `lib/services/social-posts.ts`: paginação das consultas e verificação de que caminhos de mídia pertencem à organização.
- Migration `20261119024027_social_media_bucket.sql`: bucket privado com limites de tamanho e tipos; upload por URL assinada para caminho gerado pelo servidor. Remover arquivo do formulário não exclui o objeto: limpeza de órfãos pendente no checklist.
- **Testes:** `npm test` 275/275; `npm run test:db` OK; `npm run lint` limpo; `npm run build` OK. RED inicial da action verificado. Inspeção visual e testes com credenciais reais não realizados: navegador indisponível e `.env.local` ausente; permanecem no checklist.

### 5.1 Dados e serviços do calendário — ✅ (2026-11-18)
- Migration `supabase/migrations/20261119022436_social_posts.sql`: posts, destinos por canal, integridade composta com integrações da empresa, RLS de leitura, mutação restrita ao servidor e índice de fila. A função transacional valida associação e consome limite junto da gravação.
- `lib/services/social-posts.ts`: schemas Zod, listagem isolada e salvamento compartilhado manual/Hermes; rascunho e agendamento com transições controladas. Um post multicanal consome uma unidade no mês do agendamento; edição de agendamento ativo não cobra, cancelar não estorna e agendar novamente cobra.
- Testes em `lib/services/social-posts.test.ts` e `supabase/tests/rls-check.mjs`: validação, limite, RLS, vínculo por organização/provedor e rollback. `npm test` 268/268; `npm run test:db` OK; `npm run lint` limpo; `npm run build` OK. Testes RED do banco e do serviço verificados antes da implementação. Banco real e concorrência em infraestrutura Supabase permanecem no checklist.

### 4.5 Reunião na Agenda do Google e indicadores — ✅ (2026-11-18) · **Fase 4 concluída**
- `lib/services/meetings.ts`: schema e serviço compartilhado, token renovável, convite ao e-mail do lead, registro de atividade e atualização do lead; mensagens para conexão ausente e resposta ou gravação inconclusiva. O calendário conectado mais antigo é usado quando há mais de um.
- `app/(app)/crm/actions.ts` e ficha do lead: formulário com título, data e hora de Brasília, duração e descrição; validação e limite de requisições existentes. `lib/hermes/tools.ts`, `system-prompt.ts` e `tool-labels.ts`: Tool `schedule_lead_meeting` e orientações em português.
- `app/(app)/dashboard/page.tsx`: conversão e valor do funil por organização, com a mesma definição da visão de funil. Testes em `lib/services/meetings.test.ts`, `lib/hermes/crm-tools.test.ts` e `app/(app)/crm/actions.test.ts`.
- **Testes:** `npm test` 265/265; `npm run lint` limpo; `npm run build` OK. RED inicial do serviço verificado antes da implementação. Google Calendar e interface não foram testados com conta real ou no navegador; validação permanece no checklist.

### 4.4 Tools do Hermes para o CRM — ✅ (2026-11-18)
- Seis Tools para busca, cadastro, alteração, movimentação, anotações e métricas, usando os serviços e schemas do CRM; sem exclusão pelo agente.
- `lib/services/crm.ts`: busca limitada por organização, resolução de etapa por nome ou ID e métricas por etapa; nomes ambíguos são recusados. `lib/hermes/tools.ts`, `system-prompt.ts` e `tool-labels.ts`: registro, desambiguação e textos pt-BR. Testes em `lib/hermes/crm-tools.test.ts`, `lib/hermes/tools.test.ts` e `lib/services/crm.test.ts`.
- **Testes:** `npm test` 255/255; `npm run lint` limpo; `npm run build` OK. RED inicial verificado para registro e serviços das Tools. Sem chamada real ao modelo ou Supabase.

### 4.3 Ficha completa do lead e Visão de Funil — ✅ (2026-11-18)
- **Service:** `getLead` (com etapa; outro tenant → `ServiceError` → 404), `listStages` (sem carregar leads), `memberNames` (confirma membros via contexto, lê `profiles` com admin só desses ids).
- **`lib/crm/lead-view.ts`:** `contactLinks` (WhatsApp `wa.me` com 55 para número BR, `mailto:`, `tel:`, site só `http(s)`, Instagram por @) e `activityAuthor` ("por você" / "por <nome>" / "pelo Hermes" / "por um membro da equipe").
- **`lib/crm/funnel.ts`:** `funnelMetrics` (foto atual: participação, chegaram, taxa de passagem, perdidos à parte, conversão geral; sem divisão por zero).
- **Ficha `app/(app)/crm/leads/[leadId]`:** cabeçalho com etapa/origem/responsável, contato rápido, seletor de etapa (reusa `moveLeadAction`, histórico), edição completa (`updateLeadAction`), linha do tempo com autoria e ícones, nova anotação (`addLeadNoteAction`), exclusão só owner/admin (`deleteLeadAction` com `redirectTo=board`). Nome do card no Kanban virou link.
- **Aba Funil `/crm?view=funil`:** resumo (leads, conversão geral, valor), gráfico Recharts 3.11 (barras horizontais de uma série na cor primária, rótulo direto, tooltip pt-BR, **carregado sob demanda** — o `/crm` voltou de 143 kB para 25 kB) e tabela acessível com os mesmos números; estado vazio didático. Skill `dataviz` aplicada; cor validada com o script da skill (contraste PASS na superfície escura; a faixa de luminosidade é regra só de paletas categóricas).
- Actions revalidam `/crm` com `"layout"` (quadro + fichas).

**Testes:** `npm test` 250/250 (12 novos, RED verificado antes) · `npm run test:db` 96/96 · `tsc --noEmit` OK · lint limpo · build OK. Gráfico e ficha **não** vistos no navegador (passo "renderize e olhe" da skill fica no checklist).

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
