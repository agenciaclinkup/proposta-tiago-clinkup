-- Fase 9.3 — Billing Asaas (Pix/Boleto): faturas recorrentes e idempotência estrita de webhooks por event_id.
-- Escrita exclusiva pelo servidor (service_role); membros leem apenas as faturas da própria organização via RLS.

create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('asaas', 'stripe')),
  external_payment_id text not null check (char_length(external_payment_id) between 1 and 200),
  external_subscription_id text check (external_subscription_id is null or char_length(external_subscription_id) <= 200),
  plan_id text not null check (plan_id in ('starter', 'growth', 'scale')),
  billing_type text not null check (billing_type in ('PIX', 'BOLETO', 'CREDIT_CARD')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'overdue', 'canceled', 'refunded')),
  amount_cents integer not null check (amount_cents >= 0),
  due_date date,
  invoice_url text check (invoice_url is null or invoice_url ~ '^https://'),
  bank_slip_url text check (bank_slip_url is null or bank_slip_url ~ '^https://'),
  pix_qr_code text,
  pix_copy_paste text,
  boleto_identification_field text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_payment_id)
);
create index billing_invoices_org_created_idx on public.billing_invoices (organization_id, created_at desc);
create trigger billing_invoices_updated_at before update on public.billing_invoices
  for each row execute function private.set_updated_at();

alter table public.billing_invoices enable row level security;
revoke all on public.billing_invoices from public, anon, authenticated;
grant select on public.billing_invoices to authenticated;
create policy "members read billing invoices" on public.billing_invoices
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- Tabela privada de deduplicação de eventos de webhook (evita processamento duplicado de reenvios).
create table public.billing_webhook_events (
  provider text not null check (provider in ('asaas', 'stripe')),
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 100),
  organization_id uuid references public.organizations(id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from public, anon, authenticated;
