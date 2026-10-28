-- ═══════════════════════════════════════════════════════════════════
-- 160 — La reserva de créditos del asistente deja de poner topes propios
-- (autorizado por la dueña el 28-10: «si el administrador en distintos
-- proveedores quiere limitar los créditos por alguno de los criterios que
-- tenemos allá, lo hace; si no tiene nada limitado, todo funciona para todos sin
-- límites, sólo los créditos que se tienen»).
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- try_reserve_wizard_credits (064, 144) era la capa del «piloto», de cuando una
-- sola persona usaba el asistente. Antes de gastar en Lusha exigía, sin verse en
-- ninguna pantalla: estar en wizard_pilot_participants, no pasar de
-- max_credits_per_execution por búsqueda, no tener más de
-- max_active_executions_per_user a la vez, y que quedara saldo en la bolsa del
-- mes (wizard_monthly_budget_periods). En octubre de 2026 no había bolsa creada,
-- así que Lusha estaba frenada para todos.
--
-- Los límites ahora son SÓLO los de Configuración › Proveedores, y los aplica el
-- servidor ANTES de llamar a esta función (checkConfiguredProviderLimit): los
-- créditos del proveedor y las reglas por persona, rol, grupo o para todos.
--
-- QUÉ HACE
--
--   Redefine try_reserve_wizard_credits con la misma firma y los mismos códigos,
--   sin los pasos de lista, tope por búsqueda, búsquedas a la vez, saldo de la
--   bolsa ni período cerrado. Si el mes no tiene fila, la crea: la fila queda
--   como libro de cuentas (reservado / gastado), ya no como tope. Se conserva:
--     · el interruptor de emergencia (wizard_pilot_settings.pilot_enabled = false
--       detiene todo, como siempre; hoy está en true);
--     · la identidad de la reserva (already_reserved) y su contabilidad, que
--       confirm_wizard_credits y release_wizard_credits siguen usando igual.
--
-- QUÉ NO HACE
--
--   * No cambia ni borra filas existentes de presupuesto, reservas ni ajustes.
--   * No toca confirm_wizard_credits ni release_wizard_credits.
--   * No borra las tablas del piloto (quedan sin uso para los topes).

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
  v_paused           BOOLEAN;
  v_existing_res_id  UUID;
BEGIN
  -- ── Paso 1: interruptor de emergencia (no es un tope) ───────────
  SELECT NOT pilot_enabled
  INTO v_paused
  FROM public.wizard_pilot_settings
  LIMIT 1;

  IF FOUND AND v_paused THEN
    RETURN 'pilot_paused';
  END IF;

  -- ── Paso 2: una reserva siempre es de al menos un crédito ───────
  IF p_requested_credits <= 0 THEN
    RETURN 'execution_limit_exceeded';
  END IF;

  -- ── Paso 3: la misma corrida no reserva dos veces ───────────────
  SELECT id
  INTO v_existing_res_id
  FROM public.wizard_budget_reservations
  WHERE user_id = p_user_id
    AND client_request_id = p_client_request_id;

  IF FOUND THEN
    RETURN 'already_reserved';
  END IF;

  -- ── Paso 4: la fila del mes es el libro de cuentas; se crea si falta ──
  -- budget_credits exige > 0 (064); ya no se compara contra nada.
  INSERT INTO public.wizard_monthly_budget_periods (period_start, budget_credits)
  VALUES (p_period_start, 1)
  ON CONFLICT (period_start) DO NOTHING;

  PERFORM 1
  FROM public.wizard_monthly_budget_periods
  WHERE period_start = p_period_start
  FOR UPDATE;

  -- ── Paso 5: anotar la reserva ───────────────────────────────────
  INSERT INTO public.wizard_budget_reservations
    (period_start, user_id, client_request_id, credits_reserved, status)
  VALUES
    (p_period_start, p_user_id, p_client_request_id, p_requested_credits, 'reserved');

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
