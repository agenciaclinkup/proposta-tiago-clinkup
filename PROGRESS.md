# PROGRESS — CLINKUP HERMES PLATFORM

> Protocolo de revezamento Claude ↔ Codex. **Leia antes de começar; atualize ao fim de cada tarefa/módulo** (feito, arquivos, testes, próxima microtarefa). Regras: `AGENTS.md` §6. Plano: `ARCHITECTURE.md` §4.

## Estado atual

- **Fase:** 1 — Fundação (Multi-Tenant, Banco, Auth, Planos, Onboarding)
- **Etapa em andamento:** 1.3 — Validação em ambiente real (bloqueada: aguarda credenciais do usuário)
- **Última atualização:** 2026-11-18 — Claude

## Próxima microtarefa (exata)

**1.3 Validação real** (precisa de credenciais Supabase + Stripe modo teste em `.env.local`):
1. `npx supabase link --project-ref <ref>` e `npx supabase db push` (2 migrations).
2. Rodar advisors (`npx supabase db advisors` ou MCP `get_advisors`) e corrigir alertas.
3. Fluxo manual: cadastro → confirmação de e-mail → onboarding → dashboard; segundo usuário não enxerga a org do primeiro.
4. Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, checkout de teste, conferir `subscriptions`/`organizations.plan_id`.
5. Registrar resultado aqui e commitar `test(e2e): ...` / `fix(...)` conforme achados.

**Se as credenciais não estiverem disponíveis:** iniciar **Fase 2.1** — migration `hermes_logs` + `usage_counters` (RLS por `organization_id`, teste em `supabase/tests/rls-check.mjs`), depois `lib/services/` com `ServiceContext`.

## Concluído

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
