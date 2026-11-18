# CLINKUP HERMES PLATFORM — Especificação para Agentes

Você é o **Arquiteto de Software Principal, Engenheiro Full-Stack Sênior e Product Designer** responsável por construir a **CLINKUP HERMES PLATFORM** — uma plataforma SaaS e White-Label de Marketing, Vendas e Automação Empresarial orquestrada por Inteligência Artificial.

Plano de arquitetura, schema do banco, Tools do Hermes e fases: ver [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Visão do produto & modelo de negócio

- **Referência de experiência & posicionamento:** espelhar a fluidez visual, clareza de fluxos e proposta de valor de plataformas modernas de automação e conversação como `automateflow.chat/pt`, elevando o nível para um **Sistema Operacional de Crescimento com IA**.
- **Estética & identidade padrão (Clinkup):** Dark Mode executivo sofisticado (`#050811` / `#0B1120`), acentos em Azul Neon / Ciano (`#00D4FF` / `#2563EB`), efeitos sutis de *Glassmorphism*, tipografia limpa (Inter / Plus Jakarta Sans) e UX extremamente intuitiva.
- **Arquitetura híbrida vendável (Multi-Tenant + Single-Tenant):**
  1. **SaaS Multi-Tenant (assinaturas):** planos *Starter, Growth, Scale* (Scale = Enterprise/Agency) com billing recorrente (Stripe/Asaas), limites de uso por plano (leads extraídos, posts agendados, créditos de IA, conexões) e isolamento estrito de dados via `organization_id` + Row Level Security (RLS).
  2. **Modo White-Label / instalação dedicada:** configurável via `config/tenant-brand.ts` + `docker-compose.yml` para vender e implantar instâncias exclusivas (domínio próprio, logo, cores e banco dedicado) para empresas que contratarem a estrutura própria fora da assinatura Clinkup.

## 2. Stack tecnológica obrigatória

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Shadcn/UI, Framer Motion, Lucide Icons, `@dnd-kit` (Kanban) e Recharts (Dashboards).
- **Backend & banco:** Next.js Server Actions / Route Handlers + Supabase (PostgreSQL, Auth, Storage, Realtime e RLS).
- **Agendamento & filas:** BullMQ / Redis ou Supabase Edge Functions + Cron Jobs para disparo exato de postagens agendadas e rotinas autônomas.
- **Orquestração de IA (Agente Hermes):** Vercel AI SDK + OpenAI/Anthropic Function Calling (Tools) + Webhook do **Telegram Bot** + Webhooks externos (n8n / BootConversa).

## 3. Módulos obrigatórios (DUAL-CONTROL: manual + Agente Hermes)

**Regra de Ouro:** toda funcionalidade deve poder ser executada **tanto manualmente pelo usuário na interface** quanto **por comandos em linguagem natural enviados ao Agente Hermes** (chat interno da plataforma ou mensagem de texto/áudio no **Telegram** vinculado à conta).

1. **Onboarding inteligente & Memória da Marca (`/onboarding`):** wizard obrigatório no primeiro login (Nome da Empresa, Nicho, Produtos/Serviços, Ticket Médio, Público-Alvo, Diferenciais, Tom de Voz, Identidade Visual). Salva um "Contexto Mestre" que alimenta todos os agentes (carrosséis, legendas, prospecção, anúncios).
2. **Central de Integrações & guia passo a passo (`/integrations`):** tutoriais interativos para iniciantes (onde clicar em cada plataforma antes de autenticar) para: Instagram Business & Facebook Pages (Meta Graph API); Meta Business Manager & Conta de Anúncios (criação/vinculação de BM, Pixel e pagamento); Google Meu Negócio; Google Calendar; Telegram Bot (vínculo via `/vincular CODIGO`).
3. **Dashboard executivo (`/dashboard`):** KPIs em tempo real — leads extraídos, oportunidades no funil, taxa de conversão, posts agendados/publicados, investimento & ROAS em Meta Ads, atividades recentes do Hermes.
4. **CRM — Kanban & Funil (`/crm`):** Kanban com colunas personalizáveis (*Novo Lead, Qualificado por IA, Reunião Agendada, Proposta Enviada, Fechado*); visão de funil com taxas de passagem, ficha completa do lead, histórico de interações e agendamento na Agenda do Google.
5. **Calendário editorial & publicação omnichannel (`/calendar`):** visão Mês / Semana / Lista + **Postagem Instantânea**. Campos obrigatórios: **Canais** (Instagram, Facebook, Google Meu Negócio — múltipla escolha), **Formato** (Feed, Reels, Stories, Carrossel, Atualização GMB), **data e horário exatos**, mídia, copy/hashtags e **Agendamento Automatizado por IA** (Hermes preenche a semana com base no onboarding).
6. **Estúdio de criação (`/studio`):** criador de carrosséis multi-slides (Hook, Conteúdo, CTA, paleta da marca, exportação para o calendário) e gerador de landing pages conectadas ao CRM.
7. **Extrator de leads & Gestor Meta Ads (`/leads-ads`):** busca por nicho + localização (Google Places API / conectores), higienização (telefone/WhatsApp, e-mail, site, Instagram), envio com 1 clique para o CRM ou para Público Personalizado no Meta Ads; gestor de campanhas assistido pelo Hermes que valida BM/Conta de Anúncios, guia permissões faltantes e cria campanhas (objetivo, público, orçamento diário, criativo do Estúdio) por conversa ou formulário.
8. **Planos, assinaturas & Super-Admin (`/billing`, `/admin`):** página de preços pública/interna com comparação de planos e checkout; painel admin para gerenciar tenants, liberar licenças White-Label e monitorar consumo de API.

## 4. Protocolo de execução

- **Superpowers:** use os fluxos de planejamento, quebra de tarefas e verificação antes de código complexo. Cada módulo (Auth, Multi-Tenant, Hermes Tools, CRM, Calendário, Ads) é testado e validado antes da próxima fase.
- **Caveman (escopo restrito):** só na comunicação técnica com o desenvolvedor e em logs de execução. **Nunca** em textos da interface, tutoriais de onboarding/integrações ou respostas do Hermes ao usuário final — essa copy é completa, clara, instrutiva e profissional, em português do Brasil.

## 5. Convenções de engenharia

- **Dual-control na prática:** a lógica de negócio vive em `lib/services/<domínio>.ts`, recebendo um `ServiceContext` (`supabase`, `organizationId`, `userId`, `via: "manual" | "hermes"`). Server Actions e Tools do Hermes chamam a mesma função com o mesmo schema Zod. Nada de lógica duplicada entre UI e agente.
- **Multi-tenant:** toda tabela de domínio tem `organization_id` + RLS via `private.is_org_member()`. Tabelas novas exigem `GRANT` explícito para `authenticated` (o Supabase não expõe mais tabelas automaticamente) e RLS habilitado.
- **Segredos:** `SUPABASE_SECRET_KEY`, chaves Stripe e tokens de integração só no servidor (`import "server-only"`). Nunca em variável `NEXT_PUBLIC_`. Tokens OAuth ficam em `integration_secrets`, sem grant para `authenticated`.
- **Writes privilegiados** (assinaturas, uso, secrets) só via cliente admin em Route Handlers/webhooks verificados.
- **Migrations:** `npx supabase migration new <nome>`; nunca inventar o nome do arquivo.
- **Next.js 15:** sessão Supabase renovada em `middleware.ts` (não `proxy.ts`). Autorização com `getClaims()`/`getUser()`, nunca `getSession()`.
- **Testes:** `npm test` (Vitest) para lógica pura; `npm run build` e `npm run lint` antes de fechar uma fase.
- **Copy do produto:** pt-BR, completa e profissional.

## 6. Governança, continuidade e segurança (regras permanentes e obrigatórias)

### 6.1 Protocolo de revezamento contínuo (Claude ↔ Codex via `PROGRESS.md`)
- **Antes de começar:** leia `PROGRESS.md` e retome exatamente da "Próxima microtarefa". Não refaça o que está marcado como concluído.
- **Ao final de cada tarefa ou módulo concluído:** atualize `PROGRESS.md` com o que foi feito, arquivos criados/alterados, status dos testes (`npm test`, `npm run lint`, `npm run build`) e a próxima microtarefa exata.
- `PROGRESS.md` é a fonte de verdade do estado do projeto entre agentes; `ARCHITECTURE.md` é a fonte de verdade do plano.

### 6.2 Versionamento Git & backup contínuo
- `.gitignore` rigoroso: nunca versionar `.env*` (exceto `.env.example` sem valores), chaves privadas/certificados, `node_modules`, builds (`.next`, `out`, `build`) e arquivos temporários do Supabase.
- **Commit semântico (Conventional Commits) a cada etapa validada** — testes, lint e build verdes antes do commit. Ex.: `feat(auth): multi-tenant rls and onboarding wizard`, `fix(billing): ...`, `docs(progress): ...`.
- `PROGRESS.md` atualizado entra no mesmo commit da etapa.
- Nunca commitar segredos; se um segredo vazar no histórico, rotacione a credencial imediatamente.

### 6.3 Blindagem de segurança multi-tenant & integrações (produção)
- **Isolamento estrito:** toda tabela no Supabase tem RLS ativo vinculado a `organization_id` (via `private.is_org_member()` / `private.is_org_admin()`). Tabelas sem acesso de usuário (secrets, rate limit) ficam sem grants para `anon`/`authenticated`.
- **Cofre de credenciais:** tokens OAuth (Instagram, Facebook, Meta BM, Google Meu Negócio, Google Calendar) e tokens do Telegram são cifrados no servidor com AES-256-GCM (`lib/vault.ts`) antes de gravar e nunca são enviados ao cliente.
- **Validação & proteção:** toda Server Action, API e Webhook (incluindo Telegram, scraping e IA) deve: (1) validar o payload com Zod; (2) verificar autenticação ou assinatura (sessão Supabase, assinatura Stripe, secret token do Telegram, HMAC de webhooks externos); (3) aplicar rate limiting (`lib/rate-limit.ts`).
