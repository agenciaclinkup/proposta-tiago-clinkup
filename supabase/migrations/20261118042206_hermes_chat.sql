-- Fase 2.3 — Conversas do chat do Hermes.
-- Conversa é privada do usuário dentro da org. Mensagens só o servidor grava (o histórico enviado ao modelo
-- vem do banco, então o usuário não consegue forjar respostas do assistente ou resultados de Tools).

create table public.hermes_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel public.hermes_channel not null default 'web',
  title text not null default 'Nova conversa' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hermes_conversations_user_idx on public.hermes_conversations (organization_id, user_id, updated_at desc);

create table public.hermes_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.hermes_conversations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id text not null check (char_length(message_id) between 1 and 100),
  role text not null check (role in ('user', 'assistant')),
  parts jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);
create index hermes_messages_conversation_idx on public.hermes_messages (conversation_id, created_at);

create trigger hermes_conversations_updated_at before update on public.hermes_conversations
  for each row execute function private.set_updated_at();

alter table public.hermes_conversations enable row level security;
alter table public.hermes_messages enable row level security;

revoke all on public.hermes_conversations, public.hermes_messages from anon, authenticated;
-- user_id fica fora do grant de INSERT: sempre auth.uid() pelo default.
grant select, delete on public.hermes_conversations to authenticated;
grant insert (id, organization_id, title) on public.hermes_conversations to authenticated;
grant update (title) on public.hermes_conversations to authenticated;
grant select on public.hermes_messages to authenticated;

create policy "users read own conversations" on public.hermes_conversations
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));

create policy "users create own conversations" on public.hermes_conversations
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));

create policy "users rename own conversations" on public.hermes_conversations
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)))
  with check (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));

create policy "users delete own conversations" on public.hermes_conversations
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));

create policy "users read messages of own conversations" on public.hermes_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.hermes_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );
