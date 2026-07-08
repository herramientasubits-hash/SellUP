-- ============================================================
-- Migration 082: Provider Industry Mapping Schema — inert installation (Q3F-5AH)
-- ============================================================
-- Implements the CLOSED physical contract from Q3F-5AG
-- (PROVIDER_MAPPING_PHYSICAL_SCHEMA_CONTRACT_CLOSED).
--
-- Installs the provider-industry-mapping physical substrate:
--   - four physical domain tables
--   - content_revision BIGINT optimistic-concurrency counter
--   - FKs, CHECK constraints, UNIQUE constraints
--   - single-published-snapshot partial unique index
--   - supporting indexes
--   - RLS (SELECT-only for authenticated users)
--   - vocabulary lifecycle + INS1 + snapshot state-machine/revision triggers
--   - concept-entry and association child (REV1) triggers
--   - publication / archive / draft-delete RPCs
--   - explicit EXECUTE revocation on all new RPCs and trigger functions
--
-- This migration installs the schema INERT. service_role receives SELECT
-- only — no INSERT/UPDATE/DELETE grant on the four tables, and no EXECUTE
-- grant on the three lifecycle RPCs. PB1 (the future runtime mutation
-- model) is NOT activated here. Runtime mutation privileges are
-- intentionally deferred to a later activation migration, after the
-- Domain DRAFT Service, the Domain Publication Service, the TypeScript
-- publication validator, LOAD1 and LOAD2 validation are implemented.
--
-- SEED0: no rows are inserted by this migration. All four tables start
-- empty. No sourceVocabularyKey (e.g. apollo/organizations,
-- lusha/company_prospecting_v3) is seeded here.
--
-- SP1 (PG_TEMP_FULLY_QUALIFIED): every new SECURITY DEFINER function and
-- trigger function in this migration uses `SET search_path = pg_temp`,
-- and every public dependency referenced inside a function body is
-- schema-qualified (public.<object>).
-- ============================================================


-- ============================================================
-- SECTION 1: Table — provider_industry_source_vocabularies
-- ============================================================
-- Recognized sourceVocabularyKey registry and vocabulary lifecycle
-- authority. source_vocabulary_key is the stable string identity; no
-- provider_id / vocabulary_id / taxonomy_version / vocabulary_version
-- columns are introduced.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_industry_source_vocabularies (
  source_vocabulary_key  TEXT        PRIMARY KEY,
  lifecycle               TEXT        NOT NULL DEFAULT 'active',
  display_name            TEXT        NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pisv_lifecycle_valid CHECK (lifecycle IN ('active', 'deprecated')),
  CONSTRAINT pisv_key_not_empty   CHECK (trim(source_vocabulary_key) <> '')
);

COMMENT ON TABLE public.provider_industry_source_vocabularies IS
  'Registry of recognized provider industry source vocabularies (sourceVocabularyKey) and their lifecycle. Installed inert (Q3F-5AH).';

-- Reuses the existing generic updated_at trigger function. Only this
-- table gets it — the mapping snapshot table intentionally has no
-- updated_at column (see SECTION 2).
DROP TRIGGER IF EXISTS provider_industry_source_vocabularies_set_updated_at
  ON public.provider_industry_source_vocabularies;
CREATE TRIGGER provider_industry_source_vocabularies_set_updated_at
  BEFORE UPDATE ON public.provider_industry_source_vocabularies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- SECTION 2: Table — provider_industry_mapping_snapshots
-- ============================================================
-- One row per draft/published/archived mapping snapshot for an exact
-- (source_vocabulary_key, catalog_version_id) scope. No updated_at,
-- no updated_by — snapshot metadata mutation is governed exclusively by
-- the state-machine/revision trigger (SECTION 8) and the lifecycle RPCs
-- (SECTIONS 10-12).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_industry_mapping_snapshots (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_vocabulary_key   TEXT        NOT NULL
    REFERENCES public.provider_industry_source_vocabularies(source_vocabulary_key) ON DELETE RESTRICT,
  catalog_version_id      UUID        NOT NULL
    REFERENCES public.industry_catalog_versions(id) ON DELETE RESTRICT,
  status                  TEXT        NOT NULL DEFAULT 'draft',
  version_label           TEXT        NULL,
  change_reason           TEXT        NULL,
  content_revision        BIGINT      NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID        NOT NULL
    REFERENCES public.internal_users(id) ON DELETE RESTRICT,
  published_at            TIMESTAMPTZ NULL,
  published_by            UUID        NULL
    REFERENCES public.internal_users(id) ON DELETE RESTRICT,
  archived_at             TIMESTAMPTZ NULL,
  archived_by             UUID        NULL
    REFERENCES public.internal_users(id) ON DELETE RESTRICT,

  CONSTRAINT pims_status_valid CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT pims_content_revision_nn CHECK (content_revision >= 0),

  CONSTRAINT pims_draft_shape CHECK (
    status <> 'draft' OR (
      published_at IS NULL AND published_by IS NULL
      AND archived_at IS NULL AND archived_by IS NULL
    )
  ),
  CONSTRAINT pims_published_shape CHECK (
    status <> 'published' OR (
      published_at IS NOT NULL AND published_by IS NOT NULL
      AND archived_at IS NULL AND archived_by IS NULL
    )
  ),
  CONSTRAINT pims_archived_shape CHECK (
    status <> 'archived' OR (
      published_at IS NOT NULL AND published_by IS NOT NULL
      AND archived_at IS NOT NULL AND archived_by IS NOT NULL
    )
  ),

  CONSTRAINT pims_version_label_required_when_finalized CHECK (
    status = 'draft' OR (version_label IS NOT NULL AND trim(version_label) <> '')
  ),
  CONSTRAINT pims_change_reason_required_when_finalized CHECK (
    status = 'draft' OR (change_reason IS NOT NULL AND trim(change_reason) <> '')
  ),
  CONSTRAINT pims_publisher_not_author CHECK (
    status = 'draft' OR created_by <> published_by
  )
);

COMMENT ON TABLE public.provider_industry_mapping_snapshots IS
  'Draft/published/archived provider industry mapping snapshots. Installed inert (Q3F-5AH). '
  'Runtime mutation privileges are intentionally deferred to a later activation migration, '
  'after the Domain DRAFT Service, the Domain Publication Service, the TypeScript publication '
  'validator, LOAD1 and LOAD2 validation are implemented.';

-- Single-published-snapshot guarantee (DB-backed, not application-level):
-- at most one PUBLISHED snapshot per exact (source_vocabulary_key,
-- catalog_version_id) scope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pims_single_published_scope
  ON public.provider_industry_mapping_snapshots (source_vocabulary_key, catalog_version_id)
  WHERE status = 'published';

-- Scope/status lookup: leading column source_vocabulary_key also serves
-- the vocabulary-lifecycle VL1 check ("any PUBLISHED snapshot exists for
-- this vocabulary key", unscoped by catalog_version_id).
CREATE INDEX IF NOT EXISTS idx_pims_scope_status
  ON public.provider_industry_mapping_snapshots (source_vocabulary_key, catalog_version_id, status);

-- Author/creator lookup.
CREATE INDEX IF NOT EXISTS idx_pims_created_by
  ON public.provider_industry_mapping_snapshots (created_by);

-- NOTE: a bare status-only index is intentionally NOT created. Every
-- closed query contract (VL1 check, publication RPC scope resolution,
-- scope/status lookups) filters by source_vocabulary_key at minimum, so
-- idx_pims_scope_status already serves those access paths via its
-- leading column. A separate status-only index would only serve
-- hypothetical unscoped queries with no closed contract requiring them.


-- ============================================================
-- SECTION 3: Table — provider_industry_concept_entries
-- ============================================================
-- COL1 physical persisted-key uniqueness: UNIQUE(snapshot_id,
-- normalized_lookup_key) proves uniqueness of PERSISTED normalized keys
-- only. It does NOT prove normalized_lookup_key =
-- normalizeClassificationValue(raw_label) — that normalizer is NOT
-- implemented in PostgreSQL (no unaccent, no DB normalizer, no aliases).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_industry_concept_entries (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id            UUID        NOT NULL
    REFERENCES public.provider_industry_mapping_snapshots(id) ON DELETE RESTRICT,
  raw_label              TEXT        NOT NULL,
  normalized_lookup_key  TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pice_raw_label_not_empty             CHECK (trim(raw_label) <> ''),
  CONSTRAINT pice_normalized_lookup_key_not_empty CHECK (trim(normalized_lookup_key) <> ''),
  CONSTRAINT pice_snapshot_normalized_key_uniq    UNIQUE (snapshot_id, normalized_lookup_key)
);

COMMENT ON TABLE public.provider_industry_concept_entries IS
  'Raw source labels and their persisted normalized lookup key within a mapping snapshot. Installed inert (Q3F-5AH).';

-- NOTE: no separate concept-entry snapshot-lookup index is created.
-- pice_snapshot_normalized_key_uniq is a UNIQUE(snapshot_id,
-- normalized_lookup_key) constraint whose backing B-tree already has
-- snapshot_id as its leading column, so a dedicated
-- concept_entries(snapshot_id) index would be fully redundant.


-- ============================================================
-- SECTION 4: Table — provider_industry_mapping_associations
-- ============================================================
-- CAT-FK2: composite FK (industry_id, catalog_version_id) →
-- industries(id, catalog_version_id), reusing the existing
-- industries_id_version_uniq constraint from migration 057. industries
-- is NOT modified.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_industry_mapping_associations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_entry_id     UUID        NOT NULL
    REFERENCES public.provider_industry_concept_entries(id) ON DELETE RESTRICT,
  snapshot_id          UUID        NOT NULL
    REFERENCES public.provider_industry_mapping_snapshots(id) ON DELETE RESTRICT,
  industry_id          UUID        NOT NULL,
  catalog_version_id   UUID        NOT NULL,
  relation_semantics   TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pima_relation_semantics_valid CHECK (
    relation_semantics IN (
      'SOURCE_EQUIVALENT_TO_CANONICAL',
      'SOURCE_BROADER_THAN_CANONICAL',
      'SOURCE_NARROWER_THAN_CANONICAL'
    )
  ),

  -- Permits: 0 associations, exactly 1 association, or N DISTINCT
  -- industry targets per concept entry. Does NOT constrain one
  -- association per concept entry.
  CONSTRAINT pima_concept_industry_uniq UNIQUE (concept_entry_id, industry_id),

  -- CAT-FK2: reuses industries_id_version_uniq (migration 057).
  CONSTRAINT pima_industry_version_fk FOREIGN KEY (industry_id, catalog_version_id)
    REFERENCES public.industries(id, catalog_version_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.provider_industry_mapping_associations IS
  'Concept-entry to canonical-industry associations with relation semantics, scoped to a mapping snapshot. Installed inert (Q3F-5AH).';

-- NOTE: no separate association concept_entry-lookup index is created.
-- pima_concept_industry_uniq is UNIQUE(concept_entry_id, industry_id)
-- and its backing B-tree already has concept_entry_id as its leading
-- column, so a dedicated associations(concept_entry_id) index would be
-- fully redundant.

-- Snapshot-scoped lookup (not covered by any unique constraint above,
-- since pima_concept_industry_uniq does not lead with snapshot_id).
CREATE INDEX IF NOT EXISTS idx_pima_snapshot_id
  ON public.provider_industry_mapping_associations (snapshot_id);

-- Canonical-target reverse lookup (find associations targeting a given
-- industry within a catalog version).
CREATE INDEX IF NOT EXISTS idx_pima_industry_target
  ON public.provider_industry_mapping_associations (industry_id, catalog_version_id);


-- ============================================================
-- SECTION 5: Vocabulary lifecycle trigger (BEFORE INSERT OR UPDATE)
-- ============================================================
-- INSERT: NEW.lifecycle must be 'active' (VOCABULARY_INSERT_ACTIVE_ONLY).
-- UPDATE: source_vocabulary_key is update-immutable. Lifecycle
-- transitions: active→active, active→deprecated (only under VL1),
-- deprecated→deprecated allowed; deprecated→active forbidden.
--
-- VL1: for active→deprecated, the triggering UPDATE already owns the
-- vocabulary row lock (it is the row being updated), so no additional
-- explicit locking statement is required here. Before allowing the
-- transition, reject if any PUBLISHED snapshot exists for
-- OLD.source_vocabulary_key. No automatic snapshot archival is
-- performed inside this trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provider_industry_source_vocabulary_lifecycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_published_exists BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle <> 'active' THEN
      RAISE EXCEPTION 'VOCABULARY_INSERT_ACTIVE_ONLY';
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.source_vocabulary_key IS DISTINCT FROM OLD.source_vocabulary_key THEN
    RAISE EXCEPTION 'VOCABULARY_KEY_IMMUTABLE';
  END IF;

  IF OLD.lifecycle = NEW.lifecycle THEN
    RETURN NEW;
  END IF;

  IF OLD.lifecycle = 'deprecated' AND NEW.lifecycle = 'active' THEN
    RAISE EXCEPTION 'DEPRECATED_TO_ACTIVE_FORBIDDEN';
  END IF;

  IF OLD.lifecycle = 'active' AND NEW.lifecycle = 'deprecated' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.provider_industry_mapping_snapshots
      WHERE source_vocabulary_key = OLD.source_vocabulary_key
        AND status = 'published'
    ) INTO v_published_exists;

    IF v_published_exists THEN
      RAISE EXCEPTION 'PUBLISHED_SNAPSHOTS_EXIST_FOR_VOCABULARY';
    END IF;

    RETURN NEW;
  END IF;

  -- Unreachable given the pisv_lifecycle_valid CHECK constraint
  -- (only 'active'/'deprecated' are valid values), rejected defensively.
  RAISE EXCEPTION 'VOCABULARY_LIFECYCLE_TRANSITION_INVALID';
END;
$$;

REVOKE ALL ON FUNCTION public.provider_industry_source_vocabulary_lifecycle_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_industry_source_vocabulary_lifecycle_guard() FROM anon;
REVOKE ALL ON FUNCTION public.provider_industry_source_vocabulary_lifecycle_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.provider_industry_source_vocabulary_lifecycle_guard() FROM service_role;

DROP TRIGGER IF EXISTS trg_provider_industry_source_vocabulary_lifecycle_guard
  ON public.provider_industry_source_vocabularies;
CREATE TRIGGER trg_provider_industry_source_vocabulary_lifecycle_guard
  BEFORE INSERT OR UPDATE ON public.provider_industry_source_vocabularies
  FOR EACH ROW EXECUTE FUNCTION public.provider_industry_source_vocabulary_lifecycle_guard();


-- ============================================================
-- SECTION 6: INS1 — snapshot insert trigger (BEFORE INSERT)
-- ============================================================
-- Requires the row to be born as a canonical DRAFT (status='draft',
-- published_at/published_by/archived_at/archived_by all NULL,
-- content_revision=0), then locks the parent vocabulary row (FOR
-- UPDATE) and requires lifecycle='active'. This lock is held until the
-- INSERT transaction commits, so DRAFT creation and vocabulary
-- deprecation serialize on the same vocabulary row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provider_industry_mapping_snapshot_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_lifecycle TEXT;
BEGIN
  IF NEW.status <> 'draft'
     OR NEW.published_at IS NOT NULL
     OR NEW.published_by IS NOT NULL
     OR NEW.archived_at IS NOT NULL
     OR NEW.archived_by IS NOT NULL
     OR NEW.content_revision <> 0 THEN
    RAISE EXCEPTION 'SNAPSHOT_INSERT_DRAFT_ONLY';
  END IF;

  SELECT lifecycle INTO v_lifecycle
  FROM public.provider_industry_source_vocabularies
  WHERE source_vocabulary_key = NEW.source_vocabulary_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOCABULARY_NOT_REGISTERED';
  END IF;

  IF v_lifecycle <> 'active' THEN
    RAISE EXCEPTION 'VOCABULARY_DEPRECATED';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_insert_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_insert_guard() FROM anon;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_insert_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_insert_guard() FROM service_role;

DROP TRIGGER IF EXISTS trg_provider_industry_mapping_snapshot_insert_guard
  ON public.provider_industry_mapping_snapshots;
CREATE TRIGGER trg_provider_industry_mapping_snapshot_insert_guard
  BEFORE INSERT ON public.provider_industry_mapping_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.provider_industry_mapping_snapshot_insert_guard();


-- ============================================================
-- SECTION 7: Snapshot state-machine / revision trigger
--            (BEFORE UPDATE OR DELETE)
-- ============================================================
-- OLD=DRAFT:
--   DELETE: allowed.
--   UPDATE: source_vocabulary_key / catalog_version_id / created_by are
--     immutable. DRAFT→ARCHIVED rejected. DRAFT→DRAFT: version_label /
--     change_reason may change; if either changed, the submitted
--     content_revision must equal OLD.content_revision and the trigger
--     bumps it by exactly 1. If neither changed, a revision-only bump
--     (NEW.content_revision = OLD.content_revision + 1, the REV1 path)
--     or a true no-op (NEW.content_revision = OLD.content_revision) is
--     allowed; any other delta is rejected. DRAFT→PUBLISHED: allowed
--     only if source_vocabulary_key/catalog_version_id/created_by/
--     content_revision are unchanged (publication shape itself is
--     enforced by the pims_* CHECK constraints).
-- OLD=PUBLISHED:
--   DELETE: rejected. PUBLISHED→ARCHIVED: only status/archived_at/
--     archived_by may differ. PUBLISHED→PUBLISHED: no field may differ.
--     PUBLISHED→ any other status: rejected.
-- OLD=ARCHIVED:
--   DELETE: rejected. Any UPDATE: rejected.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provider_industry_mapping_snapshot_transition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_meta_changed BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
  END IF;

  -- TG_OP = 'UPDATE'

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.source_vocabulary_key IS DISTINCT FROM OLD.source_vocabulary_key
       OR NEW.catalog_version_id IS DISTINCT FROM OLD.catalog_version_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
    END IF;

    IF NEW.status = 'archived' THEN
      RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
    END IF;

    IF NEW.status = 'draft' THEN
      v_meta_changed :=
        (NEW.version_label IS DISTINCT FROM OLD.version_label)
        OR (NEW.change_reason IS DISTINCT FROM OLD.change_reason);

      IF v_meta_changed THEN
        IF NEW.content_revision <> OLD.content_revision THEN
          RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
        END IF;
        NEW.content_revision := OLD.content_revision + 1;
      ELSIF NEW.content_revision = OLD.content_revision + 1 THEN
        -- Revision-only path: REV1 child-trigger system-maintained increment.
        NULL;
      ELSIF NEW.content_revision = OLD.content_revision THEN
        -- True no-op.
        NULL;
      ELSE
        RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
      END IF;

      RETURN NEW;
    END IF;

    IF NEW.status = 'published' THEN
      IF NEW.content_revision <> OLD.content_revision THEN
        RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
      END IF;
      -- Publication shape (published_at/published_by presence,
      -- version_label/change_reason presence) is validated by the
      -- pims_published_shape / pims_version_label_required_when_finalized /
      -- pims_change_reason_required_when_finalized / pims_publisher_not_author
      -- CHECK constraints.
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
  END IF;

  -- OLD.status = 'published'

  IF NEW.status = 'archived' THEN
    IF NEW.source_vocabulary_key IS DISTINCT FROM OLD.source_vocabulary_key
       OR NEW.catalog_version_id IS DISTINCT FROM OLD.catalog_version_id
       OR NEW.version_label IS DISTINCT FROM OLD.version_label
       OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
       OR NEW.content_revision IS DISTINCT FROM OLD.content_revision
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
      RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'published' THEN
    IF NEW.source_vocabulary_key IS DISTINCT FROM OLD.source_vocabulary_key
       OR NEW.catalog_version_id IS DISTINCT FROM OLD.catalog_version_id
       OR NEW.version_label IS DISTINCT FROM OLD.version_label
       OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
       OR NEW.content_revision IS DISTINCT FROM OLD.content_revision
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
       OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
      RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;

  -- PUBLISHED → DRAFT or any other status.
  RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
END;
$$;

REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_transition_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_transition_guard() FROM anon;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_transition_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_snapshot_transition_guard() FROM service_role;

DROP TRIGGER IF EXISTS trg_provider_industry_mapping_snapshot_transition_guard
  ON public.provider_industry_mapping_snapshots;
CREATE TRIGGER trg_provider_industry_mapping_snapshot_transition_guard
  BEFORE UPDATE OR DELETE ON public.provider_industry_mapping_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.provider_industry_mapping_snapshot_transition_guard();


-- ============================================================
-- SECTION 8: REV1 — concept-entry child trigger
--            (BEFORE INSERT OR UPDATE OR DELETE)
-- ============================================================
-- Resolves the parent snapshot_id, locks the parent snapshot row (FOR
-- UPDATE), requires parent status='draft', then advances
-- parent.content_revision by exactly 1 for every semantic child
-- mutation. The parent-row lock is the same lock used by the
-- publication RPC, so child mutation and publication serialize.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provider_industry_concept_entry_child_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_snapshot_id      UUID;
  v_snapshot_status  TEXT;
  v_semantic_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_snapshot_id := NEW.snapshot_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_snapshot_id := OLD.snapshot_id;
  ELSE
    IF NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id THEN
      RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
    END IF;
    v_snapshot_id := NEW.snapshot_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_semantic_changed :=
      (NEW.raw_label IS DISTINCT FROM OLD.raw_label)
      OR (NEW.normalized_lookup_key IS DISTINCT FROM OLD.normalized_lookup_key);
  END IF;

  -- Parent lock + DRAFT check happens unconditionally (including
  -- no-semantic-change updates): after the parent leaves DRAFT, every
  -- INSERT/UPDATE/DELETE on this table must reject.
  SELECT status INTO v_snapshot_status
  FROM public.provider_industry_mapping_snapshots
  WHERE id = v_snapshot_id
  FOR UPDATE;

  IF NOT FOUND OR v_snapshot_status <> 'draft' THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
  END IF;

  IF TG_OP = 'UPDATE' AND NOT v_semantic_changed THEN
    RETURN NEW;
  END IF;

  UPDATE public.provider_industry_mapping_snapshots
  SET content_revision = content_revision + 1
  WHERE id = v_snapshot_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_industry_concept_entry_child_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_industry_concept_entry_child_guard() FROM anon;
REVOKE ALL ON FUNCTION public.provider_industry_concept_entry_child_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.provider_industry_concept_entry_child_guard() FROM service_role;

DROP TRIGGER IF EXISTS trg_provider_industry_concept_entry_child_guard
  ON public.provider_industry_concept_entries;
CREATE TRIGGER trg_provider_industry_concept_entry_child_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.provider_industry_concept_entries
  FOR EACH ROW EXECUTE FUNCTION public.provider_industry_concept_entry_child_guard();


-- ============================================================
-- SECTION 9: REV1 — association child trigger
--            (BEFORE INSERT OR UPDATE OR DELETE)
-- ============================================================
-- Same parent-lock/DRAFT/REV1 protocol as SECTION 8, plus: on INSERT
-- (and on UPDATE of industry_id/catalog_version_id/relation_semantics)
-- re-validates that the referenced concept entry belongs to the same
-- snapshot, and that catalog_version_id matches the parent snapshot's
-- catalog_version_id. The composite FK (pima_industry_version_fk)
-- independently proves industry_id belongs to catalog_version_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provider_industry_mapping_association_child_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_snapshot_id                  UUID;
  v_snapshot_status               TEXT;
  v_snapshot_catalog_version_id   UUID;
  v_concept_entry_snapshot_id     UUID;
  v_semantic_changed              BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_snapshot_id := NEW.snapshot_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_snapshot_id := OLD.snapshot_id;
  ELSE
    IF NEW.concept_entry_id IS DISTINCT FROM OLD.concept_entry_id
       OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id THEN
      RAISE EXCEPTION 'SNAPSHOT_CONTENT_IMMUTABLE';
    END IF;
    v_snapshot_id := NEW.snapshot_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_semantic_changed :=
      (NEW.industry_id IS DISTINCT FROM OLD.industry_id)
      OR (NEW.catalog_version_id IS DISTINCT FROM OLD.catalog_version_id)
      OR (NEW.relation_semantics IS DISTINCT FROM OLD.relation_semantics);
  END IF;

  -- Parent lock + DRAFT check happens unconditionally (including
  -- no-semantic-change updates): after the parent leaves DRAFT, every
  -- INSERT/UPDATE/DELETE on this table must reject.
  SELECT status, catalog_version_id
  INTO v_snapshot_status, v_snapshot_catalog_version_id
  FROM public.provider_industry_mapping_snapshots
  WHERE id = v_snapshot_id
  FOR UPDATE;

  IF NOT FOUND OR v_snapshot_status <> 'draft' THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
  END IF;

  IF TG_OP = 'UPDATE' AND NOT v_semantic_changed THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT snapshot_id INTO v_concept_entry_snapshot_id
    FROM public.provider_industry_concept_entries
    WHERE id = NEW.concept_entry_id;

    IF NOT FOUND OR v_concept_entry_snapshot_id <> NEW.snapshot_id THEN
      RAISE EXCEPTION 'SNAPSHOT_SCOPE_INTEGRITY_ERROR';
    END IF;

    IF NEW.catalog_version_id <> v_snapshot_catalog_version_id THEN
      RAISE EXCEPTION 'SNAPSHOT_SCOPE_INTEGRITY_ERROR';
    END IF;
  END IF;

  UPDATE public.provider_industry_mapping_snapshots
  SET content_revision = content_revision + 1
  WHERE id = v_snapshot_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_industry_mapping_association_child_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_association_child_guard() FROM anon;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_association_child_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.provider_industry_mapping_association_child_guard() FROM service_role;

DROP TRIGGER IF EXISTS trg_provider_industry_mapping_association_child_guard
  ON public.provider_industry_mapping_associations;
CREATE TRIGGER trg_provider_industry_mapping_association_child_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.provider_industry_mapping_associations
  FOR EACH ROW EXECUTE FUNCTION public.provider_industry_mapping_association_child_guard();


-- ============================================================
-- SECTION 10: Publication RPC
-- ============================================================
-- Transactional protocol: non-locking bootstrap read of
-- source_vocabulary_key → vocabulary row lock (FOR UPDATE) → target
-- snapshot row lock (FOR UPDATE) → revalidate scope + DRAFT + publisher
-- != author + version_label/change_reason present + content_revision
-- pin (PV1: p_expected_content_revision) → lock+archive current
-- PUBLISHED scope row if present → publish target. Single Postgres
-- function statement transaction owns atomicity; no explicit
-- BEGIN/COMMIT.
--
-- This RPC does NOT claim the TypeScript publication validator ran, and
-- does NOT normalize raw labels. The layered trust boundary remains:
-- Domain Publication Service + PV1 revision pin + this RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_provider_industry_mapping_snapshot(
  p_snapshot_id UUID,
  p_publisher_id UUID,
  p_expected_content_revision BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_bootstrap_source_vocabulary_key TEXT;
  v_vocab_lifecycle                 TEXT;
  v_snapshot                        RECORD;
  v_current_published_id            UUID;
BEGIN
  -- STEP 1: bootstrap scope (non-locking read).
  SELECT source_vocabulary_key
  INTO v_bootstrap_source_vocabulary_key
  FROM public.provider_industry_mapping_snapshots
  WHERE id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND';
  END IF;

  -- STEP 2: vocabulary lock.
  SELECT lifecycle INTO v_vocab_lifecycle
  FROM public.provider_industry_source_vocabularies
  WHERE source_vocabulary_key = v_bootstrap_source_vocabulary_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOCABULARY_NOT_REGISTERED';
  END IF;

  IF v_vocab_lifecycle <> 'active' THEN
    RAISE EXCEPTION 'VOCABULARY_DEPRECATED';
  END IF;

  -- STEP 3: target snapshot lock.
  SELECT *
  INTO v_snapshot
  FROM public.provider_industry_mapping_snapshots
  WHERE id = p_snapshot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND';
  END IF;

  IF v_snapshot.source_vocabulary_key <> v_bootstrap_source_vocabulary_key THEN
    RAISE EXCEPTION 'SNAPSHOT_SCOPE_INTEGRITY_ERROR';
  END IF;

  IF v_snapshot.status <> 'draft' THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
  END IF;

  IF p_publisher_id IS NULL THEN
    RAISE EXCEPTION 'PUBLISHER_REQUIRED';
  END IF;

  IF p_publisher_id = v_snapshot.created_by THEN
    RAISE EXCEPTION 'SELF_APPROVAL_FORBIDDEN';
  END IF;

  IF v_snapshot.version_label IS NULL OR trim(v_snapshot.version_label) = '' THEN
    RAISE EXCEPTION 'VERSION_LABEL_REQUIRED';
  END IF;

  IF v_snapshot.change_reason IS NULL OR trim(v_snapshot.change_reason) = '' THEN
    RAISE EXCEPTION 'CHANGE_REASON_REQUIRED';
  END IF;

  IF v_snapshot.content_revision <> p_expected_content_revision THEN
    RAISE EXCEPTION 'DRAFT_CONTENT_CHANGED_AFTER_VALIDATION';
  END IF;

  -- STEP 4: current PUBLISHED scope row (locked if present). The target
  -- DRAFT itself cannot match this predicate (status='draft').
  SELECT id INTO v_current_published_id
  FROM public.provider_industry_mapping_snapshots
  WHERE source_vocabulary_key = v_bootstrap_source_vocabulary_key
    AND catalog_version_id = v_snapshot.catalog_version_id
    AND status = 'published'
  FOR UPDATE;

  -- STEP 5: archive current snapshot if present.
  IF v_current_published_id IS NOT NULL THEN
    UPDATE public.provider_industry_mapping_snapshots
    SET status = 'archived',
        archived_at = now(),
        archived_by = p_publisher_id
    WHERE id = v_current_published_id;
  END IF;

  -- STEP 6: publish target. content_revision is not touched.
  UPDATE public.provider_industry_mapping_snapshots
  SET status = 'published',
      published_at = now(),
      published_by = p_publisher_id
  WHERE id = p_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM authenticated;
REVOKE ALL ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM service_role;


-- ============================================================
-- SECTION 11: Archive RPC
-- ============================================================
-- Locks the target snapshot, requires status='published', sets only
-- status/archived_at/archived_by. Does not touch semantic content or
-- content_revision, and does not change vocabulary lifecycle.
-- ============================================================

CREATE OR REPLACE FUNCTION public.archive_provider_industry_mapping_snapshot(
  p_snapshot_id UUID,
  p_archivist_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.provider_industry_mapping_snapshots
  WHERE id = p_snapshot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND';
  END IF;

  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_PUBLISHED';
  END IF;

  IF p_archivist_id IS NULL THEN
    RAISE EXCEPTION 'ARCHIVIST_REQUIRED';
  END IF;

  UPDATE public.provider_industry_mapping_snapshots
  SET status = 'archived',
      archived_at = now(),
      archived_by = p_archivist_id
  WHERE id = p_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM service_role;


-- ============================================================
-- SECTION 12: DRAFT-delete RPC
-- ============================================================
-- Locks the target snapshot, requires status='draft' and
-- p_actor_id = snapshot.created_by, then atomically deletes
-- associations, then concept entries, then the snapshot itself
-- (matching the ON DELETE RESTRICT FK ordering). Child DELETE triggers
-- may advance the soon-deleted parent revision; that is accepted since
-- everything happens within the same transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_draft_provider_industry_mapping_snapshot(
  p_snapshot_id UUID,
  p_actor_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_status     TEXT;
  v_created_by UUID;
BEGIN
  SELECT status, created_by INTO v_status, v_created_by
  FROM public.provider_industry_mapping_snapshots
  WHERE id = p_snapshot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_DRAFT';
  END IF;

  IF p_actor_id IS DISTINCT FROM v_created_by THEN
    RAISE EXCEPTION 'DRAFT_AUTHOR_REQUIRED';
  END IF;

  DELETE FROM public.provider_industry_mapping_associations
  WHERE snapshot_id = p_snapshot_id;

  DELETE FROM public.provider_industry_concept_entries
  WHERE snapshot_id = p_snapshot_id;

  DELETE FROM public.provider_industry_mapping_snapshots
  WHERE id = p_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM service_role;


-- ============================================================
-- SECTION 13: RLS — SELECT-only for authenticated users
-- ============================================================
-- No role-specific product permission model (Administrator/Seller/
-- Manager/Leader/module permissions) is introduced here — that is
-- explicitly out of scope.
-- ============================================================

ALTER TABLE public.provider_industry_source_vocabularies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_industry_mapping_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_industry_concept_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_industry_mapping_associations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "active_users_can_read_provider_industry_source_vocabularies"
  ON public.provider_industry_source_vocabularies;
CREATE POLICY "active_users_can_read_provider_industry_source_vocabularies"
  ON public.provider_industry_source_vocabularies FOR SELECT
  TO authenticated
  USING (public.has_active_access(auth.uid()));

DROP POLICY IF EXISTS "active_users_can_read_provider_industry_mapping_snapshots"
  ON public.provider_industry_mapping_snapshots;
CREATE POLICY "active_users_can_read_provider_industry_mapping_snapshots"
  ON public.provider_industry_mapping_snapshots FOR SELECT
  TO authenticated
  USING (public.has_active_access(auth.uid()));

DROP POLICY IF EXISTS "active_users_can_read_provider_industry_concept_entries"
  ON public.provider_industry_concept_entries;
CREATE POLICY "active_users_can_read_provider_industry_concept_entries"
  ON public.provider_industry_concept_entries FOR SELECT
  TO authenticated
  USING (public.has_active_access(auth.uid()));

DROP POLICY IF EXISTS "active_users_can_read_provider_industry_mapping_associations"
  ON public.provider_industry_mapping_associations;
CREATE POLICY "active_users_can_read_provider_industry_mapping_associations"
  ON public.provider_industry_mapping_associations FOR SELECT
  TO authenticated
  USING (public.has_active_access(auth.uid()));


-- ============================================================
-- SECTION 14: Inert installed privilege state
-- ============================================================
-- All four mapping tables: REVOKE ALL from PUBLIC/anon/authenticated/
-- service_role, then GRANT SELECT only to authenticated and
-- service_role. service_role receives NO INSERT/UPDATE/DELETE — PB1
-- (the future runtime mutation model) is NOT activated by this
-- migration. No activation migration number is assigned here.
-- ============================================================

REVOKE ALL ON public.provider_industry_source_vocabularies FROM PUBLIC;
REVOKE ALL ON public.provider_industry_source_vocabularies FROM anon;
REVOKE ALL ON public.provider_industry_source_vocabularies FROM authenticated;
REVOKE ALL ON public.provider_industry_source_vocabularies FROM service_role;
GRANT SELECT ON public.provider_industry_source_vocabularies TO authenticated;
GRANT SELECT ON public.provider_industry_source_vocabularies TO service_role;

REVOKE ALL ON public.provider_industry_mapping_snapshots FROM PUBLIC;
REVOKE ALL ON public.provider_industry_mapping_snapshots FROM anon;
REVOKE ALL ON public.provider_industry_mapping_snapshots FROM authenticated;
REVOKE ALL ON public.provider_industry_mapping_snapshots FROM service_role;
GRANT SELECT ON public.provider_industry_mapping_snapshots TO authenticated;
GRANT SELECT ON public.provider_industry_mapping_snapshots TO service_role;

REVOKE ALL ON public.provider_industry_concept_entries FROM PUBLIC;
REVOKE ALL ON public.provider_industry_concept_entries FROM anon;
REVOKE ALL ON public.provider_industry_concept_entries FROM authenticated;
REVOKE ALL ON public.provider_industry_concept_entries FROM service_role;
GRANT SELECT ON public.provider_industry_concept_entries TO authenticated;
GRANT SELECT ON public.provider_industry_concept_entries TO service_role;

REVOKE ALL ON public.provider_industry_mapping_associations FROM PUBLIC;
REVOKE ALL ON public.provider_industry_mapping_associations FROM anon;
REVOKE ALL ON public.provider_industry_mapping_associations FROM authenticated;
REVOKE ALL ON public.provider_industry_mapping_associations FROM service_role;
GRANT SELECT ON public.provider_industry_mapping_associations TO authenticated;
GRANT SELECT ON public.provider_industry_mapping_associations TO service_role;

-- Target runtime model (PB1) — comment only, not activated here.
-- Installed inert. Runtime mutation privileges are intentionally
-- deferred to a later activation migration after domain DRAFT service,
-- publication validator, publication service, LOAD1 and LOAD2
-- validation.
