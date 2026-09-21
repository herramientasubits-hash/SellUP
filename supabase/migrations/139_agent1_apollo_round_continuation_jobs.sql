-- ============================================================
-- Migration 139: cola durable de CONTINUACIÓN de rondas de Apollo
-- ============================================================
-- AGENT1-APOLLO-CONTINUATION-COMPLETES §§ 3, 6.
--
-- El problema que resuelve: una corrida de dos rondas puede quedarse sin tiempo
-- de ejecución con organizaciones YA PAGADAS todavía sin evaluar. El checkpoint
-- las conserva, pero guardar no es retomar: sin una cola durable nadie las
-- recoge y el trabajo espera para siempre.
--
-- Espeja `prospect_enrichment_jobs` (migración 055) en lo que comparte: mismo
-- vocabulario de estados y mismo reclamo atómico con FOR UPDATE SKIP LOCKED.
-- Añade lo que aquélla no tiene y aquí hace falta: LEASE con caducidad y TOKEN
-- de propiedad.
--
-- 🔴 NO crea presupuesto, NO autoriza gasto y NO compra páginas: una
-- continuación sólo reanuda trabajo sobre una búsqueda que ya se pagó y que el
-- ledger de operaciones marca como completada.
--
-- 🔴 NO APLICADA. Verificado contra Producción (`to_regclass` = null) antes de
-- corregirla, por eso se corrige EN EL SITIO en vez de encadenar una 140.
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
    -- § 3 — LEASE: quién lo tiene, con qué token y hasta cuándo.
    --
    -- `lease_token` es lo que impide que un worker ANTIGUO pise el estado del
    -- nuevo: todo cierre exige el token con el que se reclamó, así que el del
    -- worker desahuciado no encuentra fila.
    lease_token         UUID        NULL,
    lease_expires_at    TIMESTAMPTZ NULL,
    locked_by           TEXT        NULL,
    started_at          TIMESTAMPTZ NULL,
    completed_at        TIMESTAMPTZ NULL,
    next_retry_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_code          TEXT        NULL,
    -- Contexto durable de la corrida (criterios, correlación). NUNCA lo envía el
    -- cliente: lo escribe el servidor al pausar y lo lee el servidor al reanudar.
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un lote no puede tener dos continuaciones VIVAS a la vez: dos trabajadores
-- reanudando la misma corrida duplicarían candidatas y recuentos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_apollo_round_continuation_jobs_uniq_live
    ON apollo_round_continuation_jobs (batch_id)
    WHERE status IN ('pending', 'processing');

-- El reclamo barre por estos dos ejes: pendientes vencidas y leases caducados.
CREATE INDEX IF NOT EXISTS idx_apollo_round_continuation_jobs_claimable
    ON apollo_round_continuation_jobs (status, next_retry_at, lease_expires_at);

DROP TRIGGER IF EXISTS apollo_round_continuation_jobs_set_updated_at ON apollo_round_continuation_jobs;
CREATE TRIGGER apollo_round_continuation_jobs_set_updated_at
    BEFORE UPDATE ON apollo_round_continuation_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- § 6 — PERMISOS: sólo el servidor toca esta cola
-- ============================================================
-- RLS activo SIN política alguna para `authenticated`/`anon`: ningún rol de
-- cliente puede leer ni escribir. `metadata.run_input` lleva los criterios de la
-- corrida, y no hay razón para exponerlos a un cliente.
--
-- El `service_role` NO pasa por RLS, y es el único que usa el worker y la acción
-- de continuación en sesión —que primero comprueba, en servidor, que la persona
-- tenga acceso al LOTE—.
ALTER TABLE apollo_round_continuation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE apollo_round_continuation_jobs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE apollo_round_continuation_jobs FROM PUBLIC;
REVOKE ALL ON TABLE apollo_round_continuation_jobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE apollo_round_continuation_jobs TO service_role;

-- ============================================================
-- RPC: claim_apollo_round_continuation_jobs
-- ============================================================
-- § 3 — reclamo atómico que TAMBIÉN recupera trabajos interrumpidos.
--
-- 🔴 El defecto que cierra: la versión anterior filtraba `status = 'pending'`, y
-- la cláusula de lock caducado iba en AND con ella. Una fila que un worker
-- muerto dejó en `processing` no volvía a ser reclamable NUNCA, y la cláusula de
-- caducidad era código muerto. Ahora el reclamo cubre los dos casos:
--
--   · `pending` con `next_retry_at` vencido;
--   · `processing` con el LEASE caducado — su dueño murió o se colgó.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_apollo_round_continuation_jobs(
    p_worker_id TEXT,
    p_limit INTEGER,
    p_lease_seconds INTEGER,
    -- § 5 — la continuación EN SESIÓN reclama sólo el trabajo de SU lote. El
    -- cron pasa NULL y barre la cola entera. Un único camino de reclamo para
    -- los dos, así que el vallado y la recuperación son los mismos.
    p_batch_id UUID DEFAULT NULL
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
    lease_token UUID,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH target_jobs AS (
        SELECT j.id
        FROM apollo_round_continuation_jobs j
        WHERE
            (p_batch_id IS NULL OR j.batch_id = p_batch_id)
            AND (
                (j.status = 'pending' AND j.next_retry_at <= now())
                OR (j.status = 'processing' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at < now())
            )
        ORDER BY j.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE apollo_round_continuation_jobs j
    SET status = 'processing',
        -- Token NUEVO en cada reclamo: el del dueño anterior queda inservible.
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        locked_by = p_worker_id,
        started_at = now(),
        attempts = j.attempts + 1
    FROM target_jobs
    WHERE j.id = target_jobs.id
    RETURNING j.id, j.batch_id, j.wizard_run_id, j.idempotency_key, j.request_fingerprint,
              j.status, j.attempts, j.max_attempts, j.lease_token, j.metadata;
END;
$$;

-- § 6 — `CREATE FUNCTION` concede EXECUTE a PUBLIC por defecto. Sin esto,
-- cualquier rol autenticado podría reclamar trabajos y ponerlos en `processing`.
REVOKE ALL ON FUNCTION claim_apollo_round_continuation_jobs(TEXT, INTEGER, INTEGER, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_apollo_round_continuation_jobs(TEXT, INTEGER, INTEGER, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_apollo_round_continuation_jobs(TEXT, INTEGER, INTEGER, UUID) TO service_role;

COMMENT ON TABLE apollo_round_continuation_jobs IS
    'Cola durable de continuaciones de rondas de Apollo que se quedaron sin tiempo de ejecución. Sólo el service_role la toca. Reanuda trabajo sobre búsquedas ya pagadas; no autoriza gasto nuevo.';
