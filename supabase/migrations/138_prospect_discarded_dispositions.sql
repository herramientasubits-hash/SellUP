-- ============================================================
-- Migration 138: Disposiciones descartadas de prospectos
-- (AGENT1-DISCARDED-PROSPECTS-REVIEW-1)
-- ============================================================
--
-- QUÉ RESUELVE
-- ────────────
-- Issue #389: hoy una empresa que el pipeline descarta automáticamente
-- (país, sector/subindustria, dominio no acreditado, ya existente en
-- HubSpot/SellUp, límite de enriquecimiento alcanzado, etc.) NUNCA llega a
-- tener una fila en `prospect_candidates` — el gate barato la descarta ANTES
-- de crear el candidato. La única huella que sobrevive es un conteo agregado
-- en `prospect_batches.metadata.candidate_final_dispositions`
-- (`toCandidateFinalDispositionsMetadata`, deliberadamente sin nombres ni
-- dominios). Una empresa descartada así es irrecuperable hoy: no se puede ver,
-- no se puede auditar y no se puede enviar a revisión manual.
--
-- Esta migración crea `prospect_discarded_dispositions`: una fila persistente
-- por empresa/disposición, con la evidencia disponible ANTES de la decisión
-- (nombre, dominio, país/industria de la búsqueda, motivo, evidencia cruda),
-- para que la pestaña "Descartadas" pueda listarla y "Enviar a revisión" pueda
-- promoverla a `prospect_candidates` (status `needs_review`) SIN volver a
-- llamar a Apollo/Lusha/Tavily/HubSpot y SIN consumir presupuesto.
--
-- QUÉ NO TOCA
-- ───────────
-- No modifica `prospect_candidates`, `prospect_batches` ni ninguna tabla de
-- presupuesto/billing (`wizard_monthly_budget_periods`, créditos, cuotas de
-- proveedor). No cambia RLS de ninguna tabla existente. La única tabla
-- existente que toca es `prospect_candidate_audit`, y sólo para ENSANCHAR
-- (no estrechar) su CHECK de `action_type` con un valor nuevo
-- (`candidate_sent_to_review`) — mismo patrón aditivo que 052/048/051.
--
-- IDEMPOTENCIA
-- ────────────
-- `UNIQUE (batch_id, source_key)` es la clave de idempotencia: la misma
-- empresa descartada dos veces en la misma corrida (mismo dominio
-- normalizado, o mismo provider_organization_id, o mismo nombre canónico
-- cuando ninguno de los dos existe) colapsa a UNA fila vía UPSERT
-- (`ON CONFLICT (batch_id, source_key) DO UPDATE`), nunca duplica.
-- ============================================================

-- ── 1. Tabla prospect_discarded_dispositions ──────────────────

CREATE TABLE IF NOT EXISTS prospect_discarded_dispositions (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id                UUID        NOT NULL REFERENCES prospect_batches(id) ON DELETE CASCADE,
    -- No NULL cuando la disposición ya tiene una fila real en
    -- prospect_candidates (p. ej. un descarte manual ya existente que se
    -- quiere mostrar en "Descartadas" con el mismo modelo unificado).
    candidate_id            UUID        NULL REFERENCES prospect_candidates(id) ON DELETE SET NULL,
    -- Identificador del proveedor cuando existe (p. ej. Apollo organization id).
    provider_identifier     TEXT        NULL,
    -- Clave de idempotencia: dominio normalizado > provider_identifier >
    -- nombre canónico normalizado, en ese orden de preferencia (ver
    -- `computeDiscardDispositionSourceKey` en el módulo TS).
    source_key              TEXT        NOT NULL,
    name                    TEXT        NOT NULL,
    domain                  TEXT        NULL,
    country_code            TEXT        NULL,
    industry                TEXT        NULL,
    source_primary          TEXT        NULL
        CHECK (source_primary IN (
            'manual', 'hubspot', 'apollo', 'lusha', 'tavily',
            'public_source', 'preloaded', 'web_ai', 'other', NULL
        )),
    -- Ronda/origen de búsqueda dentro de la corrida (p. ej. "round_1").
    round_origin            TEXT        NULL,
    disposition             TEXT        NOT NULL
        CHECK (disposition IN (
            'country_rejected',
            'sector_rejected',
            'ownership_domain_rejected',
            'hubspot_duplicate',
            'sellup_duplicate',
            'cooldown_active',
            'enrichment_budget_exhausted',
            'not_selected_for_enrichment',
            'target_cap_reached',
            'final_validation_rejected',
            'manual_discard',
            'other'
        )),
    -- Código interno crudo (p. ej. el CheapRejectionReason/EnrichmentSkippedReason
    -- original) — trazabilidad hacia el vocabulario de origen sin reinterpretarlo.
    reason_code              TEXT        NULL,
    reason_detail            TEXT        NULL,
    -- Evidencia/metadata disponible ANTES de la decisión. Nunca se llena
    -- volviendo a consultar un proveedor.
    evidence                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status                   TEXT        NOT NULL DEFAULT 'discarded'
        CHECK (status IN ('discarded', 'sent_to_review')),
    -- Candidato resultante de "Enviar a revisión" (nuevo o el mismo candidate_id
    -- si ya existía). NULL mientras status = 'discarded'.
    resulting_candidate_id   UUID        NULL REFERENCES prospect_candidates(id) ON DELETE SET NULL,
    sent_to_review_by        UUID        NULL REFERENCES internal_users(id),
    sent_to_review_at        TIMESTAMPTZ NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT prospect_discarded_dispositions_batch_source_key_unique
        UNIQUE (batch_id, source_key)
);

-- ── 2. Índices ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_prospect_discarded_dispositions_batch_id
    ON prospect_discarded_dispositions (batch_id);
CREATE INDEX IF NOT EXISTS idx_prospect_discarded_dispositions_status
    ON prospect_discarded_dispositions (status);
CREATE INDEX IF NOT EXISTS idx_prospect_discarded_dispositions_disposition
    ON prospect_discarded_dispositions (disposition);
CREATE INDEX IF NOT EXISTS idx_prospect_discarded_dispositions_candidate_id
    ON prospect_discarded_dispositions (candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_discarded_dispositions_created_at
    ON prospect_discarded_dispositions (created_at DESC);

-- ── 3. Trigger updated_at ───────────────────────────────────

DROP TRIGGER IF EXISTS prospect_discarded_dispositions_set_updated_at
    ON prospect_discarded_dispositions;
CREATE TRIGGER prospect_discarded_dispositions_set_updated_at
    BEFORE UPDATE ON prospect_discarded_dispositions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. RLS ──────────────────────────────────────────────────
-- Mismo patrón que prospect_candidates/prospect_candidate_audit (040): RLS es
-- una capa secundaria. La visibilidad real por commercial scope se aplica en
-- la capa de aplicación (resolveAllowedBatchIds sobre prospect_batches), igual
-- que el resto del módulo prospect-batches.

ALTER TABLE prospect_discarded_dispositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active_users_can_read_prospect_discarded_dispositions"
    ON prospect_discarded_dispositions FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_insert_prospect_discarded_dispositions"
    ON prospect_discarded_dispositions FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_update_prospect_discarded_dispositions"
    ON prospect_discarded_dispositions FOR UPDATE
    TO authenticated
    USING  (has_active_access(auth.uid()))
    WITH CHECK (has_active_access(auth.uid()));

-- ── 5. Comentarios ──────────────────────────────────────────

COMMENT ON TABLE prospect_discarded_dispositions IS
    'Disposición persistente de una empresa descartada automáticamente por el pipeline (país/sector/dominio/duplicado/presupuesto de enriquecimiento) o marcada para revisión manual, con la evidencia disponible antes de la decisión. Fuente de verdad de la pestaña "Descartadas" de Prospectos (issue #389).';

COMMENT ON COLUMN prospect_discarded_dispositions.source_key IS
    'Clave de idempotencia dentro del batch: dominio normalizado > provider_identifier > nombre canónico normalizado. UNIQUE (batch_id, source_key) evita duplicar la misma empresa descartada dos veces en la misma corrida.';

COMMENT ON COLUMN prospect_discarded_dispositions.candidate_id IS
    'Fila existente en prospect_candidates cuando la disposición corresponde a un descarte manual ya persistido (status=discarded). NULL cuando el pipeline descartó la empresa ANTES de crear ninguna fila de candidato.';

COMMENT ON COLUMN prospect_discarded_dispositions.resulting_candidate_id IS
    'Candidato needs_review resultante de "Enviar a revisión" (human_override). NULL mientras status=discarded.';

-- ============================================================
-- 6. Ensanchar prospect_candidate_audit.action_type (ADITIVO)
-- ============================================================
--
-- "Enviar a revisión" es una transición discarded → needs_review por
-- human_override, distinta semánticamente de 'candidate_updated'. El patrón
-- previo (markCandidateReadyForApprovalAction) reutilizó 'candidate_updated'
-- porque ensanchar este CHECK no era necesario para ese hito; aquí sí importa
-- que la auditoría nombre el override explícitamente, así que se ensancha el
-- CHECK — mismo patrón aditivo (DROP + ADD CONSTRAINT) que 052/048/051 sobre
-- prospect_candidates.source_primary.

ALTER TABLE public.prospect_candidate_audit
    DROP CONSTRAINT IF EXISTS prospect_candidate_audit_action_type_check;

ALTER TABLE public.prospect_candidate_audit
    ADD CONSTRAINT prospect_candidate_audit_action_type_check
    CHECK (action_type IN (
        'batch_created', 'batch_updated', 'batch_status_changed',
        'candidate_created', 'candidate_updated',
        'candidate_approved', 'candidate_discarded',
        'candidate_marked_duplicate', 'candidate_converted_to_account',
        'candidate_marked_ready_for_approval',
        'candidate_sent_to_review'
    ));
