-- ============================================================
-- Migration 046: Permitir source = 'socrata_colombia' en lotes
-- ============================================================
-- Extiende el constraint de prospect_batches.source para incluir
-- 'socrata_colombia'. Cambio aditivo — no modifica datos existentes,
-- no rompe inserts actuales.
-- Hito 16AB.8.
-- ============================================================

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
        'socrata_colombia'
      )
    );
