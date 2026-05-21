-- ============================================================
-- Migration 040: Foundation de Lotes de Prospectos Candidatos
-- ============================================================
-- Crea las tablas prospect_batches, prospect_candidates y
-- prospect_candidate_audit con RLS, índices y triggers.
-- Prerequisito directo para el Agente 1 de generación de
-- prospectos. Los candidatos son revisables antes de
-- convertirse en cuentas definitivas.
-- ============================================================

-- ── 1. Tabla prospect_batches ─────────────────────────────────

CREATE TABLE IF NOT EXISTS prospect_batches (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT        NOT NULL,
    description         TEXT        NULL,
    country             TEXT        NULL,
    country_code        TEXT        NULL,
    industry            TEXT        NULL,
    target_count        INTEGER     NULL,
    search_depth        TEXT        NOT NULL DEFAULT 'standard'
        CHECK (search_depth IN ('basic', 'standard', 'deep')),
    status              TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft', 'generating', 'ready_for_review',
            'in_review', 'completed', 'cancelled', 'failed'
        )),
    source              TEXT        NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'agent_1', 'imported', 'apollo', 'other')),
    agent_run_id        UUID        NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
    created_by          UUID        NULL REFERENCES internal_users(id),
    owner_id            UUID        NULL REFERENCES internal_users(id),
    estimated_cost_usd  NUMERIC(12,6) NULL DEFAULT 0,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ NULL,
    archived_at         TIMESTAMPTZ NULL,
    archived_by         UUID        NULL REFERENCES internal_users(id)
);

-- ── 2. Tabla prospect_candidates ─────────────────────────────

CREATE TABLE IF NOT EXISTS prospect_candidates (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id                    UUID        NOT NULL REFERENCES prospect_batches(id) ON DELETE CASCADE,
    account_id                  UUID        NULL REFERENCES accounts(id) ON DELETE SET NULL,
    name                        TEXT        NOT NULL,
    legal_name                  TEXT        NULL,
    normalized_name             TEXT        NULL,
    website                     TEXT        NULL,
    domain                      TEXT        NULL,
    country                     TEXT        NULL,
    country_code                TEXT        NULL,
    city                        TEXT        NULL,
    region                      TEXT        NULL,
    industry                    TEXT        NULL,
    company_size                TEXT        NULL,
    tax_identifier              TEXT        NULL,
    tax_identifier_type         TEXT        NULL
        CHECK (tax_identifier_type IN (
            'NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ',
            'RNC', 'RTN', 'cedula_juridica', 'other', NULL
        )),
    source_primary              TEXT        NULL
        CHECK (source_primary IN (
            'manual', 'hubspot', 'apollo', 'lusha',
            'public_source', 'preloaded', 'web_ai', 'other', NULL
        )),
    sources_checked             JSONB       NOT NULL DEFAULT '[]'::jsonb,
    duplicate_status            TEXT        NOT NULL DEFAULT 'unchecked'
        CHECK (duplicate_status IN (
            'unchecked', 'no_match', 'possible_duplicate',
            'exact_duplicate', 'related_company', 'insufficient_data'
        )),
    matched_account_id          UUID        NULL REFERENCES accounts(id) ON DELETE SET NULL,
    matched_hubspot_company_id  TEXT        NULL,
    confidence_score            NUMERIC(5,2) NULL,
    fit_score                   NUMERIC(5,2) NULL,
    data_completeness_score     NUMERIC(5,2) NULL,
    estimated_cost_usd          NUMERIC(12,6) NULL DEFAULT 0,
    status                      TEXT        NOT NULL DEFAULT 'generated'
        CHECK (status IN (
            'generated', 'normalized', 'needs_review', 'approved',
            'discarded', 'duplicate', 'converted_to_account'
        )),
    review_notes                TEXT        NULL,
    reviewed_by                 UUID        NULL REFERENCES internal_users(id),
    reviewed_at                 TIMESTAMPTZ NULL,
    converted_account_id        UUID        NULL REFERENCES accounts(id) ON DELETE SET NULL,
    metadata                    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Tabla prospect_candidate_audit ────────────────────────

CREATE TABLE IF NOT EXISTS prospect_candidate_audit (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        UUID        NOT NULL REFERENCES prospect_batches(id) ON DELETE CASCADE,
    candidate_id    UUID        NULL REFERENCES prospect_candidates(id) ON DELETE CASCADE,
    actor_user_id   UUID        NULL REFERENCES internal_users(id),
    action_type     TEXT        NOT NULL
        CHECK (action_type IN (
            'batch_created', 'batch_updated', 'batch_status_changed',
            'candidate_created', 'candidate_updated',
            'candidate_approved', 'candidate_discarded',
            'candidate_marked_duplicate', 'candidate_converted_to_account'
        )),
    details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. Triggers updated_at ────────────────────────────────────

DROP TRIGGER IF EXISTS prospect_batches_set_updated_at ON prospect_batches;
CREATE TRIGGER prospect_batches_set_updated_at
    BEFORE UPDATE ON prospect_batches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS prospect_candidates_set_updated_at ON prospect_candidates;
CREATE TRIGGER prospect_candidates_set_updated_at
    BEFORE UPDATE ON prospect_candidates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. Índices ────────────────────────────────────────────────

-- prospect_batches
CREATE INDEX IF NOT EXISTS idx_prospect_batches_status
    ON prospect_batches (status);
CREATE INDEX IF NOT EXISTS idx_prospect_batches_country_code
    ON prospect_batches (country_code) WHERE country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_batches_industry
    ON prospect_batches (industry) WHERE industry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_batches_created_by
    ON prospect_batches (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_batches_created_at
    ON prospect_batches (created_at DESC);

-- prospect_candidates
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_batch_id
    ON prospect_candidates (batch_id);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_status
    ON prospect_candidates (status);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_duplicate_status
    ON prospect_candidates (duplicate_status);
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_domain
    ON prospect_candidates (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_normalized_name
    ON prospect_candidates (normalized_name) WHERE normalized_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_country_code
    ON prospect_candidates (country_code) WHERE country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_source_primary
    ON prospect_candidates (source_primary) WHERE source_primary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_candidates_converted_account_id
    ON prospect_candidates (converted_account_id) WHERE converted_account_id IS NOT NULL;

-- prospect_candidate_audit
CREATE INDEX IF NOT EXISTS idx_prospect_candidate_audit_batch_id
    ON prospect_candidate_audit (batch_id);
CREATE INDEX IF NOT EXISTS idx_prospect_candidate_audit_candidate_id
    ON prospect_candidate_audit (candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_candidate_audit_created_at
    ON prospect_candidate_audit (created_at DESC);

-- ── 6. RLS ────────────────────────────────────────────────────

ALTER TABLE prospect_batches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_candidates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_candidate_audit   ENABLE ROW LEVEL SECURITY;

-- prospect_batches: lectura
CREATE POLICY "active_users_can_read_prospect_batches"
    ON prospect_batches FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- prospect_batches: insertar
CREATE POLICY "active_users_can_insert_prospect_batches"
    ON prospect_batches FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- prospect_batches: actualizar (todos los activos; archivar solo admin se controla en app)
CREATE POLICY "active_users_can_update_prospect_batches"
    ON prospect_batches FOR UPDATE
    TO authenticated
    USING  (has_active_access(auth.uid()))
    WITH CHECK (has_active_access(auth.uid()));

-- prospect_candidates: lectura
CREATE POLICY "active_users_can_read_prospect_candidates"
    ON prospect_candidates FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- prospect_candidates: insertar
CREATE POLICY "active_users_can_insert_prospect_candidates"
    ON prospect_candidates FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- prospect_candidates: actualizar (incluye revisión/aprobación)
CREATE POLICY "active_users_can_update_prospect_candidates"
    ON prospect_candidates FOR UPDATE
    TO authenticated
    USING  (has_active_access(auth.uid()))
    WITH CHECK (has_active_access(auth.uid()));

-- prospect_candidate_audit: lectura
CREATE POLICY "active_users_can_read_prospect_candidate_audit"
    ON prospect_candidate_audit FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- prospect_candidate_audit: insertar
CREATE POLICY "active_users_can_insert_prospect_candidate_audit"
    ON prospect_candidate_audit FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- ── 7. Comentarios de tabla ───────────────────────────────────

COMMENT ON TABLE prospect_batches IS
    'Lotes de candidatos generados por el Agente 1 o creados manualmente. Prerequisito de revisión antes de crear cuentas definitivas.';

COMMENT ON TABLE prospect_candidates IS
    'Empresa candidata dentro de un lote. Debe ser aprobada antes de convertirse en account.';

COMMENT ON TABLE prospect_candidate_audit IS
    'Registro de auditoría de acciones sobre lotes y candidatos.';
