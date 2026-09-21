-- ============================================================
-- Migration 139: cola durable de CONTINUACIÓN de rondas de Apollo
-- ============================================================
-- AGENT1-APOLLO-ROUND-EXECUTION-TIME-BUDGET § 7.
--
-- El problema que resuelve: una corrida de dos rondas puede quedarse sin tiempo
-- de ejecución con organizaciones YA PAGADAS todavía sin evaluar. El checkpoint
-- las conserva en `pending_organizations`, pero guardar no es retomar: sin una
-- cola durable nadie las recoge, y el trabajo se queda esperando para siempre.
--
-- Espeja deliberadamente `prospect_enrichment_jobs` (migración 055): mismo
-- vocabulario de estados, mismo reclamo atómico con FOR UPDATE SKIP LOCKED,
-- mismo patrón de reintento con `next_retry_at`. No se inventa una segunda
-- forma de tener una cola en este repo.
--
-- 🔴 NO crea presupuesto, NO autoriza gasto y NO compra páginas: una
-- continuación sólo reanuda trabajo GRATUITO (evaluación barata) sobre una
-- búsqueda que ya se pagó y que el ledger de operaciones marca como completada.
-- ============================================================

CREATE TABLE IF NOT EXISTS apollo_round_continuation_jobs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID        NOT NULL REFERENCES prospect_batches(id) ON DELETE CASCADE,
    -- Identidad de la corrida. Una continuación que no coincide pertenece a OTRO
    -- trabajo, y reanudarla saltaría operaciones que nunca se hicieron.
    wizard_run_id       TEXT        NOT NULL,
    idempotency_key     TEXT        NOT NULL,
    request_fingerprint TEXT        NOT NULL,
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

-- Un lote no puede tener dos continuaciones VIVAS a la vez: dos trabajadores
-- reanudando la misma corrida duplicarían candidatas y recuentos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_apollo_round_continuation_jobs_uniq_live
    ON apollo_round_continuation_jobs (batch_id)
    WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_apollo_round_continuation_jobs_next_retry
    ON apollo_round_continuation_jobs (next_retry_at)
    WHERE status = 'pending';

DROP TRIGGER IF EXISTS apollo_round_continuation_jobs_set_updated_at ON apollo_round_continuation_jobs;
CREATE TRIGGER apollo_round_continuation_jobs_set_updated_at
    BEFORE UPDATE ON apollo_round_continuation_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE apollo_round_continuation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active_users_can_read_apollo_round_continuation_jobs"
    ON apollo_round_continuation_jobs FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- ============================================================
-- RPC: claim_apollo_round_continuation_jobs
-- ============================================================
-- Reclamo atómico, idéntico en forma al de la migración 055.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_apollo_round_continuation_jobs(
    p_worker_id TEXT,
    p_limit INTEGER,
    p_lock_duration_minutes INTEGER
)
RETURNS TABLE (
    id UUID,
    batch_id UUID,
    wizard_run_id TEXT,
    idempotency_key TEXT,
    request_fingerprint TEXT,
    status TEXT,
    attempts INTEGER,
    max_attempts INTEGER,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH target_jobs AS (
        SELECT j.id
        FROM apollo_round_continuation_jobs j
        WHERE j.status = 'pending'
          AND j.next_retry_at <= now()
          AND (j.locked_at IS NULL OR j.locked_at < now() - (p_lock_duration_minutes || ' minutes')::interval)
        ORDER BY j.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE apollo_round_continuation_jobs j
    SET status = 'processing',
        locked_at = now(),
        locked_by = p_worker_id,
        started_at = now(),
        attempts = j.attempts + 1
    FROM target_jobs
    WHERE j.id = target_jobs.id
    RETURNING j.id, j.batch_id, j.wizard_run_id, j.idempotency_key, j.request_fingerprint,
              j.status, j.attempts, j.max_attempts, j.metadata;
END;
$$;

COMMENT ON TABLE apollo_round_continuation_jobs IS
    'Cola durable de continuaciones de rondas de Apollo que se quedaron sin tiempo de ejecución. Sólo reanuda trabajo gratuito sobre búsquedas ya pagadas.';
