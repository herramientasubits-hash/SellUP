-- Hito L2.1 — Observabilidad segura para sync de cuotas Tavily/Lusha
-- Agrega columnas de diagnóstico a tool_quota_sync_logs.
-- Sin backfill. Sin modificar filas anteriores.

alter table tool_quota_sync_logs
  add column if not exists sync_status text null
    check (sync_status in ('success', 'error', 'skipped')),
  add column if not exists http_status integer null,
  add column if not exists endpoint text null,
  add column if not exists response_shape jsonb null,
  add column if not exists raw_response_sanitized jsonb null;
