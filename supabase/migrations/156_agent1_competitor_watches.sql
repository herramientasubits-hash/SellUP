-- ═══════════════════════════════════════════════════════════════════
-- 156 — AGENT1-COMPETITOR-WATCH-1
-- «Seguir esta referencia» en «Competidores de una empresa»
-- ═══════════════════════════════════════════════════════════════════
--
-- WHY
--
-- Auditoría del 21-10 (Fase D): una vendedora que buscó los competidores de una
-- empresa no se entera de las competidoras que el equipo encuentra después, y
-- nadie le recuerda volver a buscar. Decisión de la dueña (21-10): guardar qué
-- referencias sigue cada vendedor y avisarle una vez por semana en la campana.
--
-- WHAT THIS TABLE IS
--
-- One row per (seller, reference). The weekly digest (Monday, inside the existing
-- Agent 1 daily cron, behind ENABLE_AGENT1_COMPETITOR_WATCH, OFF by default) reads it,
-- counts competitor candidates added for that reference since `last_notified_at`, and
-- inserts ONE `user_notifications` row per seller. It never runs a search, never
-- spends Claude or Apollo credits and never writes HubSpot: «Buscar de nuevo» is a
-- click by the seller.
--
-- ACCESS
--
-- Server only (service_role): the server actions resolve the internal user and
-- filter by it, like `user_notifications` inserts. No authenticated policy.
--
-- NOT TOUCHED: budgets, credits, reservations, prospect tables, HubSpot.

CREATE TABLE IF NOT EXISTS agent1_competitor_watches (
    id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_user_id            UUID         NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
    -- `domain:<dominio>` or `name:<nombre en minúsculas>`: one row per seller and reference.
    reference_key               TEXT         NOT NULL CHECK (char_length(reference_key) BETWEEN 3 AND 300),
    reference_name              TEXT         NOT NULL CHECK (char_length(reference_name) BETWEEN 1 AND 120),
    reference_domain            TEXT         CHECK (reference_domain IS NULL OR char_length(reference_domain) <= 253),
    -- The batch the seller followed from (to rebuild «Buscar de nuevo»: country, industry, catalog).
    source_batch_id             UUID         REFERENCES prospect_batches(id) ON DELETE SET NULL,
    last_notified_at            TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (internal_user_id, reference_key)
);

CREATE INDEX IF NOT EXISTS idx_agent1_competitor_watches_user
    ON agent1_competitor_watches(internal_user_id);

ALTER TABLE agent1_competitor_watches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'agent1_competitor_watches' AND policyname = 'service_role_all_agent1_competitor_watches'
    ) THEN
        CREATE POLICY service_role_all_agent1_competitor_watches
            ON agent1_competitor_watches
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END
$$;

COMMENT ON TABLE agent1_competitor_watches IS
    'AGENT1-COMPETITOR-WATCH-1 (156): referencias que cada vendedor sigue en «Competidores de una empresa». Sólo servidor. El resumen semanal nunca busca ni gasta.';
