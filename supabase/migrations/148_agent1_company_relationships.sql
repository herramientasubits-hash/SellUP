-- ═══════════════════════════════════════════════════════════════════
-- 148 — Asociaciones entre empresas (búsqueda en árbol del Agente 1)
-- (AGENT1-CORPORATE-TREE-1, fase 1; decisión de la dueña el 14-10)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- Desde una empresa, el agente busca su grupo y matriz, sus filiales y la
-- misma empresa en otros países. Las empresas encontradas entran a «Por
-- revisar» como cualquier búsqueda, pero la RELACIÓN entre ellas no tenía
-- dónde vivir: la metadata del candidato se pierde de vista al aprobar y no
-- deja ver el árbol desde la otra punta (la matriz no sabe de sus filiales).
--
-- QUÉ HACE
--
--   1. Tabla agent1_company_relationships: una fila por empresa del árbol,
--      enlazada a la empresa de partida (candidato o cuenta) y, si entró al
--      lote, a su candidato. Guarda también las que ya estaban en HubSpot
--      (matched_hubspot_company_id): son justo el dato útil del árbol.
--   2. Índices por lote y por cada punta (partida y relacionada).
--   3. RLS: lectura para usuarios activos (igual que prospect_candidates);
--      escritura sólo service_role (la escribe el servidor al terminar la
--      corrida).
--
-- QUÉ NO HACE
--
--   * NO toca prospect_candidates, prospect_batches, reclamos globales (140),
--     presupuesto ni HubSpot. No escribe nada en HubSpot.
--   * NO cambia ninguna fila existente.
--
-- Reversible: DROP TABLE public.agent1_company_relationships (sólo pierde las
-- asociaciones; los candidatos y su metadata quedan).

CREATE TABLE IF NOT EXISTS public.agent1_company_relationships (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id                    UUID        NOT NULL
        REFERENCES public.prospect_batches(id) ON DELETE CASCADE,
    run_id                      TEXT        NOT NULL,

    root_name                   TEXT        NOT NULL,
    root_country_code           TEXT        NULL,
    root_domain                 TEXT        NULL,
    root_candidate_id           UUID        NULL
        REFERENCES public.prospect_candidates(id) ON DELETE SET NULL,
    root_account_id             UUID        NULL
        REFERENCES public.accounts(id) ON DELETE SET NULL,

    related_candidate_id        UUID        NULL
        REFERENCES public.prospect_candidates(id) ON DELETE SET NULL,
    related_name                TEXT        NOT NULL,
    related_country_code        TEXT        NULL,
    related_domain              TEXT        NULL,

    relation_type               TEXT        NOT NULL
        CONSTRAINT agent1_company_relationships_relation_type_check
        CHECK (relation_type IN ('root', 'group', 'subsidiary', 'other_country')),
    relation_detail             TEXT        NULL,
    evidence_url                TEXT        NULL,
    matched_hubspot_company_id  TEXT        NULL,

    created_by                  UUID        NULL
        REFERENCES public.internal_users(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent1_company_relationships IS
    'Árbol de empresa del Agente 1: cada fila une una empresa encontrada (grupo, filial, otro país) con la empresa de partida.';

CREATE INDEX IF NOT EXISTS idx_agent1_company_relationships_batch
    ON public.agent1_company_relationships (batch_id);
CREATE INDEX IF NOT EXISTS idx_agent1_company_relationships_root_candidate
    ON public.agent1_company_relationships (root_candidate_id)
    WHERE root_candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent1_company_relationships_root_account
    ON public.agent1_company_relationships (root_account_id)
    WHERE root_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent1_company_relationships_related_candidate
    ON public.agent1_company_relationships (related_candidate_id)
    WHERE related_candidate_id IS NOT NULL;

ALTER TABLE public.agent1_company_relationships ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent1_company_relationships'
      AND policyname = 'service_role_all_agent1_company_relationships'
  ) THEN
    CREATE POLICY "service_role_all_agent1_company_relationships"
      ON public.agent1_company_relationships FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent1_company_relationships'
      AND policyname = 'active_users_can_read_agent1_company_relationships'
  ) THEN
    CREATE POLICY "active_users_can_read_agent1_company_relationships"
      ON public.agent1_company_relationships FOR SELECT TO authenticated
      USING (has_active_access(auth.uid()));
  END IF;
END $$;
