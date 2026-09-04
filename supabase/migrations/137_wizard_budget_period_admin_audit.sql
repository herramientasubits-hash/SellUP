-- Migration 137: Superficie administrativa del presupuesto del Wizard — auditoría
-- (AGENT1-WIZARD-BUDGET-ADMIN-F1B)
--
-- ═══════════════════════════════════════════════════════════════
-- QUÉ HACE Y QUÉ NO
-- ═══════════════════════════════════════════════════════════════
--
-- Hasta aquí, el presupuesto que gobierna el Wizard sólo se podía cambiar con
-- SQL manual sobre `wizard_monthly_budget_periods`. Un UPDATE a mano no deja
-- rastro de quién lo hizo ni de qué valor había antes, así que el pozo que
-- autoriza el gasto era, en la práctica, un número sin dueño.
--
-- Esta migración es PURAMENTE ADITIVA. Agrega:
--
--   1. `wizard_monthly_budget_periods.updated_by` — quién dejó el valor vigente.
--   2. `wizard_budget_period_changes`             — bitácora append-only old → new.
--   3. `admin_set_wizard_budget_period(...)`      — escribe valor + bitácora en UNA
--                                                   transacción.
--   4. `admin_set_wizard_max_credits_per_execution(...)` — ídem para el techo por
--                                                   ejecución (singleton).
--
-- ── LO QUE NO TOCA (y por qué importa decirlo) ──────────────────
--
-- No hace `CREATE OR REPLACE` de `try_reserve_wizard_credits`,
-- `confirm_wizard_credits` ni `release_wizard_credits`. La semántica de la
-- reserva atómica —`insufficient_budget`, `execution_limit_exceeded`,
-- `period_closed`, `concurrent_execution_active`, la idempotencia y el
-- `confirmed_with_overage` de la 121— queda EXACTAMENTE como estaba. Esta
-- migración no reescribe ni una línea de esas tres funciones.
--
-- No escribe `credits_consumed` ni `credits_reserved`. Esos dos contadores son
-- propiedad exclusiva de las tres RPC de arriba: son el registro de lo que ya
-- pasó, no una perilla de configuración. Las dos funciones nuevas no los nombran
-- en ninguna lista de columnas de INSERT ni de UPDATE, y ésa es la garantía
-- —no un comentario—: una superficie administrativa que pudiera bajar
-- `credits_consumed` convertiría el gasto real en un número editable.
--
-- No conecta `tool_catalog.monthly_credits_allowance` con `budget_credits`. La
-- cuota contratada de un proveedor (cuántos créditos vendió Apollo) y el
-- presupuesto del Wizard (cuánto autoriza SellUp a gastar del pozo compartido
-- por Apollo, Tavily y Lusha) son dos cantidades distintas que se miden con
-- unidades distintas. Aquí no aparece `tool_catalog`.
--
-- No cambia RLS de `authenticated`: las cuatro tablas del presupuesto siguen
-- siendo service_role-only, y las dos funciones nuevas quedan REVOKE'd para
-- `anon` y `authenticated` igual que las de la 064.

-- ═══════════════════════════════════════════════════════════════
-- 1. wizard_monthly_budget_periods.updated_by
-- ═══════════════════════════════════════════════════════════════
--
-- La 064 dejó `created_by` (quién creó el período) pero no quién lo MODIFICÓ.
-- Un presupuesto que se edita varias veces en el mes necesita las dos: sin
-- `updated_by`, el último cambio es anónimo.

ALTER TABLE public.wizard_monthly_budget_periods
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.wizard_monthly_budget_periods.updated_by IS
  'Ultimo internal_user que cambio budget_credits o is_closed desde la superficie administrativa. NULL para filas creadas antes de la migracion 137 o por SQL manual.';

-- ═══════════════════════════════════════════════════════════════
-- 2. wizard_budget_period_changes — bitácora append-only
-- ═══════════════════════════════════════════════════════════════
--
-- Una fila por operación administrativa APLICADA. Los pares
-- `previous_*` / `new_*` son NULL cuando esa operación no tocó ese campo, así
-- que la bitácora distingue «no cambió» de «cambió a NULL» sin inventar filas.
--
-- `period_start` NO lleva FK contra `wizard_monthly_budget_periods`: el techo
-- por ejecución (`max_credits_per_execution`) es GLOBAL y se puede cambiar en un
-- mes que todavía no tiene fila de período. Una FK convertiría ese cambio
-- legítimo en un error de integridad. El período viaja igualmente porque es el
-- contexto temporal en el que la decisión se tomó.
--
-- Append-only DE VERDAD: además de la RLS, se revocan UPDATE y DELETE incluso
-- para `service_role` (que en Supabase es BYPASSRLS, así que una policy sola no
-- lo detendría). Una bitácora que su propio escritor puede reescribir no es una
-- bitácora.

CREATE TABLE IF NOT EXISTS public.wizard_budget_period_changes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE        NOT NULL,
  changed_by   UUID        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  previous_budget_credits INTEGER NULL,
  new_budget_credits      INTEGER NULL,

  previous_is_closed BOOLEAN NULL,
  new_is_closed      BOOLEAN NULL,

  previous_max_credits_per_execution INTEGER NULL,
  new_max_credits_per_execution      INTEGER NULL,

  change_source TEXT NOT NULL DEFAULT 'settings_providers_admin',

  -- Una fila de bitácora que no registra ningún cambio es ruido: prohibida.
  CONSTRAINT wizard_budget_period_changes_records_something
    CHECK (
      previous_budget_credits IS NOT NULL
      OR new_budget_credits IS NOT NULL
      OR previous_is_closed IS NOT NULL
      OR new_is_closed IS NOT NULL
      OR previous_max_credits_per_execution IS NOT NULL
      OR new_max_credits_per_execution IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_wizard_budget_period_changes_period
  ON public.wizard_budget_period_changes (period_start, changed_at DESC);

COMMENT ON TABLE public.wizard_budget_period_changes IS
  'Bitacora append-only de los cambios administrativos al presupuesto del Wizard (budget_credits, is_closed, max_credits_per_execution). Nunca registra credits_consumed ni credits_reserved: esos contadores pertenecen a las RPC de reserva.';

ALTER TABLE public.wizard_budget_period_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role insert" ON public.wizard_budget_period_changes;
CREATE POLICY "service_role insert"
  ON public.wizard_budget_period_changes
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service_role select" ON public.wizard_budget_period_changes;
CREATE POLICY "service_role select"
  ON public.wizard_budget_period_changes
  FOR SELECT TO service_role USING (true);

REVOKE UPDATE, DELETE, TRUNCATE ON public.wizard_budget_period_changes
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.wizard_budget_period_changes FROM anon, authenticated;
GRANT SELECT, INSERT ON public.wizard_budget_period_changes TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 3. admin_set_wizard_budget_period
-- ═══════════════════════════════════════════════════════════════
--
-- UPSERT del período vigente + fila de bitácora, en UNA transacción. La
-- alternativa —dos llamadas desde el servidor de Next— deja una ventana en la
-- que el presupuesto ya cambió y la bitácora todavía no existe; el cambio sin
-- dueño es exactamente el problema que este hito cierra.
--
-- `p_period_start` lo deriva el SERVIDOR con la misma zona horaria que usa la
-- reserva. Esta función no lo valida contra el reloj a propósito: hacerlo
-- duplicaría en SQL una decisión que ya tiene un solo dueño en TypeScript.
-- Lo que sí exige es la constraint de la 064: primer día del mes.
--
-- Devuelve TEXT:
--   updated                 — la fila existía y algún campo cambió
--   created                 — no había fila para el período y se creó
--   no_change               — los valores nuevos son iguales a los vigentes
--   invalid_budget_credits  — presupuesto <= 0 (cerrar un periodo es is_closed, no 0)
--
-- Nunca escribe credits_consumed ni credits_reserved.

CREATE OR REPLACE FUNCTION public.admin_set_wizard_budget_period(
  p_period_start   DATE,
  p_budget_credits INTEGER,
  p_is_closed      BOOLEAN,
  p_changed_by     UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_period RECORD;
BEGIN
  -- Un presupuesto de 0 no es «cerrar el período»: el período se cierra con
  -- is_closed. Dejar pasar 0 crearía dos maneras de decir lo mismo y una de
  -- ellas violaría la constraint `budget_credits > 0` de la 064.
  IF p_budget_credits IS NULL OR p_budget_credits <= 0 THEN
    RETURN 'invalid_budget_credits';
  END IF;

  SELECT period_start, budget_credits, is_closed
  INTO v_period
  FROM public.wizard_monthly_budget_periods
  WHERE period_start = p_period_start
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wizard_monthly_budget_periods
      (period_start, budget_credits, is_closed, created_by, updated_by)
    VALUES
      (p_period_start, p_budget_credits, COALESCE(p_is_closed, false), p_changed_by, p_changed_by);

    INSERT INTO public.wizard_budget_period_changes
      (period_start, changed_by,
       previous_budget_credits, new_budget_credits,
       previous_is_closed, new_is_closed)
    VALUES
      (p_period_start, p_changed_by,
       NULL, p_budget_credits,
       NULL, COALESCE(p_is_closed, false));

    RETURN 'created';
  END IF;

  -- Un cambio que no cambia nada no se registra: una bitácora llena de filas
  -- idénticas esconde los cambios reales.
  IF v_period.budget_credits = p_budget_credits
     AND v_period.is_closed = COALESCE(p_is_closed, v_period.is_closed) THEN
    RETURN 'no_change';
  END IF;

  UPDATE public.wizard_monthly_budget_periods
  SET
    budget_credits = p_budget_credits,
    is_closed      = COALESCE(p_is_closed, is_closed),
    updated_by     = p_changed_by
  WHERE period_start = p_period_start;

  INSERT INTO public.wizard_budget_period_changes
    (period_start, changed_by,
     previous_budget_credits, new_budget_credits,
     previous_is_closed, new_is_closed)
  VALUES
    (p_period_start, p_changed_by,
     v_period.budget_credits, p_budget_credits,
     v_period.is_closed, COALESCE(p_is_closed, v_period.is_closed));

  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_wizard_budget_period(DATE, INTEGER, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_wizard_budget_period(DATE, INTEGER, BOOLEAN, UUID)
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 4. admin_set_wizard_max_credits_per_execution
-- ═══════════════════════════════════════════════════════════════
--
-- UPDATE, nunca INSERT: `wizard_pilot_settings` es un singleton con un trigger
-- que RECHAZA la segunda fila. Un UPSERT aquí no sería más robusto, sería una
-- excepción esperando a ocurrir.
--
-- El techo es GLOBAL del Wizard, no de Apollo: se compara contra los créditos
-- estimados de la corrida sea cual sea el proveedor.
--
-- Devuelve TEXT: updated · no_change · settings_not_found · invalid_max_credits.

CREATE OR REPLACE FUNCTION public.admin_set_wizard_max_credits_per_execution(
  p_period_start DATE,
  p_max_credits  INTEGER,
  p_changed_by   UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_settings RECORD;
BEGIN
  -- La constraint `max_credits_per_execution > 0` de la 064 rechazaría un 0 con
  -- un 23514 opaco. Se valida aquí para devolver un motivo legible.
  IF p_max_credits IS NULL OR p_max_credits <= 0 THEN
    RETURN 'invalid_max_credits';
  END IF;

  SELECT id, max_credits_per_execution
  INTO v_settings
  FROM public.wizard_pilot_settings
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'settings_not_found';
  END IF;

  IF v_settings.max_credits_per_execution = p_max_credits THEN
    RETURN 'no_change';
  END IF;

  UPDATE public.wizard_pilot_settings
  SET
    max_credits_per_execution = p_max_credits,
    updated_by                = p_changed_by
  WHERE id = v_settings.id;

  INSERT INTO public.wizard_budget_period_changes
    (period_start, changed_by,
     previous_max_credits_per_execution, new_max_credits_per_execution)
  VALUES
    (p_period_start, p_changed_by,
     v_settings.max_credits_per_execution, p_max_credits);

  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_wizard_max_credits_per_execution(DATE, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_wizard_max_credits_per_execution(DATE, INTEGER, UUID)
  TO postgres, service_role;
