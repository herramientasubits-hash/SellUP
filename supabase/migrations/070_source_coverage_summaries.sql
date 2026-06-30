-- Perú.9M.1 — Persistent coverage summary table.
-- Eliminates expensive COUNT(*) over multi-million-row tables at Vercel render time.
-- The card reads this first; falls back to dynamic counts; falls back to audited constants.

create table if not exists public.source_coverage_summaries (
  source_key text primary key,
  loaded_rows integer not null default 0,
  next_recommended_offset integer not null default 0,
  audited_total_rows integer not null,
  audited_active_habido_rows integer not null,
  active_habido_rows integer not null default 0,
  active_no_habido_rows integer not null default 0,
  inactive_habido_rows integer not null default 0,
  inactive_no_habido_rows integer not null default 0,
  coverage_status text not null default 'partial_snapshot',
  refresh_source text not null default 'manual',
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loaded_rows_non_negative check (loaded_rows >= 0),
  constraint next_offset_non_negative check (next_recommended_offset >= 0),
  constraint audited_total_positive check (audited_total_rows > 0),
  constraint audited_active_habido_positive check (audited_active_habido_rows > 0),
  constraint active_habido_non_negative check (active_habido_rows >= 0),
  constraint active_no_habido_non_negative check (active_no_habido_rows >= 0),
  constraint inactive_habido_non_negative check (inactive_habido_rows >= 0),
  constraint inactive_no_habido_non_negative check (inactive_no_habido_rows >= 0),
  constraint source_key_not_empty check (source_key != ''),
  constraint breakdown_sum check (
    active_habido_rows + active_no_habido_rows + inactive_habido_rows + inactive_no_habido_rows = loaded_rows
  )
);

alter table public.source_coverage_summaries enable row level security;
-- service role bypasses RLS by default in Supabase; no public read policy.
