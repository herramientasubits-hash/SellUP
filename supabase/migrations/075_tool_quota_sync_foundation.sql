-- Hito L1: Schema base para sincronización de cuotas externas
-- No conecta APIs. No llama proveedores. Solo estructura de datos.
--
-- quota_source valores:
--   'manual'     — configurado por admin, nunca sobreescribir por API
--   'api_synced' — obtenido de la API del proveedor
--   'sync_error' — último intento falló; ver quota_sync_error
--   null         — no configurado todavía
--
-- quota_override_manual=true bloquea que cualquier futuro sync sobrescriba el valor.

alter table tool_catalog
  add column if not exists quota_source                text          null
    constraint tool_catalog_quota_source_valid
      check (quota_source in ('manual', 'api_synced', 'sync_error')),
  add column if not exists quota_synced_at             timestamptz   null,
  add column if not exists quota_sync_error            text          null,
  add column if not exists credits_remaining_external  numeric       null,
  add column if not exists usd_cost_mtd                numeric       null,
  add column if not exists billing_period_start        date          null,
  add column if not exists billing_period_end          date          null,
  add column if not exists credits_per_usd_rate        numeric       null,
  add column if not exists quota_override_manual       boolean       not null default false;

-- Tabla de auditoría de sincronizaciones (preparación futura, no se backfill)
create table if not exists public.tool_quota_sync_logs (
  id              uuid          primary key default gen_random_uuid(),
  provider_key    text          not null
    references public.tool_catalog(provider_key)
    on delete cascade,
  synced_at       timestamptz   not null default now(),
  source          text          not null
    constraint tool_quota_sync_logs_source_valid
      check (source in ('api_synced', 'manual', 'sync_error')),
  credits_remaining_external  numeric   null,
  usd_cost_mtd                numeric   null,
  billing_period_start        date      null,
  billing_period_end          date      null,
  credits_per_usd_rate        numeric   null,
  error_message   text          null,
  triggered_by    text          null  -- 'cron', 'manual', 'admin', etc.
);

create index if not exists idx_tool_quota_sync_logs_provider_key
  on public.tool_quota_sync_logs (provider_key);

create index if not exists idx_tool_quota_sync_logs_synced_at
  on public.tool_quota_sync_logs (synced_at desc);

-- RLS: mismo patrón que tool_catalog y budget_rules
alter table public.tool_quota_sync_logs enable row level security;

drop policy if exists "service_role full access" on public.tool_quota_sync_logs;
create policy "service_role full access"
  on public.tool_quota_sync_logs
  for all
  to service_role
  using (true)
  with check (true);
