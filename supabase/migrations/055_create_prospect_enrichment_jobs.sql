-- ============================================================
-- Migration 055: Creación de trabajos de enriquecimiento de prospectos
-- ============================================================
-- Esta tabla permite representar de forma duradera la cola de
-- enriquecimiento incremental automático de prospectos en el backend.
-- ============================================================

CREATE TABLE IF NOT EXISTS prospect_enrichment_jobs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id        UUID        NOT NULL REFERENCES prospect_candidates(id) ON DELETE CASCADE,
    import_source       TEXT        NULL,
    user_id             UUID        NULL REFERENCES internal_users(id) ON DELETE SET NULL,
    execution_type      TEXT        NOT NULL DEFAULT 'automatic_post_import_enrichment',
    priority            INTEGER     NOT NULL DEFAULT 0,
    status              TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
    attempts            INTEGER     NOT NULL DEFAULT 0,
    max_attempts        INTEGER     NOT NULL DEFAULT 3,
    locked_at           TIMESTAMPTZ NULL,
    locked_by           TEXT        NULL,
    started_at          TIMESTAMPTZ NULL,
    completed_at        TIMESTAMPTZ NULL,
    next_retry_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_code          TEXT        NULL,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garantizar que un candidato tenga máximo un trabajo de enriquecimiento en la base de datos
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_enrichment_jobs_uniq_candidate 
    ON prospect_enrichment_jobs (candidate_id);

-- Índices adicionales para rendimiento de consultas del worker y UI
CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_jobs_status 
    ON prospect_enrichment_jobs (status);

CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_jobs_next_retry 
    ON prospect_enrichment_jobs (next_retry_at) 
    WHERE status = 'pending';

-- Trigger de updated_at para actualizar automáticamente la columna updated_at
DROP TRIGGER IF EXISTS prospect_enrichment_jobs_set_updated_at ON prospect_enrichment_jobs;
CREATE TRIGGER prospect_enrichment_jobs_set_updated_at
    BEFORE UPDATE ON prospect_enrichment_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Habilitar Row Level Security (RLS)
ALTER TABLE prospect_enrichment_jobs ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para lectura y operaciones por parte de usuarios activos
CREATE POLICY "active_users_can_read_prospect_enrichment_jobs"
    ON prospect_enrichment_jobs FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_insert_prospect_enrichment_jobs"
    ON prospect_enrichment_jobs FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_update_prospect_enrichment_jobs"
    ON prospect_enrichment_jobs FOR UPDATE
    TO authenticated
    USING (has_active_access(auth.uid()))
    WITH CHECK (has_active_access(auth.uid()));

-- ============================================================
-- RPC: claim_enrichment_jobs
-- ============================================================
-- Reclama de forma atómica N trabajos pendientes para su procesamiento.
-- Evita condiciones de carrera utilizando FOR UPDATE SKIP LOCKED.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_enrichment_jobs(
    p_worker_id TEXT,
    p_limit INTEGER,
    p_lock_duration_minutes INTEGER
)
RETURNS TABLE (
    id UUID,
    candidate_id UUID,
    import_source TEXT,
    user_id UUID,
    execution_type TEXT,
    priority INTEGER,
    status TEXT,
    attempts INTEGER,
    max_attempts INTEGER,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    error_code TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH target_jobs AS (
        SELECT j.id
        FROM prospect_enrichment_jobs j
        WHERE j.status = 'pending'
          AND j.next_retry_at <= now()
          AND (j.locked_at IS NULL OR j.locked_at < now() - (p_lock_duration_minutes || ' minutes')::interval)
        ORDER BY j.priority DESC, j.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE prospect_enrichment_jobs j
    SET status = 'processing',
        locked_at = now(),
        locked_by = p_worker_id,
        started_at = now(),
        attempts = j.attempts + 1
    FROM target_jobs
    WHERE j.id = target_jobs.id
    RETURNING j.id, j.candidate_id, j.import_source, j.user_id, j.execution_type, j.priority, j.status, j.attempts, j.max_attempts, j.locked_at, j.locked_by, j.started_at, j.completed_at, j.next_retry_at, j.error_code, j.metadata, j.created_at, j.updated_at;
END;
$$;

COMMENT ON TABLE prospect_enrichment_jobs IS
    'Cola persistente de trabajos de enriquecimiento de candidatos de prospectos.';
