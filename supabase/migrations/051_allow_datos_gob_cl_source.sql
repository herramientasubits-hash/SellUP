-- ============================================================
-- Migration 051: Permitir source = 'datos_gob_cl' en lotes y candidatos
-- ============================================================
-- Extiende constraints de prospect_batches.source y
-- prospect_candidates.source_primary para incluir 'datos_gob_cl'.
-- Necesario para el Hito 16CL.1A (Chile preview via RES).
-- Cambio 100% aditivo — no modifica datos existentes,
-- no rompe inserts actuales de fuentes anteriores.
-- ============================================================

-- ── 1. prospect_batches.source ────────────────────────────────
-- Valores actuales según migration 048:
--   manual, agent_1, imported, apollo, other, socrata_colombia, denue_mexico

ALTER TABLE public.prospect_batches
  DROP CONSTRAINT IF EXISTS prospect_batches_source_check;

ALTER TABLE public.prospect_batches
  ADD CONSTRAINT prospect_batches_source_check
    CHECK (
      source IN (
        'manual',
        'agent_1',
        'imported',
        'apollo',
        'other',
        'socrata_colombia',
        'denue_mexico',
        'datos_gob_cl'
      )
    );

-- ── 2. prospect_candidates.source_primary ─────────────────────
-- Valores actuales según migration 048:
--   manual, hubspot, apollo, lusha, public_source, preloaded,
--   web_ai, socrata_colombia, hubspot_recyclable, imported,
--   other, denue_mexico, NULL

ALTER TABLE public.prospect_candidates
  DROP CONSTRAINT IF EXISTS prospect_candidates_source_primary_check;

ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT prospect_candidates_source_primary_check
    CHECK (source_primary IN (
      'manual',
      'hubspot',
      'apollo',
      'lusha',
      'public_source',
      'preloaded',
      'web_ai',
      'socrata_colombia',
      'hubspot_recyclable',
      'imported',
      'other',
      'denue_mexico',
      'datos_gob_cl',
      NULL
    ));
