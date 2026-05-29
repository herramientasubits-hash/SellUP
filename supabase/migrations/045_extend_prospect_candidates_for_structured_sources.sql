-- ============================================================
-- Migration 045: Extensión de prospect_candidates para fuentes
-- masivas estructuradas (Hito 16AB.4)
-- ============================================================
-- Agrega columnas, extiende constraint source_primary, crea
-- índices. 100% aditiva — no modifica datos existentes,
-- no rompe inserts actuales de web_ai.
-- ============================================================

-- ── 1. Columnas nuevas ────────────────────────────────────────

ALTER TABLE prospect_candidates
  -- Identificación estructurada
  ADD COLUMN IF NOT EXISTS tax_id                     TEXT            NULL,
  -- city ya existe; IF NOT EXISTS es no-op seguro
  ADD COLUMN IF NOT EXISTS department                 TEXT            NULL,
  ADD COLUMN IF NOT EXISTS sector_code                TEXT            NULL,
  ADD COLUMN IF NOT EXISTS sector_description         TEXT            NULL,
  ADD COLUMN IF NOT EXISTS legal_status               TEXT            NULL,

  -- Tamaño de empresa (fuentes estructuradas no siempre tienen empleados)
  ADD COLUMN IF NOT EXISTS employee_count             INTEGER         NULL
    CONSTRAINT prospect_candidates_employee_count_nonneg
      CHECK (employee_count IS NULL OR employee_count >= 0),
  ADD COLUMN IF NOT EXISTS employee_count_status      TEXT            NULL,
  ADD COLUMN IF NOT EXISTS employee_count_source      TEXT            NULL,
  ADD COLUMN IF NOT EXISTS employee_count_confidence  INTEGER         NULL
    CONSTRAINT prospect_candidates_employee_count_confidence_range
      CHECK (employee_count_confidence IS NULL OR (employee_count_confidence BETWEEN 0 AND 100)),

  -- Clasificación comercial
  ADD COLUMN IF NOT EXISTS commercial_fit_status      TEXT            NULL,

  -- Estado HubSpot
  ADD COLUMN IF NOT EXISTS hubspot_match_status       TEXT            NULL,
  ADD COLUMN IF NOT EXISTS hubspot_lifecycle_status   TEXT            NULL,
  ADD COLUMN IF NOT EXISTS hubspot_owner_id           TEXT            NULL,
  ADD COLUMN IF NOT EXISTS recyclable_status          TEXT            NULL,

  -- Revisión estructurada
  ADD COLUMN IF NOT EXISTS review_status              TEXT            NULL,
  ADD COLUMN IF NOT EXISTS review_flags               TEXT[]          NOT NULL DEFAULT '{}',

  -- Trazabilidad tipada por capa (default vacío para no romper registros existentes)
  ADD COLUMN IF NOT EXISTS source_trace               JSONB           NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT prospect_candidates_source_trace_is_object
      CHECK (jsonb_typeof(source_trace) = 'object'),
  ADD COLUMN IF NOT EXISTS hubspot_trace              JSONB           NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT prospect_candidates_hubspot_trace_is_object
      CHECK (jsonb_typeof(hubspot_trace) = 'object'),
  ADD COLUMN IF NOT EXISTS commercial_trace           JSONB           NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT prospect_candidates_commercial_trace_is_object
      CHECK (jsonb_typeof(commercial_trace) = 'object');

-- ── 2. Checks de valores permitidos ──────────────────────────
-- Aditivos, no aplicados retroactivamente a datos existentes
-- (IS NULL OR IN (...) permite NULLs y valores existentes vacíos)

ALTER TABLE prospect_candidates
  ADD CONSTRAINT prospect_candidates_employee_count_status_check
    CHECK (employee_count_status IS NULL OR employee_count_status IN (
      'confirmed_100_plus',
      'confirmed_under_100',
      'unknown_requires_manual_validation',
      'estimated_100_plus',
      'estimated_under_100',
      'not_applicable'
    ));

ALTER TABLE prospect_candidates
  ADD CONSTRAINT prospect_candidates_commercial_fit_status_check
    CHECK (commercial_fit_status IS NULL OR commercial_fit_status IN (
      'likely_fit',
      'needs_manual_review',
      'likely_not_fit',
      'risky_fit',
      'blocked',
      'duplicate',
      'customer_blocked',
      'recyclable_prospect'
    ));

ALTER TABLE prospect_candidates
  ADD CONSTRAINT prospect_candidates_hubspot_match_status_check
    CHECK (hubspot_match_status IS NULL OR hubspot_match_status IN (
      'no_match',
      'exact_match_customer',
      'exact_match_prospect_active',
      'exact_match_prospect_recyclable',
      'exact_match_ex_customer',
      'possible_match_requires_review',
      'hubspot_lookup_failed',
      'not_attempted'
    ));

ALTER TABLE prospect_candidates
  ADD CONSTRAINT prospect_candidates_recyclable_status_check
    CHECK (recyclable_status IS NULL OR recyclable_status IN (
      'not_recyclable',
      'recyclable',
      'pending_review'
    ));

ALTER TABLE prospect_candidates
  ADD CONSTRAINT prospect_candidates_review_status_check
    CHECK (review_status IS NULL OR review_status IN (
      'generated',
      'normalized',
      'needs_enrichment',
      'enrichment_in_progress',
      'enriched',
      'needs_manual_review',
      'ready_for_approval',
      'approved',
      'rejected',
      'blocked_customer',
      'blocked_duplicate',
      'synced_to_hubspot',
      'sync_failed'
    ));

-- ── 3. Extender source_primary ────────────────────────────────
-- Primero eliminar el constraint existente (generado inline),
-- luego recrear con los valores ampliados.
-- Nombre auto-generado por PostgreSQL para CHECK inline.

ALTER TABLE prospect_candidates
  DROP CONSTRAINT IF EXISTS prospect_candidates_source_primary_check;

ALTER TABLE prospect_candidates
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
      NULL
    ));

-- ── 4. Índices nuevos ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS prospect_candidates_tax_id_idx
  ON prospect_candidates (tax_id)
  WHERE tax_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prospect_candidates_review_status_idx
  ON prospect_candidates (review_status)
  WHERE review_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS prospect_candidates_hubspot_match_status_idx
  ON prospect_candidates (hubspot_match_status)
  WHERE hubspot_match_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS prospect_candidates_commercial_fit_status_idx
  ON prospect_candidates (commercial_fit_status)
  WHERE commercial_fit_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS prospect_candidates_country_code_review_status_idx
  ON prospect_candidates (country_code, review_status)
  WHERE country_code IS NOT NULL AND review_status IS NOT NULL;

-- Índice en source_primary ya existe en 040; este es no-op seguro si se renombró
CREATE INDEX IF NOT EXISTS prospect_candidates_source_primary_idx
  ON prospect_candidates (source_primary)
  WHERE source_primary IS NOT NULL;

-- ── 5. Comentarios ────────────────────────────────────────────

COMMENT ON COLUMN prospect_candidates.tax_id IS
  'NIT/RUT/RUC normalizado de fuente estructurada. Paralelo a tax_identifier (web_ai). Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.department IS
  'Departamento/estado geográfico. Fuentes estructuradas Colombia. Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.sector_code IS
  'Código CIIU u otro código sectorial de la fuente. Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.employee_count_status IS
  'Clasificación de tamaño: confirmed_100_plus / unknown_requires_manual_validation / etc. Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.commercial_fit_status IS
  'Evaluación comercial: likely_fit / needs_manual_review / likely_not_fit / etc. Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.hubspot_match_status IS
  'Estado de búsqueda en HubSpot: no_match / exact_match_customer / not_attempted / etc. Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.review_status IS
  'Estado del ciclo de revisión estructurada. Paralelo a status (web_ai). Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.review_flags IS
  'Flags de revisión: size_unknown, missing_website, pii_email_risk, etc. Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.source_trace IS
  'Trazabilidad de la fuente estructurada (Socrata dataset, query params, etc.). Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.hubspot_trace IS
  'Resultado y trazabilidad de búsqueda/sync con HubSpot. Hito 16AB.4.';

COMMENT ON COLUMN prospect_candidates.commercial_trace IS
  'Clasificación comercial, flags de revisión, aprobación. Hito 16AB.4.';
