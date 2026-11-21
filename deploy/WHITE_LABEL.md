# Instalação dedicada (White-Label)

Use um projeto Supabase exclusivo ou uma instalação Supabase completa própria, com Auth, Storage e PostgREST; PostgreSQL isolado não substitui esses serviços. Aplique as migrations do repositório e configure Auth, Storage, URLs e backups conforme o [Runbook de Go-Live](./GO_LIVE_RUNBOOK.md) e o checklist em `PROGRESS.md`.

Copie `.env.example` para `.env` na VPS, preencha as chaves, URLs e segredos e mantenha o arquivo privado (`chmod 600 .env`). As variáveis `NEXT_PUBLIC_*` são incorporadas ao build: execute `docker compose build --no-cache` novamente após alterá-las. Não forneça segredos como argumentos de build. A publicação de porta escuta somente em `127.0.0.1:3000`; configure proxy reverso HTTPS e domínio próprio.

Execute `docker compose up -d --build` para iniciar a aplicação. O endpoint `/api/health` verifica apenas a disponibilidade do processo, não a conectividade com o banco. O agendador está desativado por padrão; após concluir o checklist de publicação e validar credenciais reais, execute `docker compose --profile scheduler up -d`. Use um `CRON_SECRET` aleatório com pelo menos 32 caracteres. O scheduler e o cron externo não devem operar simultaneamente sem antes validar o comportamento operacional.

A identidade White-Label por organização (nome, logo, favicon, cores primária/secundária, e-mail e WhatsApp de suporte e ocultação da marca Clinkup) é configurável em `/settings` por `owner`/`admin` em plano Scale ou com licença White-Label ativa (ou via Super-Admin em `/admin`). Antes do go-live, valide a imagem Docker e o Compose em um ambiente com Docker ativo conforme o checklist de `PROGRESS.md`.
