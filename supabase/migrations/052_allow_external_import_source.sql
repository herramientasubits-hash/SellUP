-- ============================================================
-- Migration 052: Permitir source = 'external_import' en lotes y candidatos
-- ============================================================
-- Extiende constraints de prospect_batches.source y
-- prospect_candidates.source_primary para incluir 'external_import'.
-- Necesario para el Hito 16IM.0 (Importación de candidatos externos).
-- Cambio 100% aditivo — no modifica datos existentes,
-- no rompe inserts actuales de fuentes anteriores.
-- ============================================================

-- ── 1. prospect_batches.source ────────────────────────────────
-- Valores actuales según migration 051:
--   manual, agent_1, imported, apollo, other, socrata_colombia, denue_mexico, datos_gob_cl

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
        'datos_gob_cl',
        'external_import'
      )
    );

-- ── 2. prospect_candidates.source_primary ─────────────────────
-- Valores actuales según migration 051:
--   manual, hubspot, apollo, lusha, public_source, preloaded,
--   web_ai, socrata_colombia, hubspot_recyclable, imported,
--   other, denue_mexico, datos_gob_cl, NULL

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
      'external_import',
      NULL
    ));
