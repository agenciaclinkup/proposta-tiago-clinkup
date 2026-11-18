@AGENTS.md

## Notas para o Claude Code

- Especificação completa e convenções: `AGENTS.md` (importado acima — fonte única, edite lá).
- Plano de fases, schema e Tools do Hermes: `ARCHITECTURE.md`.
- Skills do projeto em `.claude/skills` (links para `.agents/skills`), registradas em `skills-lock.json`.
- Comandos: `npm run dev`, `npm run build`, `npm run lint`, `npm test`.

## Regras de governança (obrigatórias — detalhes em `AGENTS.md` §6)

1. **Revezamento Claude ↔ Codex:** comece lendo `PROGRESS.md`; ao fim de cada tarefa/módulo, atualize-o (feito, arquivos, testes, próxima microtarefa).
2. **Git:** commit semântico a cada etapa validada (testes + lint + build verdes), com `PROGRESS.md` no mesmo commit. Nunca versionar `.env*`, chaves ou builds.
3. **Segurança:** RLS por `organization_id` em toda tabela; tokens OAuth/Telegram cifrados com AES-256-GCM (`lib/vault.ts`), nunca no cliente; toda Server Action/API/Webhook valida com Zod, verifica auth/assinatura e aplica rate limiting (`lib/rate-limit.ts`).
