-- ═══════════════════════════════════════════════════════════════════
-- 151 — claim_enrichment_jobs: sólo service_role, search_path fijo y
--       recuperación de trabajos muertos «en proceso»
-- (AGENT1-AUDIT-WS1)
-- ═══════════════════════════════════════════════════════════════════
--
-- 🔴 NO APLICADA en Producción al escribirla. Aplicarla exige autorización
-- explícita de la dueña (protocolo § 12).
--
-- POR QUÉ
--
-- La función de la migración 055 tenía tres defectos:
--
--   1. SECURITY DEFINER sin `SET search_path`: corre con los privilegios de su
--      dueño y resuelve nombres con el search_path de quien llama.
--   2. Sin REVOKE: `CREATE FUNCTION` concede EXECUTE a PUBLIC, así que con la
--      clave pública (anon) cualquiera podía reclamar trabajos y dejarlos «en
--      proceso» — la cola de enriquecimiento quedaba bloqueada desde fuera.
--   3. Sólo reclamaba `pending`: un trabajo cuya función moría a mitad (corte
--      por tiempo de Vercel) se quedaba `processing` para siempre. Nadie lo
--      volvía a tomar y el candidato no se enriquecía nunca.
--
-- QUÉ HACE
--
--   1. CREATE OR REPLACE con la MISMA firma y el MISMO RETURNS TABLE (el
--      worker no cambia), `SET search_path = public, pg_temp`.
--   2. Un trabajo `processing` cuyo bloqueo (`locked_at`) venció hace más de
--      `p_lock_duration_minutes` vuelve a ser reclamable si le quedan intentos.
--      Si ya no le quedan, se cierra `failed` con `max_attempts_exceeded` en
--      lugar de quedarse colgado. El plazo del bloqueo (5 min por defecto) es
--      mayor que la vida máxima de la función (300 s): quien lo tenía ya murió.
--   3. REVOKE de PUBLIC, anon y authenticated; EXECUTE sólo a service_role. La
--      app sólo la llama con el cliente de servicio (`enrichment-worker.ts`).
--
-- QUÉ NO CAMBIA
--
--   * La tabla, sus políticas, el orden (prioridad, antigüedad) y el reclamo
--     atómico con FOR UPDATE SKIP LOCKED.
--   * Ninguna fila se borra.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_enrichment_jobs(
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
SET search_path = public, pg_temp
AS $$
DECLARE
    -- Plazo mínimo de un minuto: un 0 o un NULL no pueden convertir en
    -- «muerto» un trabajo que se acaba de tomar.
    v_lock_cutoff TIMESTAMPTZ :=
        now() - make_interval(mins => GREATEST(COALESCE(p_lock_duration_minutes, 5), 1));
BEGIN
    -- 1. Muertos sin intentos: se cierran en vez de quedarse «en proceso».
    WITH exhausted AS (
        SELECT j.id
        FROM public.prospect_enrichment_jobs j
        WHERE j.status = 'processing'
          AND j.locked_at IS NOT NULL
          AND j.locked_at < v_lock_cutoff
          AND j.attempts >= j.max_attempts
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.prospect_enrichment_jobs j
    SET status = 'failed',
        error_code = 'max_attempts_exceeded',
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL
    FROM exhausted
    WHERE j.id = exhausted.id;

    -- 2. Reclamo: pendientes con su espera vencida, o muertos con intentos.
    RETURN QUERY
    WITH target_jobs AS (
        SELECT j.id
        FROM public.prospect_enrichment_jobs j
        WHERE (
                j.status = 'pending'
            AND j.next_retry_at <= now()
            AND (j.locked_at IS NULL OR j.locked_at < v_lock_cutoff)
        ) OR (
                j.status = 'processing'
            AND j.locked_at IS NOT NULL
            AND j.locked_at < v_lock_cutoff
            AND j.attempts < j.max_attempts
        )
        ORDER BY j.priority DESC, j.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.prospect_enrichment_jobs j
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

-- `CREATE FUNCTION` concede EXECUTE a PUBLIC por defecto, y CREATE OR REPLACE
-- conserva los permisos que ya tenía. Hay que quitarlos explícitamente.
REVOKE ALL ON FUNCTION public.claim_enrichment_jobs(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_enrichment_jobs(TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_enrichment_jobs(TEXT, INTEGER, INTEGER) IS
    'Reclama de forma atómica trabajos de enriquecimiento (pendientes o muertos en proceso con intentos). Sólo service_role. Migración 151.';
