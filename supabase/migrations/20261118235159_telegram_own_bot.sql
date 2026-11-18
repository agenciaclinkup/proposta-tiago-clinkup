-- Fase 3.3c — Bot próprio do Telegram (White-Label/Scale).
-- `telegram_bot`: configuração do bot da org (token cifrado em integration_secrets).
-- Vínculos de chats pelo bot próprio continuam como provider `telegram`, com external_account_id "<botId>:<chatId>".

alter type public.integration_provider add value if not exists 'telegram_bot';

-- Código de vínculo restrito à org do bot: um código da org B não é consumido (nem invalidado) pelo bot da org A.
drop function public.consume_telegram_link_code(text);

create function public.consume_telegram_link_code(p_code text, p_organization_id uuid default null)
returns table (organization_id uuid, user_id uuid)
language sql
security definer
set search_path = ''
as $$
  update public.telegram_link_codes c
  set used_at = now()
  where c.code = upper(p_code)
    and c.used_at is null
    and c.expires_at > now()
    and (p_organization_id is null or c.organization_id = p_organization_id)
  returning c.organization_id, c.user_id;
$$;

revoke all on function public.consume_telegram_link_code(text, uuid) from public, anon, authenticated;
grant execute on function public.consume_telegram_link_code(text, uuid) to service_role;
