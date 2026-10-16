-- ═══════════════════════════════════════════════════════════════════
-- 153 — Agente 3: investigación de la empresa y preparación de la primera llamada
-- (AGENT3-FIRST-CALL-1; decisión de la dueña el 16-10)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- El Agente 3 investiga una empresa (sitio oficial, noticias, listas
-- curadas, HubSpot) y con eso prepara al vendedor para la primera llamada.
-- La investigación y el guion no tenían dónde vivir: la pestaña
-- «Inteligencia» de la empresa estaba vacía y no había historial.
--
-- QUÉ HACE
--
--   1. account_research_briefs: una ficha de investigación por empresa y
--      fecha (hechos con cita, hipótesis, vacíos, estado, costo). Vigente
--      30 días (`expires_at`): otro decisor o canal no paga otra investigación.
--      Índice único parcial: una sola investigación «running» por empresa.
--   2. first_call_packs: un paquete de primera llamada por decisor y canal
--      (razón para llamar, guion, mensaje corto, preguntas, objeciones,
--      siguiente paso, cuidados), con su estado y lo que editó el vendedor.
--   3. RLS: lectura para usuarios activos (igual que accounts); escritura
--      sólo service_role (la escribe el servidor tras comprobar el alcance
--      comercial con getAccountById).
--
-- QUÉ NO HACE
--
--   * NO toca accounts, contacts, prospect_candidates, presupuesto ni HubSpot.
--   * NO cambia ninguna fila existente.
--
-- Reversible: DROP TABLE public.first_call_packs; DROP TABLE
-- public.account_research_briefs (sólo se pierden fichas y paquetes).

CREATE TABLE IF NOT EXISTS public.account_research_briefs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID        NOT NULL
        REFERENCES public.accounts(id) ON DELETE CASCADE,
    status          TEXT        NOT NULL DEFAULT 'running'
        CONSTRAINT account_research_briefs_status_check
        CHECK (status IN ('running', 'sufficient', 'partial', 'failed')),
    progress_stage  TEXT        NULL,
    summary         TEXT        NULL,
    facts           JSONB       NOT NULL DEFAULT '[]'::jsonb,
    hypotheses      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    gaps            JSONB       NOT NULL DEFAULT '[]'::jsonb,
    sources         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    rejected_facts  INTEGER     NOT NULL DEFAULT 0,
    cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
    model           TEXT        NULL,
    agent_version   TEXT        NOT NULL,
    error_code      TEXT        NULL,
    created_by      UUID        NULL
        REFERENCES public.internal_users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ NULL,
    expires_at      TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.account_research_briefs IS
    'Agente 3: ficha de investigación de una empresa para la primera llamada (hechos con cita verificada, hipótesis y vacíos).';

CREATE INDEX IF NOT EXISTS idx_account_research_briefs_account
    ON public.account_research_briefs (account_id, created_at DESC);

-- Una sola investigación en curso por empresa: dos clics a la vez no pagan dos
-- investigaciones (el segundo INSERT choca con 23505 y el servidor lo dice).
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_research_briefs_one_running
    ON public.account_research_briefs (account_id)
    WHERE status = 'running';

CREATE TABLE IF NOT EXISTS public.first_call_packs (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            UUID        NOT NULL
        REFERENCES public.accounts(id) ON DELETE CASCADE,
    brief_id              UUID        NULL
        REFERENCES public.account_research_briefs(id) ON DELETE SET NULL,
    contact_id            UUID        NULL
        REFERENCES public.contacts(id) ON DELETE SET NULL,
    target_name           TEXT        NULL,
    target_title          TEXT        NULL,
    channel               TEXT        NOT NULL
        CONSTRAINT first_call_packs_channel_check
        CHECK (channel IN ('call', 'whatsapp', 'email', 'linkedin')),
    goal                  TEXT        NOT NULL,
    product_focus         TEXT        NULL,
    pack                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status                TEXT        NOT NULL DEFAULT 'draft'
        CONSTRAINT first_call_packs_status_check
        CHECK (status IN ('draft', 'needs_review', 'used', 'discarded', 'failed')),
    verifier_issues       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    edited_script         TEXT        NULL,
    regenerated_from_id   UUID        NULL
        REFERENCES public.first_call_packs(id) ON DELETE SET NULL,
    regeneration_reason   TEXT        NULL,
    cost_usd              NUMERIC(12,6) NOT NULL DEFAULT 0,
    model                 TEXT        NULL,
    agent_version         TEXT        NOT NULL,
    error_code            TEXT        NULL,
    created_by            UUID        NULL
        REFERENCES public.internal_users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at               TIMESTAMPTZ NULL,
    discarded_at          TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.first_call_packs IS
    'Agente 3: paquete de primera llamada por decisor y canal (guion, mensaje corto, preguntas, objeciones, cuidados).';

CREATE INDEX IF NOT EXISTS idx_first_call_packs_account
    ON public.first_call_packs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_first_call_packs_contact
    ON public.first_call_packs (contact_id)
    WHERE contact_id IS NOT NULL;

ALTER TABLE public.account_research_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.first_call_packs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_research_briefs'
      AND policyname = 'service_role_all_account_research_briefs'
  ) THEN
    CREATE POLICY "service_role_all_account_research_briefs"
      ON public.account_research_briefs FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_research_briefs'
      AND policyname = 'active_users_can_read_account_research_briefs'
  ) THEN
    CREATE POLICY "active_users_can_read_account_research_briefs"
      ON public.account_research_briefs FOR SELECT TO authenticated
      USING (has_active_access(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'first_call_packs'
      AND policyname = 'service_role_all_first_call_packs'
  ) THEN
    CREATE POLICY "service_role_all_first_call_packs"
      ON public.first_call_packs FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'first_call_packs'
      AND policyname = 'active_users_can_read_first_call_packs'
  ) THEN
    CREATE POLICY "active_users_can_read_first_call_packs"
      ON public.first_call_packs FOR SELECT TO authenticated
      USING (has_active_access(auth.uid()));
  END IF;
END $$;
