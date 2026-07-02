-- Migration 077 — Agrega status 'superseded' a contact_enrichment_runs
-- Hito 17A.9E — Normalizar ciclo de vida de runs ready_to_enrich
-- Cuando se crea un nuevo ready_to_enrich para la misma cuenta, los anteriores
-- pasan a superseded (trazabilidad sin borrar).

ALTER TABLE public.contact_enrichment_runs
  DROP CONSTRAINT contact_enrichment_runs_status_check;

ALTER TABLE public.contact_enrichment_runs
  ADD CONSTRAINT contact_enrichment_runs_status_check
  CHECK (status IN (
    'pending',
    'resolving',
    'ready_to_enrich',
    'enriching',
    'ready_for_review',
    'completed',
    'failed',
    'superseded'
  ));
