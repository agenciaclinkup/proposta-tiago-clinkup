# Instalacao dedicada (rascunho)

Use um projeto Supabase exclusivo ou uma instalacao Supabase completa propria, com Auth, Storage e PostgREST; PostgreSQL isolado nao substitui esses servicos. Aplique as migrations do repositorio e configure Auth, Storage, URLs e backups conforme o checklist de go-live.

Copie `.env.example` para `.env` na VPS, preencha as chaves, URLs e segredos e mantenha o arquivo privado. As variaveis `NEXT_PUBLIC_*` sao incorporadas ao build: execute `docker compose build --no-cache` novamente apos altera-las. Nao forneca segredos como argumentos de build. A publicacao de porta escuta somente em localhost; configure proxy reverso HTTPS e dominio proprio.

Execute `docker compose up -d --build` para iniciar a aplicacao. O endpoint `/api/health` verifica apenas a disponibilidade do processo, nao a conectividade com o banco. O agendador esta desativado por padrao; apos concluir o checklist de publicacao e validar credenciais reais, execute `docker compose --profile scheduler up -d`. Use um CRON_SECRET aleatorio com pelo menos 32 caracteres. O scheduler e o cron externo nao devem operar simultaneamente sem antes validar o comportamento operacional.

Esta versao ainda nao oferece configuracao de identidade por organizacao nem a opcao de ocultar toda a marca Clinkup; nao considere o empacotamento concluido.
