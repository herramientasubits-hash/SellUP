-- Migration 089: provider_industry_raw_label_observations schema (Q3F-5AU.3)
-- Installs the durable capture substrate for provider industry raw label
-- observations, in inert/read-only posture, following the same schema-first
-- pattern as 082 -> 083 (schema first, activation later).
--
-- Model: M3 (hybrid) — this is the aggregate/upsert observation table.
-- A separate append-only event table may be introduced in a future
-- migration; it is not created here.
--
-- Scope of this migration: table + constraints + indexes + RLS +
-- SELECT-only grants. This migration does NOT:
--   - create any RPC or SECURITY DEFINER function;
--   - grant INSERT/UPDATE/DELETE to any role, including service_role;
--   - seed any row;
--   - wire any provider (Apollo/Lusha/Tavily) to write into this table;
--   - create captureProviderIndustryRawLabelObservations or any capture
--     function;
--   - touch provider_industry_mapping_snapshots, provider_industry_concept_entries,
--     provider_industry_mapping_associations, or the mapping draft/publish/
--     delete-draft lifecycle in any way.
--
-- Table semantics:
--   - This table stores RUNTIME OBSERVATIONS of raw industry labels as
--     returned by a provider for a given operation — it is telemetry about
--     what labels providers actually send, not a mapping. It does not
--     represent, imply, or create any canonical/concept mapping entry, and
--     it is not part of the provider_industry_mapping_snapshots lifecycle
--     (draft/published/archived) governed elsewhere.
--   - provider_key and source_vocabulary_key are DISTINCT identities:
--     source_vocabulary_key identifies the vocabulary namespace governed by
--     provider_industry_source_vocabularies (e.g. "apollo_organization_industry"),
--     while provider_key identifies the underlying data provider/integration
--     (e.g. "apollo"). A single provider can have more than one vocabulary,
--     and this table intentionally keeps the two columns separate rather
--     than collapsing them into one identity.
--   - source_context is a small, non-PII context payload (e.g. which
--     operation/query shape produced this observation). It MUST NOT contain
--     personal data or the full raw provider response payload — it exists
--     to aid triage, not to be a payload archive.
--   - Write activation (INSERT/UPDATE from service_role, and any capture
--     function that populates this table) is explicitly out of scope here
--     and will be introduced in a future migration. This migration installs
--     the table inert/read-only, exactly like 082 installed the mapping
--     schema inert before 083 activated draft/publish.

CREATE TABLE IF NOT EXISTS public.provider_industry_raw_label_observations (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_vocabulary_key    text        NOT NULL
    REFERENCES public.provider_industry_source_vocabularies(source_vocabulary_key) ON DELETE RESTRICT,
  provider_key             text        NOT NULL,
  operation_key            text        NOT NULL,
  raw_label                text        NOT NULL,
  normalized_lookup_key    text        NOT NULL,
  country_code             text        NULL,
  requested_industry       text        NULL,
  observed_count           integer     NOT NULL DEFAULT 1,
  first_observed_at        timestamptz NOT NULL DEFAULT now(),
  last_observed_at         timestamptz NOT NULL DEFAULT now(),
  first_observed_run_id    uuid        NULL
    REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  last_observed_run_id     uuid        NULL
    REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  source_context           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_industry_raw_label_observations_raw_label_nonempty_chk
    CHECK (trim(raw_label) <> ''),
  CONSTRAINT provider_industry_raw_label_observations_normalized_lookup_key_nonempty_chk
    CHECK (trim(normalized_lookup_key) <> ''),
  CONSTRAINT provider_industry_raw_label_observations_observed_count_positive_chk
    CHECK (observed_count > 0)
);

COMMENT ON TABLE public.provider_industry_raw_label_observations IS
  'Runtime observations of raw provider industry labels (aggregate/upsert model, M3). Not a mapping: creates no concept entries and is not part of the provider_industry_mapping_snapshots draft/publish/archive lifecycle. provider_key (the data provider, e.g. apollo) and source_vocabulary_key (the governed vocabulary namespace) are distinct identities. source_context must not contain PII or a full provider payload. Installed inert/read-only (Q3F-5AU.3); write activation is deferred to a future migration.';

COMMENT ON COLUMN public.provider_industry_raw_label_observations.provider_key IS
  'Identifies the data provider/integration (e.g. apollo). Distinct from source_vocabulary_key, which identifies the governed vocabulary namespace.';

COMMENT ON COLUMN public.provider_industry_raw_label_observations.source_context IS
  'Small triage context payload. Must not contain PII or the full raw provider response.';

-- Reuses the existing generic updated_at trigger function (see 038/082).
DROP TRIGGER IF EXISTS provider_industry_raw_label_observations_set_updated_at
  ON public.provider_industry_raw_label_observations;
CREATE TRIGGER provider_industry_raw_label_observations_set_updated_at
  BEFORE UPDATE ON public.provider_industry_raw_label_observations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Indexes
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_pirlo_observation_identity
  ON public.provider_industry_raw_label_observations (
    source_vocabulary_key,
    operation_key,
    normalized_lookup_key,
    COALESCE(country_code, '')
  );

CREATE INDEX IF NOT EXISTS idx_pirlo_top_labels
  ON public.provider_industry_raw_label_observations (source_vocabulary_key, observed_count DESC);

CREATE INDEX IF NOT EXISTS idx_pirlo_country
  ON public.provider_industry_raw_label_observations (source_vocabulary_key, country_code)
  WHERE country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pirlo_last_observed_run
  ON public.provider_industry_raw_label_observations (last_observed_run_id)
  WHERE last_observed_run_id IS NOT NULL;

-- ============================================================
-- RLS and privileges — inert/read-only posture
-- ============================================================

ALTER TABLE public.provider_industry_raw_label_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "active_users_can_read_provider_industry_raw_label_observations"
  ON public.provider_industry_raw_label_observations;
CREATE POLICY "active_users_can_read_provider_industry_raw_label_observations"
  ON public.provider_industry_raw_label_observations FOR SELECT
  TO authenticated
  USING (public.has_active_access(auth.uid()));

REVOKE ALL ON public.provider_industry_raw_label_observations FROM PUBLIC;
REVOKE ALL ON public.provider_industry_raw_label_observations FROM anon;
REVOKE ALL ON public.provider_industry_raw_label_observations FROM authenticated;
REVOKE ALL ON public.provider_industry_raw_label_observations FROM service_role;

GRANT SELECT ON public.provider_industry_raw_label_observations TO authenticated;
GRANT SELECT ON public.provider_industry_raw_label_observations TO service_role;

-- No INSERT/UPDATE/DELETE grant to any role. No RPC. No seed. Capture
-- (writing) is intentionally not activated by this migration.
