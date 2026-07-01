-- Centroamérica.1A.3 — Generalize source_coverage_summaries for non-SUNAT sources.
--
-- Problem: the table was born with Perú/SUNAT semantics:
--   • audited_total_rows / audited_active_habido_rows: NOT NULL, no default, checked > 0
--   • breakdown_sum: requires active_habido + active_no_habido + inactive_habido +
--     inactive_no_habido = loaded_rows  (only meaningful for SUNAT status breakdown)
--
-- Fix: relax SUNAT-specific constraints, add optional generic columns.
-- Perú row keeps working — its values already satisfy the old checks.
-- RD row can now be inserted with audited_* = 0 and no breakdown.
--
-- Changes:
--   1. DROP breakdown_sum check (SUNAT-only; validated in application layer)
--   2. DROP audited_total_positive and audited_active_habido_positive checks
--   3. SET DEFAULT 0 on audited_total_rows / audited_active_habido_rows
--   4. ADD generic columns: coverage_kind, entity_label, country_code,
--      out_of_scope_entities, coverage_breakdown, coverage_notes
--
-- Non-breaking for Perú: all existing values remain unchanged.
-- Non-breaking for Chile: cl_chilecompra_ocds row (if any) needs no adjustment.

-- 1. Drop SUNAT-specific constraints
alter table public.source_coverage_summaries
  drop constraint if exists breakdown_sum,
  drop constraint if exists audited_total_positive,
  drop constraint if exists audited_active_habido_positive;

-- 2. Give audited_* columns a safe default so non-SUNAT rows don't need them
alter table public.source_coverage_summaries
  alter column audited_total_rows set default 0,
  alter column audited_active_habido_rows set default 0;

-- 3. Generic columns (all optional — null OK for legacy Perú row)
alter table public.source_coverage_summaries
  add column if not exists coverage_kind    text,
  add column if not exists entity_label     text,
  add column if not exists country_code     text,
  add column if not exists out_of_scope_entities integer,
  add column if not exists coverage_breakdown   jsonb,
  add column if not exists coverage_notes       jsonb;
