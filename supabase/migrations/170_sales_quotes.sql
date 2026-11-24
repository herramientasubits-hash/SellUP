-- 170 — Cotizador de Ventas: cotizaciones guardadas y aprobación de descuentos.
--
-- El cotizador (/quotes) guarda cada cotización que el vendedor decide guardar.
-- En la versión 2027, si alguna línea queda bajo el mínimo, la cotización se
-- guarda «pendiente de aprobación» y le llega a quien aprueba (en SellUp y por
-- Slack), que la aprueba o la rechaza. Lo guardado no se edita: para cambiarla
-- se duplica como una nueva.
--
-- `input` es lo que eligió el vendedor; `result` es el cálculo que hizo el
-- SERVIDOR con el mismo motor (src/modules/sales-quote), nunca el que mandó el
-- navegador. Las cifras de cabecera (por año y contrato) van aparte para listar.
--
-- Quién aprueba se configura por tipo de cuenta (Ventas o CS) en
-- `sales_quote_approvers`: aprobadores y personas en copia. Sin aprobadores
-- activos, aprueban los administradores (la app lo resuelve).
--
-- Leen y escriben sólo el servidor con la llave de servicio (mismo patrón que
-- budget_approval_requests en la 163): ni `anon` ni `authenticated` tocan las tablas.
-- No toca filas existentes.

-- ─── 1. Cotizaciones ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sales_quotes (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       UUID          NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  account_id       UUID          NULL REFERENCES public.accounts(id) ON DELETE SET NULL,
  client_name      TEXT          NULL,
  pricing_version  TEXT          NOT NULL
    CONSTRAINT sales_quotes_version_valid CHECK (pricing_version IN ('2026', '2027')),
  country_code     TEXT          NOT NULL,
  account_type     TEXT          NOT NULL DEFAULT 'ventas'
    CONSTRAINT sales_quotes_account_type_valid CHECK (account_type IN ('ventas', 'cs')),
  years            INTEGER       NOT NULL
    CONSTRAINT sales_quotes_years_valid CHECK (years BETWEEN 1 AND 5),
  per_year_total   NUMERIC(14,2) NOT NULL,
  contract_total   NUMERIC(14,2) NOT NULL,
  needs_approval   BOOLEAN       NOT NULL DEFAULT false,
  input            JSONB         NOT NULL,
  result           JSONB         NOT NULL,
  status           TEXT          NOT NULL
    CONSTRAINT sales_quotes_status_valid
      CHECK (status IN ('ready', 'pending_approval', 'approved', 'rejected', 'cancelled')),
  decided_by       UUID          NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ   NULL,
  decision_note    TEXT          NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT sales_quotes_decision_coherence CHECK (
    (status = 'ready' AND needs_approval = false AND decided_at IS NULL)
    OR (status = 'pending_approval' AND needs_approval = true AND decided_at IS NULL)
    OR (status IN ('approved', 'rejected') AND needs_approval = true AND decided_at IS NOT NULL)
    OR (status = 'cancelled' AND decided_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.sales_quotes IS
  'Cotizaciones del cotizador de Ventas. result = cálculo del servidor; lo guardado no se edita.';

CREATE INDEX IF NOT EXISTS idx_sales_quotes_created_by
  ON public.sales_quotes (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_quotes_pending
  ON public.sales_quotes (account_type, created_at)
  WHERE status = 'pending_approval';

ALTER TABLE public.sales_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.sales_quotes;
CREATE POLICY "service_role full access"
  ON public.sales_quotes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 2. Quién aprueba ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sales_quote_approvers (
  account_type  TEXT         NOT NULL
    CONSTRAINT sales_quote_approvers_account_type_valid CHECK (account_type IN ('ventas', 'cs')),
  user_id       UUID         NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  role          TEXT         NOT NULL
    CONSTRAINT sales_quote_approvers_role_valid CHECK (role IN ('approver', 'cc')),
  created_by    UUID         NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (account_type, user_id)
);

COMMENT ON TABLE public.sales_quote_approvers IS
  'Quién aprueba (approver) o recibe copia (cc) de las solicitudes de descuento del cotizador, por tipo de cuenta.';

ALTER TABLE public.sales_quote_approvers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.sales_quote_approvers;
CREATE POLICY "service_role full access"
  ON public.sales_quote_approvers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
