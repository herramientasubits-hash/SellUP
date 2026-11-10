-- 163 — Presupuesto por regla: aprobadores, recargas del mes y solicitudes de aprobación.
--
-- La dueña (10-11) pidió, para cada regla de presupuesto de un proveedor:
--   1. «Requiere aprobación» con aprobadores reales: una o varias personas que
--      reciben la solicitud, entran a aprobarla y eligen cuántos créditos le dan
--      a quien la pidió (sólo para el mes en curso).
--   2. Recargar el mes en curso de una regla: «agregar N créditos este mes».
--   3. Que lo que no se use pase al mes siguiente como reserva, acumulándose mes
--      a mes desde noviembre de 2026, en todas las reglas.
--
-- La reserva NO se guarda: la app la calcula con lo que se gastó cada mes
-- (src/modules/budgets/budget-balance.ts). Aquí sólo van los datos que no se
-- pueden deducir: quién aprueba, las recargas y las solicitudes.
--
-- Escribe sólo el servidor con la llave de servicio (mismo patrón que
-- budget_rules en la 071): ni `anon` ni `authenticated` leen ni escriben.
-- No toca filas existentes: la columna nueva nace vacía.

-- ─── 1. Aprobadores de cada regla ────────────────────────────────────────────

ALTER TABLE public.budget_rules
  ADD COLUMN IF NOT EXISTS approver_user_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.budget_rules.approver_user_ids IS
  'internal_users.id de quienes aprueban las solicitudes cuando on_exceed = require_approval.';

-- ─── 2. Solicitudes de aprobación ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_approval_requests (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id            UUID          NOT NULL REFERENCES public.budget_rules(id) ON DELETE CASCADE,
  requester_user_id  UUID          NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  -- Inicio del período de la regla en que se pidió: lo aprobado vale sólo ahí.
  period_start       TIMESTAMPTZ   NOT NULL,
  requested_credits  NUMERIC(14,4) NOT NULL
    CONSTRAINT budget_approval_requests_requested_positive CHECK (requested_credits > 0),
  status             TEXT          NOT NULL DEFAULT 'pending'
    CONSTRAINT budget_approval_requests_status_valid
      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_credits   NUMERIC(14,4) NULL
    CONSTRAINT budget_approval_requests_approved_positive CHECK (approved_credits IS NULL OR approved_credits > 0),
  decided_by         UUID          NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ   NULL,
  decision_note      TEXT          NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT budget_approval_requests_decision_coherence CHECK (
    (status = 'approved' AND approved_credits IS NOT NULL AND decided_at IS NOT NULL)
    OR (status IN ('rejected', 'cancelled') AND approved_credits IS NULL AND decided_at IS NOT NULL)
    OR (status = 'pending' AND approved_credits IS NULL AND decided_at IS NULL)
  )
);

-- Una sola solicitud abierta por persona, regla y período: chocar otra vez con
-- el límite no le llena la bandeja de solicitudes repetidas al aprobador.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_approval_requests_one_pending
  ON public.budget_approval_requests (rule_id, requester_user_id, period_start)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_budget_approval_requests_rule_period
  ON public.budget_approval_requests (rule_id, period_start);

CREATE INDEX IF NOT EXISTS idx_budget_approval_requests_requester
  ON public.budget_approval_requests (requester_user_id, created_at DESC);

ALTER TABLE public.budget_approval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.budget_approval_requests;
CREATE POLICY "service_role full access"
  ON public.budget_approval_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 3. Créditos extra de un período: recargas y aprobaciones ────────────────
--
-- `top_up`  — un administrador recargó la regla: suma para todo el pozo.
-- `grant`   — un aprobador le dio créditos a quien los pidió: suma sólo para
--             esa persona (`beneficiary_user_id`).
-- Las dos valen sólo en `period_start`; lo que sobre entra a la reserva.

CREATE TABLE IF NOT EXISTS public.budget_rule_adjustments (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id              UUID          NOT NULL REFERENCES public.budget_rules(id) ON DELETE CASCADE,
  period_start         TIMESTAMPTZ   NOT NULL,
  kind                 TEXT          NOT NULL
    CONSTRAINT budget_rule_adjustments_kind_valid CHECK (kind IN ('top_up', 'grant')),
  credits              NUMERIC(14,4) NOT NULL
    CONSTRAINT budget_rule_adjustments_credits_positive CHECK (credits > 0),
  beneficiary_user_id  UUID          NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  approval_request_id  UUID          NULL REFERENCES public.budget_approval_requests(id) ON DELETE SET NULL,
  note                 TEXT          NULL,
  created_by           UUID          NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT budget_rule_adjustments_beneficiary_coherence CHECK (
    (kind = 'top_up' AND beneficiary_user_id IS NULL)
    OR (kind = 'grant' AND beneficiary_user_id IS NOT NULL)
  )
);

-- Una aprobación se convierte en créditos una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_rule_adjustments_one_per_request
  ON public.budget_rule_adjustments (approval_request_id)
  WHERE approval_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_budget_rule_adjustments_rule_period
  ON public.budget_rule_adjustments (rule_id, period_start);

ALTER TABLE public.budget_rule_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.budget_rule_adjustments;
CREATE POLICY "service_role full access"
  ON public.budget_rule_adjustments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
