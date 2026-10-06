-- ═══════════════════════════════════════════════════════════════════
-- 144 — Varias ejecuciones activas por usuario en la reserva del piloto
-- (AGENT1-PARALLEL-RUNS-PHASE2-1, autorizada por la dueña el 06-10)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- La dueña quiere lanzar varias búsquedas del Agente IA a la vez. Apollo y Tavily
-- no reservan del pool del piloto (cuota del proveedor), así que la base no las
-- limita. Lusha sí: try_reserve_wizard_credits (064) rechazaba una segunda reserva
-- con concurrent_execution_active, por dos vías:
--   * el índice único parcial idx_wizard_budget_reservations_one_active_per_user
--     sobre (user_id) WHERE status = 'reserved';
--   * el paso 9 de la RPC (EXISTS de cualquier fila 'reserved' del usuario).
-- El ajuste wizard_pilot_settings.max_active_executions_per_user existe desde la
-- 064 (CHECK >= 1, valor en Prod = 1) pero nada lo leía.
--
-- QUÉ HACE
--
--   1. Quita el índice ÚNICO y deja uno NO único con la misma forma, para que el
--      conteo del paso 9 siga siendo barato.
--   2. Redefine try_reserve_wizard_credits IGUAL que en la 064 salvo el paso 9:
--      cuenta las reservas activas del usuario y compara con el ajuste.
--
-- QUÉ NO HACE
--
--   * NO cambia el ajuste: con max_active_executions_per_user = 1 el
--     comportamiento es idéntico al de hoy. Subirlo es una escritura aparte, con
--     autorización explícita de la dueña.
--   * NO toca presupuestos, períodos, reservas existentes, confirm_wizard_credits
--     ni release_wizard_credits. Ni una fila de datos.
--   * NO relaja el presupuesto: el paso 10 sigue sumando TODAS las reservas vivas
--     (consumed + reserved + requested <= budget) bajo el mismo FOR UPDATE del
--     período, así que varias reservas a la vez nunca pasan del presupuesto del mes.
--   * NO cambia la idempotencia (UNIQUE (user_id, client_request_id), paso 6).
--
-- Reversible: volver a crear el índice único (si no hay dos 'reserved' del mismo
-- usuario) y la función de la 064.

DROP INDEX IF EXISTS public.idx_wizard_budget_reservations_one_active_per_user;

CREATE INDEX IF NOT EXISTS idx_wizard_budget_reservations_active_per_user
  ON public.wizard_budget_reservations (user_id)
  WHERE status = 'reserved';

CREATE OR REPLACE FUNCTION public.try_reserve_wizard_credits(
  p_user_id          UUID,
  p_client_request_id UUID,
  p_requested_credits INTEGER,
  p_period_start     DATE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_settings         RECORD;
  v_is_participant   BOOLEAN;
  v_existing_res_id  UUID;
  v_period           RECORD;
  v_new_reservation  UUID;
  v_active_count     INTEGER;
BEGIN
  -- ── Step 1: Load singleton configuration ───────────────────────
  SELECT
    pilot_enabled,
    max_credits_per_execution,
    max_active_executions_per_user
  INTO v_settings
  FROM public.wizard_pilot_settings
  LIMIT 1;

  IF NOT FOUND THEN
    -- Settings not seeded yet — treat as paused
    RETURN 'pilot_paused';
  END IF;

  -- ── Step 2: Kill-switch ─────────────────────────────────────────
  IF NOT v_settings.pilot_enabled THEN
    RETURN 'pilot_paused';
  END IF;

  -- ── Step 3: Validate participant membership ─────────────────────
  SELECT is_enabled
  INTO v_is_participant
  FROM public.wizard_pilot_participants
  WHERE user_id = p_user_id;

  IF NOT FOUND OR NOT v_is_participant THEN
    RETURN 'user_not_allowed';
  END IF;

  -- ── Step 4: Validate requested_credits is positive ──────────────
  IF p_requested_credits <= 0 THEN
    RETURN 'execution_limit_exceeded';
  END IF;

  -- ── Step 5: Validate credit limit per execution ─────────────────
  IF p_requested_credits > v_settings.max_credits_per_execution THEN
    RETURN 'execution_limit_exceeded';
  END IF;

  -- ── Step 6: Detect existing reservation for same identity ───────
  SELECT id
  INTO v_existing_res_id
  FROM public.wizard_budget_reservations
  WHERE user_id = p_user_id
    AND client_request_id = p_client_request_id;

  IF FOUND THEN
    RETURN 'already_reserved';
  END IF;

  -- ── Step 7: Lock period row for atomic budget update ────────────
  SELECT
    period_start,
    budget_credits,
    credits_reserved,
    credits_consumed,
    is_closed
  INTO v_period
  FROM public.wizard_monthly_budget_periods
  WHERE period_start = p_period_start
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'period_not_configured';
  END IF;

  -- ── Step 8: Validate period is open ─────────────────────────────
  IF v_period.is_closed THEN
    RETURN 'period_closed';
  END IF;

  -- ── Step 9: Validate active executions per user (144) ──────────
  -- Antes: «una sola», fija, por el índice único parcial (user_id) WHERE
  -- status = 'reserved'. Ahora el tope lo da el ajuste que ya existía y no se
  -- leía, max_active_executions_per_user (CHECK >= 1). Con el valor en 1 el
  -- comportamiento es IDÉNTICO al de la 064.
  --
  -- Atomicidad: este conteo corre DESPUÉS del FOR UPDATE del paso 7 sobre la
  -- fila del período, así que dos reservas del mismo período se serializan; en
  -- READ COMMITTED la segunda ve la fila que insertó la primera.
  SELECT count(*)
  INTO v_active_count
  FROM public.wizard_budget_reservations
  WHERE user_id = p_user_id
    AND status = 'reserved';

  IF v_active_count >= GREATEST(v_settings.max_active_executions_per_user, 1) THEN
    RETURN 'concurrent_execution_active';
  END IF;

  -- ── Step 10: Validate sufficient available budget ───────────────
  -- available = budget_credits - credits_consumed - credits_reserved
  IF (v_period.credits_consumed + v_period.credits_reserved + p_requested_credits)
       > v_period.budget_credits THEN
    RETURN 'insufficient_budget';
  END IF;

  -- ── Step 11: Create reservation ─────────────────────────────────
  INSERT INTO public.wizard_budget_reservations
    (period_start, user_id, client_request_id, credits_reserved, status)
  VALUES
    (p_period_start, p_user_id, p_client_request_id, p_requested_credits, 'reserved')
  RETURNING id INTO v_new_reservation;

  -- ── Step 12: Increment period reserved counter ──────────────────
  UPDATE public.wizard_monthly_budget_periods
  SET
    credits_reserved = credits_reserved + p_requested_credits,
    updated_at       = now()
  WHERE period_start = p_period_start;

  RETURN 'reserved';
END;
$$;

REVOKE ALL ON FUNCTION public.try_reserve_wizard_credits(UUID, UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_reserve_wizard_credits(UUID, UUID, INTEGER, DATE)
  TO postgres, service_role;
