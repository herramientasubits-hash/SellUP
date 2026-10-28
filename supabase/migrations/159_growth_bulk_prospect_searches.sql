-- ============================================================
-- Migration 159: búsquedas masivas de Growth (hasta 25 · 50 · 100 · 200 empresas)
-- ============================================================
-- GROWTH-BULK-SEARCH-1.
--
-- Growth pide «hasta N» empresas en una búsqueda con IA. Una corrida del
-- asistente entrega entre 5 y 10 y tiene 300 s, así que una búsqueda masiva es
-- un registro PADRE que agrupa N rondas, y cada ronda es una corrida normal del
-- asistente, con su propio lote (`prospect_batches`). El Process Center pide la
-- siguiente ronda mientras quien la lanzó tenga SellUp abierto: si lo cierra se
-- pausa y se retoma al volver. No hay cron.
--
-- 🔴 NO crea presupuesto ni autoriza gasto por sí misma. `credit_cap` es el tope
-- que calcula el SERVIDOR y que Growth confirma antes de arrancar; cada ronda
-- sigue pasando por los mismos topes de una corrida normal (reserva del piloto,
-- cupo del proveedor, presupuesto del mes) y la búsqueda se detiene antes de
-- lanzar una ronda cuyo peor caso no quepa en lo que queda del tope.
--
-- 🔴 NO escribe en las tablas de lotes ni de candidatas: sólo referencia el lote
-- de cada ronda (`prospect_batches`).
-- Sin teléfonos, contactos ni HubSpot.
--
-- AUTORADA y NO APLICADA: la aplica el pipeline al mergear.
-- ============================================================

CREATE TABLE IF NOT EXISTS prospect_bulk_searches (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by                 UUID        NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
    status                     TEXT        NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'paused', 'completed', 'exhausted', 'budget_capped', 'cancelled', 'failed')),
    -- Por qué terminó (o se pausó), en palabras del servidor.
    stop_reason                TEXT        NULL,
    -- «Hasta N»: sólo las cuatro opciones que ofrece la pantalla.
    target_count               INTEGER     NOT NULL CHECK (target_count IN (25, 50, 100, 200)),
    -- Los criterios normalizados de la búsqueda. NUNCA los envía el cliente tal
    -- cual: los escribe el servidor al crearla y los lee al lanzar cada ronda.
    request                    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- El tope que calculó el SERVIDOR (no el número del cliente) y su desglose.
    credit_cap                 NUMERIC     NOT NULL CHECK (credit_cap >= 0),
    credit_cap_breakdown       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    credits_used               NUMERIC     NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
    delivered_count            INTEGER     NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
    rounds_done                INTEGER     NOT NULL DEFAULT 0 CHECK (rounds_done >= 0),
    max_rounds                 INTEGER     NOT NULL CHECK (max_rounds > 0),
    consecutive_empty_rounds   INTEGER     NOT NULL DEFAULT 0,
    consecutive_failed_rounds  INTEGER     NOT NULL DEFAULT 0,
    -- LEASE: una sola pestaña conduce la búsqueda a la vez. Todo cierre exige el
    -- token con el que se reclamó, así que el de una pestaña vieja no pisa nada.
    lease_token                UUID        NULL,
    lease_expires_at           TIMESTAMPTZ NULL,
    last_round_at              TIMESTAMPTZ NULL,
    completed_at               TIMESTAMPTZ NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una sola búsqueda masiva VIVA por persona: dos a la vez se pisarían los
-- cupos de corrida y el presupuesto.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_bulk_searches_one_live_per_user
    ON prospect_bulk_searches (created_by)
    WHERE status IN ('running', 'paused');

CREATE INDEX IF NOT EXISTS idx_prospect_bulk_searches_created_by
    ON prospect_bulk_searches (created_by, created_at DESC);

DROP TRIGGER IF EXISTS prospect_bulk_searches_set_updated_at ON prospect_bulk_searches;
CREATE TRIGGER prospect_bulk_searches_set_updated_at
    BEFORE UPDATE ON prospect_bulk_searches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS prospect_bulk_search_rounds (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    bulk_search_id     UUID        NOT NULL REFERENCES prospect_bulk_searches(id) ON DELETE CASCADE,
    round_index        INTEGER     NOT NULL CHECK (round_index >= 0),
    -- La identidad de la corrida del asistente. La genera el servidor; con ella se
    -- encuentra el lote de una ronda que murió antes de anotarlo.
    client_request_id  UUID        NOT NULL UNIQUE,
    batch_id           UUID        NULL REFERENCES prospect_batches(id) ON DELETE SET NULL,
    status             TEXT        NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
    delivered_new      INTEGER     NOT NULL DEFAULT 0 CHECK (delivered_new >= 0),
    credits_used       NUMERIC     NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
    outcome_code       TEXT        NULL,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ NULL,
    UNIQUE (bulk_search_id, round_index)
);

CREATE INDEX IF NOT EXISTS idx_prospect_bulk_search_rounds_batch
    ON prospect_bulk_search_rounds (batch_id);

-- ============================================================
-- PERMISOS: sólo el servidor toca estas tablas
-- ============================================================
-- RLS activo SIN política alguna para `authenticated`/`anon`. `request` lleva
-- los criterios de la búsqueda y `credit_cap` el gasto autorizado: ningún
-- cliente los lee ni los escribe. Las rutas usan el `service_role` y filtran
-- siempre por `created_by` = quien está en sesión.
ALTER TABLE prospect_bulk_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_bulk_searches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE prospect_bulk_searches FROM PUBLIC;
REVOKE ALL ON TABLE prospect_bulk_searches FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE prospect_bulk_searches TO service_role;

ALTER TABLE prospect_bulk_search_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_bulk_search_rounds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE prospect_bulk_search_rounds FROM PUBLIC;
REVOKE ALL ON TABLE prospect_bulk_search_rounds FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE prospect_bulk_search_rounds TO service_role;

-- ============================================================
-- RPC: claim_prospect_bulk_search
-- ============================================================
-- Reclamo atómico de la búsqueda para lanzar UNA ronda. Sólo la toma si sigue
-- `running`, es de quien la pide y nadie más tiene un lease vigente (o el que
-- había caducó: su pestaña se cerró o su función murió). Token NUEVO en cada
-- reclamo: el del dueño anterior queda inservible.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_prospect_bulk_search(
    p_bulk_search_id UUID,
    p_user_id UUID,
    p_lease_seconds INTEGER
)
RETURNS TABLE (
    id UUID,
    status TEXT,
    target_count INTEGER,
    request JSONB,
    credit_cap NUMERIC,
    credit_cap_breakdown JSONB,
    credits_used NUMERIC,
    delivered_count INTEGER,
    rounds_done INTEGER,
    max_rounds INTEGER,
    consecutive_empty_rounds INTEGER,
    consecutive_failed_rounds INTEGER,
    lease_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH target AS (
        SELECT s.id
        FROM prospect_bulk_searches s
        WHERE s.id = p_bulk_search_id
          AND s.created_by = p_user_id
          AND s.status = 'running'
          AND (s.lease_expires_at IS NULL OR s.lease_expires_at < now())
        FOR UPDATE SKIP LOCKED
    )
    UPDATE prospect_bulk_searches s
    SET lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    FROM target
    WHERE s.id = target.id
    RETURNING s.id, s.status, s.target_count, s.request, s.credit_cap, s.credit_cap_breakdown,
              s.credits_used, s.delivered_count, s.rounds_done, s.max_rounds,
              s.consecutive_empty_rounds, s.consecutive_failed_rounds, s.lease_token;
END;
$$;

-- `CREATE FUNCTION` concede EXECUTE a PUBLIC por defecto. Sin esto, cualquier
-- rol autenticado podría tomar el lease de una búsqueda ajena.
REVOKE ALL ON FUNCTION claim_prospect_bulk_search(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_prospect_bulk_search(UUID, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_prospect_bulk_search(UUID, UUID, INTEGER) TO service_role;

COMMENT ON TABLE prospect_bulk_searches IS
    'Búsquedas masivas de Growth: «hasta N» empresas en rondas de corridas normales del asistente. Sólo el service_role la toca. El tope de créditos lo calcula el servidor; no autoriza gasto fuera de los topes de cada corrida.';
COMMENT ON TABLE prospect_bulk_search_rounds IS
    'Cada ronda de una búsqueda masiva: una corrida normal del asistente con su propio lote. Sólo el service_role la toca.';
