-- Migration 134 — AGENT1-LUSHA-CUT-L3: valla DURABLE de peticion de Prospecting
--
-- ============================================================================
-- POR QUE EXISTE
-- ============================================================================
--
-- CUT-L2 dejo la frontera de despacho de Lusha en MEMORIA: un booleano dentro de
-- `searchLushaCompaniesV3` que sabe si los bytes pudieron salir mientras el
-- proceso viva. Una caida dura entre el `fetch()` y la clasificacion se lleva ese
-- testigo, y al reanudar la reserva de corrida responde `already_reserved` sobre
-- el mismo `client_request_id`: la corrida se re-ejecuta y vuelve a pedir la
-- MISMA pagina al proveedor.
--
-- El soporte HUMANO de Lusha confirmo que eso puede costar dos veces: no hay
-- Idempotency-Key, no hay requestId de cliente y no hay API de recuperacion de la
-- respuesta.
--
-- Esta migracion crea el UNICO estado durable que permite escribir "esta peticion
-- puede haber salido" ANTES de que salga, y consultarlo despues de un reinicio.
--
-- ============================================================================
-- LO QUE ESTA MIGRACION NO HACE
-- ============================================================================
--
--   * NO enciende Lusha, ni ningun flag. Es esquema.
--   * NO reintenta nada. `definitely_not_charged` describe el CONTRATO del
--     proveedor; ejecutarlo es CUT-L4.
--   * NO guarda payload del proveedor: ni empresas, ni dominios, ni nombres, ni
--     la clave de API. Solo estado, cifras de facturacion e ids internos.
--   * NO toca presupuesto: `wizard_budget_reservations` sigue siendo la autoridad
--     de credito. `reservation_id` aqui es EVIDENCIA, no control.
--   * NO referencia ninguna tabla previa. Es autocontenida a proposito: la unica
--     dependencia externa es `pgcrypto` y los roles de la plataforma.
--
-- APLICADA EN PRODUCCION = NO. Se entrega sin aplicar, y el runtime falla CERRADO
-- cuando las funciones no existen (SQLSTATE 42883 / PostgREST PGRST202): sin valla
-- no se despacha.

-- ============================================================
-- 1. lusha_prospecting_operations — LA IDENTIDAD ECONOMICA DURABLE
-- ============================================================
--
-- Una fila = UNA operacion logica de busqueda pagada de Agente 1.
--
-- POR QUE EXISTE (y por que no basta con la valla de peticion):
--
-- La valla de peticion se identificaba con `client_request_id`, y ese uuid lo
-- acuna el NAVEGADOR, fresco por clic. Eso cierra la redelivery del mismo
-- payload y el reintento del framework, pero NO cierra lo unico que hace falta:
--
--     el proceso cae
--       -> la valla previa queda `dispatch_unsafe`
--         -> la usuaria vuelve a hacer clic
--           -> clientRequestId NUEVO -> clave de valla NUEVA
--             -> la MISMA pagina logica puede volver a llegar a Lusha
--
-- La autoridad economica tiene que ser del SERVIDOR y sobrevivir al reinicio.
-- Aqui lo es: `operation_id` lo genera la BASE, y una entrada nueva se reencuentra
-- con la operacion abierta por (actor, firma canonica de la busqueda).
--
-- POR QUE NO SE REUTILIZO NADA EXISTENTE:
--
--   * `wizard_budget_reservations` es UNIQUE (user_id, client_request_id): un clic
--     nuevo acuna reserva nueva, asi que hereda exactamente el defecto.
--   * `prospect_batches` es UNIQUE (created_by, client_request_id) — lo mismo — y
--     ademas puede no existir todavia cuando ocurre la primera peticion pagada.
--
-- Ninguna de las dos esta indexada por la SEMANTICA de la busqueda, que es lo que
-- un clic nuevo si repite. De ahi esta tabla, que es la mas pequena que sirve.
--
-- NO guarda los criterios: guarda su HASH. Decidir si una operacion sigue abierta
-- no exige saber que busco nadie, y meter criterios de negocio en un registro de
-- seguridad de gasto habria sido superficie sin necesidad.

CREATE TABLE IF NOT EXISTS public.lusha_prospecting_operations (
  operation_id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                  text        NOT NULL DEFAULT 'lusha'
    CONSTRAINT lusha_prospecting_operations_provider_check
    CHECK (provider = 'lusha'),
  -- Frontera de pertenencia. `internal_user:<uuid>` — la MISMA que ya usan
  -- `prospect_batches.created_by` y `wizard_budget_reservations.user_id`. El
  -- prefijo evita que una firma sea una llave GLOBAL entre clientes y deja sitio a
  -- un ambito mas ancho el dia que exista.
  actor_scope               text        NOT NULL
    CONSTRAINT lusha_prospecting_operations_actor_scope_check
    CHECK (btrim(actor_scope) <> ''),
  request_signature_version text        NOT NULL
    CONSTRAINT lusha_prospecting_operations_signature_version_check
    CHECK (btrim(request_signature_version) <> ''),
  -- SHA-256 hex de la semantica NORMALIZADA de la busqueda pagada. Sin nada
  -- efimero dentro: ni clientRequestId, ni reservationId, ni relojes.
  request_signature_hash    text        NOT NULL
    CONSTRAINT lusha_prospecting_operations_signature_hash_check
    CHECK (request_signature_hash ~ '^[0-9a-f]{64}$'),
  state                     text        NOT NULL DEFAULT 'open'
    CONSTRAINT lusha_prospecting_operations_state_check
    CHECK (state IN ('open', 'reconciliation_required', 'completed')),
  -- TRAZA de correlacion con la reserva y con el lote. NUNCA autoridad de replay.
  last_client_request_id    text        NULL,
  -- Cuantas entradas nuevas se encontraron esta operacion todavia sin resolver.
  -- Es la senal de la cola de revision HUMANA: > 0 significa que alguien reintento.
  resume_attempts           integer     NOT NULL DEFAULT 0
    CONSTRAINT lusha_prospecting_operations_resume_attempts_check
    CHECK (resume_attempts >= 0),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  completed_at              timestamptz NULL,
  reconciliation_required_at timestamptz NULL,

  CONSTRAINT lusha_prospecting_operations_completed_tuple_check CHECK (
    (state = 'completed' AND completed_at IS NOT NULL)
    OR (state <> 'completed' AND completed_at IS NULL)
  )
);

-- ═══ LA UNICIDAD QUE ES EL CORTE ═══
--
-- Como maximo UNA operacion SIN RESOLVER por (actor, version de firma, firma).
-- Parcial a proposito: en cuanto la operacion se cierra durablemente sale del
-- indice y la MISMA busqueda puede volver a acunar operacion.
--
-- 🔴 Que sea PARCIAL es lo que impide que esto se convierta en un dedupe
-- PERMANENTE de consultas. Una usuaria tiene derecho a repetir la semana que viene
-- la busqueda que hizo hoy; un indice total habria cambiado un defecto por otro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lusha_prospecting_operations_one_unresolved
  ON public.lusha_prospecting_operations
     (actor_scope, request_signature_version, request_signature_hash)
  WHERE state IN ('open', 'reconciliation_required');

CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_operations_unresolved
  ON public.lusha_prospecting_operations (created_at DESC)
  WHERE state IN ('open', 'reconciliation_required');

ALTER TABLE public.lusha_prospecting_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_lusha_prospecting_operations_all"
  ON public.lusha_prospecting_operations;
CREATE POLICY "service_role_lusha_prospecting_operations_all"
  ON public.lusha_prospecting_operations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.lusha_prospecting_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.lusha_prospecting_operations FROM anon;
REVOKE ALL ON TABLE public.lusha_prospecting_operations FROM authenticated;
REVOKE ALL ON TABLE public.lusha_prospecting_operations FROM service_role;
-- Sin DELETE y sin TRUNCATE ni siquiera para `service_role`: la identidad
-- economica que el runtime puede borrar no es una identidad, es una sugerencia.
GRANT SELECT, INSERT, UPDATE ON TABLE public.lusha_prospecting_operations
  TO service_role;

COMMENT ON TABLE public.lusha_prospecting_operations IS
  'AGENT1-LUSHA-CUT-L3. Una fila por operacion logica de busqueda pagada de Lusha. La identidad economica es del SERVIDOR (operation_id) y se reencuentra por (actor, firma canonica), NO por el uuid que acuna el navegador. La unicidad rige solo mientras la operacion sigue sin resolver.';

-- ============================================================
-- 2. claim_or_resume_lusha_prospecting_operation
-- ============================================================
--
-- LA PUERTA ECONOMICA. Se llama en la entrada pagada del servidor, ANTES de la
-- reserva de credito y ANTES de cualquier peticion al proveedor.
--
--   `created`            -> esta llamada acuno la operacion. Es la UNICA que
--                           autoriza a reservar y a gastar.
--   `resumed_unresolved` -> ya habia una operacion sin resolver para este actor y
--                           esta firma. NO se acuna otra y el llamador NO gasta.
--
-- 🔴 Reanudar TRANSICIONA `open` -> `reconciliation_required`. No es cosmetica: si
-- alguien vuelve a entrar mientras la operacion sigue abierta, o hay un proceso
-- vivo (y duplicarlo seria pagar dos veces) o hay un proceso muerto (y entonces
-- hace falta reconciliar lo que dejo). Ninguna de las dos autoriza a gastar, y el
-- estado tiene que poder DECIRLO.
--
-- ATOMICIDAD: la da el indice unico parcial, no un SELECT previo. Dos entradas
-- simultaneas con firmas iguales compiten en el indice; la perdedora se bloquea
-- hasta que la ganadora comprometa y entonces recibe `unique_violation`. Un
-- `SELECT` seguido de `INSERT` habria dejado la carrera abierta (§ 8).
--
-- El bucle de dos vueltas cubre la unica ventana restante: que entre la violacion
-- y la relectura la ganadora COMPLETE la operacion y salga del indice parcial. En
-- ese caso no hay nada sin resolver y acunar una operacion nueva es lo correcto.

CREATE OR REPLACE FUNCTION public.claim_or_resume_lusha_prospecting_operation(
  p_actor_scope               text,
  p_request_signature_version text,
  p_request_signature_hash    text,
  p_client_request_id         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $claim_op$
DECLARE
  v_operation_id uuid;
  v_state        text;
  v_attempt      integer := 0;
BEGIN
  IF p_actor_scope IS NULL OR btrim(p_actor_scope) = ''
     OR p_request_signature_version IS NULL OR btrim(p_request_signature_version) = ''
     OR p_request_signature_hash IS NULL OR btrim(p_request_signature_hash) = '' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  IF p_request_signature_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid_signature');
  END IF;

  WHILE v_attempt < 2 LOOP
    v_attempt := v_attempt + 1;

    BEGIN
      INSERT INTO public.lusha_prospecting_operations (
        actor_scope, request_signature_version, request_signature_hash,
        state, last_client_request_id
      )
      VALUES (
        btrim(p_actor_scope), btrim(p_request_signature_version),
        p_request_signature_hash, 'open', nullif(btrim(coalesce(p_client_request_id, '')), '')
      )
      RETURNING operation_id INTO v_operation_id;

      RETURN jsonb_build_object(
        'status', 'created',
        'operation_id', v_operation_id,
        'state', 'open'
      );
    EXCEPTION WHEN unique_violation THEN
      -- Otra entrada gano. Se reanuda la SUYA: se marca que hubo re-entrada y se
      -- devuelve su id, para que el bloqueo se pueda correlacionar con la corrida
      -- que de verdad esta (o estuvo) gastando.
      UPDATE public.lusha_prospecting_operations
      SET state = 'reconciliation_required',
          reconciliation_required_at = coalesce(reconciliation_required_at, now()),
          resume_attempts = resume_attempts + 1,
          last_client_request_id = coalesce(
            nullif(btrim(coalesce(p_client_request_id, '')), ''), last_client_request_id
          ),
          updated_at = now()
      WHERE actor_scope = btrim(p_actor_scope)
        AND request_signature_version = btrim(p_request_signature_version)
        AND request_signature_hash = p_request_signature_hash
        AND state IN ('open', 'reconciliation_required')
      RETURNING operation_id, state INTO v_operation_id, v_state;

      IF v_operation_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'status', 'resumed_unresolved',
          'operation_id', v_operation_id,
          'state', v_state
        );
      END IF;
      -- La ganadora COMPLETO entre la violacion y la relectura: ya no hay nada sin
      -- resolver. Se vuelve a intentar acunar, que es lo correcto (§ 8).
    END;
  END LOOP;

  -- Dos vueltas sin converger. Fallo CERRADO: sin operacion no hay gasto (§ 21).
  RETURN jsonb_build_object('status', 'contended');
END;
$claim_op$;

-- ============================================================
-- 3. complete_lusha_prospecting_operation
-- ============================================================
--
-- Cierra la operacion. Es lo que devuelve a la usuaria el derecho a repetir la
-- MISMA busqueda mas adelante (§ 8).
--
-- 🔴 NO se puede cerrar porque Lusha devolviera 200. La revision final probo que
-- existe esta ventana:
--
--     exito del proveedor -> valla marcada -> CAIDA antes de persistir candidatos
--
-- Las empresas se pierden y la corrida no termino. Por eso el cierre tiene DOS
-- mitades, y ninguna basta sola:
--
--   1. el runtime solo llama aqui DESPUES de que la persistencia rio abajo haya
--      devuelto; una caida antes de eso nunca llega a esta funcion;
--   2. esta funcion se niega a cerrar si ALGUNA peticion de la operacion sigue sin
--      verdad de facturacion asentada — `prepared` y `dispatch_unsafe` porque no
--      se liquidaron, `indeterminate` y `unknown` porque nadie confirmo si se
--      cobro. Solo `succeeded` y `definitely_not_charged` son verdades sobre las
--      que SellUp puede actuar.
--
-- Cuando se niega, deja la operacion en `reconciliation_required`: el bloqueo pasa
-- a ser un hecho ESCRITO y no un silencio.
--
-- Cerrar desde `reconciliation_required` SI se permite cuando todas las peticiones
-- estan asentadas, y es deliberado: un doble clic marca la operacion, la corrida
-- original termina bien, y no queda nada que reconciliar. Sin esto un doble clic
-- accidental habria vetado esa busqueda para siempre. `resume_attempts` conserva
-- la evidencia de que hubo re-entrada.

CREATE OR REPLACE FUNCTION public.complete_lusha_prospecting_operation(
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $complete_op$
DECLARE
  v_state    text;
  v_unsettled integer;
BEGIN
  IF p_operation_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT state INTO v_state
  FROM public.lusha_prospecting_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_state = 'completed' THEN
    RETURN jsonb_build_object('status', 'already_completed', 'state', v_state);
  END IF;

  SELECT count(*) INTO v_unsettled
  FROM public.lusha_prospecting_request_fence
  WHERE operation_id = p_operation_id
    AND state NOT IN ('succeeded', 'definitely_not_charged');

  IF v_unsettled > 0 THEN
    UPDATE public.lusha_prospecting_operations
    SET state = 'reconciliation_required',
        reconciliation_required_at = coalesce(reconciliation_required_at, now()),
        updated_at = now()
    WHERE operation_id = p_operation_id;

    RETURN jsonb_build_object(
      'status', 'blocked_unsettled_requests',
      'state', 'reconciliation_required',
      'unsettled', v_unsettled
    );
  END IF;

  UPDATE public.lusha_prospecting_operations
  SET state = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('status', 'completed', 'state', 'completed');
END;
$complete_op$;

-- ============================================================
-- 4. lusha_prospecting_request_fence
-- ============================================================
--
-- Una fila = UNA peticion logica de Prospecting = como maximo UNA llamada HTTP.
--
-- `fence_key` es la PRIMARY KEY y por tanto la unicidad. Su forma la construye
-- `buildLushaRequestFenceKey`:
--
--     lusha_prospecting|v2|<operation_id>|b<branch_index>|p<page_index>
--
-- Texto plano y legible a proposito: se correlaciona con la corrida sin
-- desenrollar un hash, y no contiene pais, sector, dominio ni dato de empresa.
--
-- La `v2` de la clave NO es cosmetica: la `v1` llevaba `client_request_id`, que lo
-- acuna el navegador y es fresco por clic, asi que una caida seguida de un clic
-- nuevo acunaba clave virgen y la misma pagina podia volver a llegar a Lusha.
--
-- `triggered_by` y `reservation_id` van SIN clave foranea. Es deliberado: esta
-- tabla es un registro de seguridad de gasto y tiene que poder escribirse aunque
-- la fila de usuario o de reserva se archive. Una FK convertiria un borrado
-- administrativo en un fallo de valla, es decir, en una peticion sin testigo.

CREATE TABLE IF NOT EXISTS public.lusha_prospecting_request_fence (
  fence_key           text        PRIMARY KEY,
  provider            text        NOT NULL DEFAULT 'lusha'
    CONSTRAINT lusha_prospecting_request_fence_provider_check
    CHECK (provider = 'lusha'),
  state               text        NOT NULL
    CONSTRAINT lusha_prospecting_request_fence_state_check
    CHECK (state IN (
      'prepared',
      'dispatch_unsafe',
      'succeeded',
      'definitely_not_charged',
      'indeterminate',
      'unknown'
    )),
  -- 🔴 LA IDENTIDAD. La acuna el SERVIDOR y sobrevive al reinicio, asi que un
  -- clic nuevo tras una caida vuelve a la MISMA operacion en vez de acunar una
  -- clave de valla virgen. Sustituye a `client_request_id`, que lo generaba el
  -- navegador y por tanto era fresco por clic.
  --
  -- FK SIN cascada a proposito: borrar una operacion NO puede llevarse por delante
  -- la evidencia de gasto de sus peticiones. Como la tabla de operaciones tampoco
  -- concede DELETE a nadie, la integridad se mantiene sin crear riesgo destructivo.
  operation_id        uuid        NOT NULL
    REFERENCES public.lusha_prospecting_operations(operation_id),
  -- TRAZA de correlacion con la reserva y con el lote. Se conserva porque quitar
  -- observabilidad no era el objetivo — pero ya NO valla nada.
  client_request_id   text        NULL,
  branch_index        integer     NOT NULL
    CONSTRAINT lusha_prospecting_request_fence_branch_check CHECK (branch_index >= 0),
  page_index          integer     NOT NULL
    CONSTRAINT lusha_prospecting_request_fence_page_check CHECK (page_index >= 0),
  triggered_by        uuid        NULL,
  reservation_id      uuid        NULL,

  -- Evidencia del desenlace. Toda NULL mientras la peticion no sea terminal.
  outcome_class       text        NULL,
  billing_certainty   text        NULL
    CONSTRAINT lusha_prospecting_request_fence_billing_check
    CHECK (billing_certainty IS NULL OR billing_certainty IN (
      'definitely_not_charged',
      'potentially_charged',
      'settled_from_provider',
      'unknown'
    )),
  retry_contract      text        NULL,
  http_status         integer     NULL,
  -- `x-request-id` del SERVIDOR de Lusha. TRAZA. Nunca clave, nunca idempotencia,
  -- nunca autoridad de replay: solo existe DESPUES de que el proveedor responda,
  -- asi que no puede vallar nada anterior al envio.
  provider_request_id text        NULL,
  credits_charged     numeric     NULL,
  results_returned    integer     NULL,

  -- Instantanea de cuota de los CUATRO headers que Lusha si envia (CUT-L2).
  -- Secundaria a la seguridad de replay: puede quedarse NULL sin consecuencia.
  rate_limit_minute_limit     integer NULL,
  rate_limit_minute_remaining integer NULL,
  rate_limit_daily_limit      integer NULL,
  rate_limit_daily_remaining  integer NULL,

  claimed_at          timestamptz NOT NULL DEFAULT now(),
  -- Instante en que la valla se comprometio. NO afirma que Lusha recibiera nada:
  -- afirma que SellUp ya no puede reanudar esta peticion por su cuenta.
  dispatched_at       timestamptz NULL,
  settled_at          timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Coherencia de tupla: un estado terminal exige sello de liquidacion, y
  -- `dispatch_unsafe` exige sello de despacho. Sin esto una fila podria decir
  -- "succeeded" sin haber pasado nunca por el despacho.
  CONSTRAINT lusha_prospecting_request_fence_dispatch_tuple_check CHECK (
    (state = 'prepared' AND dispatched_at IS NULL AND settled_at IS NULL)
    OR (state = 'dispatch_unsafe' AND dispatched_at IS NOT NULL AND settled_at IS NULL)
    OR (state IN ('succeeded', 'definitely_not_charged', 'indeterminate', 'unknown')
        AND settled_at IS NOT NULL)
  ),
  -- Un exito NO puede haber ocurrido sin despacho. La direccion contraria si es
  -- legitima: `definitely_not_charged` cubre el rechazo local previo al envio.
  CONSTRAINT lusha_prospecting_request_fence_success_dispatch_check CHECK (
    state <> 'succeeded' OR dispatched_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_request_fence_operation
  ON public.lusha_prospecting_request_fence (operation_id, branch_index, page_index);

-- TRAZA. Sirve para correlacionar a mano con la reserva; no gobierna nada.
CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_request_fence_client_request
  ON public.lusha_prospecting_request_fence (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_request_fence_reservation
  ON public.lusha_prospecting_request_fence (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- Peticiones que quedaron sin liquidar: la cola de revision HUMANA de CUT-L4.
CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_request_fence_unsettled
  ON public.lusha_prospecting_request_fence (claimed_at DESC)
  WHERE state IN ('prepared', 'dispatch_unsafe');

-- ============================================================
-- 5. RLS y privilegios
-- ============================================================
--
-- Registro de seguridad de gasto: solo `service_role`. `authenticated` no tiene
-- policy de lectura, y eso es intencionado — un cliente de sesion no necesita ver
-- la valla y darsela abriria una superficie que nadie pidio.
--
-- `service_role` en la plataforma es BYPASSRLS, asi que la RLS no es lo que lo
-- protege de el; lo que importa son los GRANT de abajo.

ALTER TABLE public.lusha_prospecting_request_fence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_lusha_prospecting_request_fence_all"
  ON public.lusha_prospecting_request_fence;
CREATE POLICY "service_role_lusha_prospecting_request_fence_all"
  ON public.lusha_prospecting_request_fence
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Estado final declarativo. Supabase concede los 8 privilegios por DEFAULT
-- PRIVILEGES, asi que hay que REVOCAR antes de conceder: un GRANT solo SUMA.
REVOKE ALL ON TABLE public.lusha_prospecting_request_fence FROM PUBLIC;
REVOKE ALL ON TABLE public.lusha_prospecting_request_fence FROM anon;
REVOKE ALL ON TABLE public.lusha_prospecting_request_fence FROM authenticated;
REVOKE ALL ON TABLE public.lusha_prospecting_request_fence FROM service_role;
-- Sin DELETE y sin TRUNCATE ni siquiera para `service_role`: una valla que el
-- runtime puede borrar no es una valla, es una sugerencia.
GRANT SELECT, INSERT, UPDATE ON TABLE public.lusha_prospecting_request_fence
  TO service_role;

-- ============================================================
-- 6. claim_lusha_prospecting_request
-- ============================================================
--
-- INSERT atomico. Devuelve `claimed` solo cuando ESTA llamada creo la fila; si ya
-- existia devuelve `already_claimed` con su estado, y el llamador NO despacha.
--
-- La atomicidad la da la PRIMARY KEY, no un SELECT previo: dos trabajadores
-- concurrentes sobre la misma peticion logica compiten en el indice y solo uno
-- gana. Un `SELECT` seguido de `INSERT` habria dejado la carrera abierta.
--
-- SECURITY DEFINER con `search_path` fijado: la funcion no llama a ninguna otra
-- funcion del esquema, asi que no puede propagar un `search_path` restringido a
-- terceros (que es lo que rompio la 126 antes de la CUT-3B5).

CREATE OR REPLACE FUNCTION public.claim_lusha_prospecting_request(
  p_fence_key         text,
  p_operation_id      uuid,
  p_branch_index      integer,
  p_page_index        integer,
  p_client_request_id text DEFAULT NULL,
  p_triggered_by      uuid DEFAULT NULL,
  p_reservation_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $claim$
DECLARE
  v_inserted integer;
  v_state    text;
BEGIN
  IF p_fence_key IS NULL OR btrim(p_fence_key) = ''
     OR p_operation_id IS NULL
     OR p_branch_index IS NULL OR p_branch_index < 0
     OR p_page_index IS NULL OR p_page_index < 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  -- Una valla solo puede colgar de una operacion que EXISTA y siga sin resolver.
  -- Reclamar contra una operacion ya cerrada seria fabricar una peticion fuera de
  -- toda operacion viva, que es exactamente el estado que nadie podria reconciliar.
  IF NOT EXISTS (
    SELECT 1 FROM public.lusha_prospecting_operations
    WHERE operation_id = p_operation_id
      AND state IN ('open', 'reconciliation_required')
  ) THEN
    RETURN jsonb_build_object('status', 'operation_not_open');
  END IF;

  INSERT INTO public.lusha_prospecting_request_fence (
    fence_key, provider, state, operation_id, client_request_id,
    branch_index, page_index, triggered_by, reservation_id
  )
  VALUES (
    p_fence_key, 'lusha', 'prepared', p_operation_id,
    nullif(btrim(coalesce(p_client_request_id, '')), ''),
    p_branch_index, p_page_index, p_triggered_by, p_reservation_id
  )
  ON CONFLICT (fence_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    RETURN jsonb_build_object('status', 'claimed', 'state', 'prepared');
  END IF;

  SELECT state INTO v_state
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key;

  RETURN jsonb_build_object('status', 'already_claimed', 'state', v_state);
END;
$claim$;

-- ============================================================
-- 7. mark_lusha_prospecting_request_dispatched
-- ============================================================
--
-- LA FRONTERA. Esta llamada es lo ultimo que ocurre antes del `fetch()`, y su
-- transaccion se COMPROMETE antes de que salga un byte. A partir de aqui la
-- peticion no es reanudable automaticamente.
--
-- Solo transiciona desde `prepared`. Una fila ya marcada, ya terminal o
-- inexistente devuelve `not_claimable` y el llamador ABORTA el envio.
--
-- 🔴 `dispatch_unsafe` no dice "Lusha la recibio". Dice "SellUp no puede probar
-- que no". Si el proceso muere aqui y el byte nunca salio, la peticion queda
-- suprimida sin haber costado nada: se pierde COMPLETITUD para no volver a pagar.

CREATE OR REPLACE FUNCTION public.mark_lusha_prospecting_request_dispatched(
  p_fence_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $mark$
DECLARE
  v_updated integer;
  v_state   text;
BEGIN
  IF p_fence_key IS NULL OR btrim(p_fence_key) = '' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  UPDATE public.lusha_prospecting_request_fence
  SET state = 'dispatch_unsafe',
      dispatched_at = now(),
      updated_at = now()
  WHERE fence_key = p_fence_key
    AND state = 'prepared';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RETURN jsonb_build_object('status', 'marked', 'state', 'dispatch_unsafe');
  END IF;

  SELECT state INTO v_state
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key;

  RETURN jsonb_build_object('status', 'not_claimable', 'state', v_state);
END;
$mark$;

-- ============================================================
-- 8. settle_lusha_prospecting_request
-- ============================================================
--
-- Graba el desenlace TERMINAL derivado de la taxonomia de CUT-L2. Transiciona
-- desde `prepared` (rechazo local probado antes del envio) o desde
-- `dispatch_unsafe` (la peticion salio). Una fila ya terminal NO se reescribe:
-- la primera liquidacion manda, y una segunda solo podria degradar la verdad.
--
-- La evidencia llega en `p_evidence` como jsonb con claves conocidas. Cualquier
-- clave que no este en esta lista se IGNORA: es la forma de que el runtime no
-- pueda colar payload del proveedor en una tabla que no debe tenerlo.

CREATE OR REPLACE FUNCTION public.settle_lusha_prospecting_request(
  p_fence_key text,
  p_state     text,
  p_evidence  jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $settle$
DECLARE
  v_updated integer;
  v_state   text;
  v_ev      jsonb := coalesce(p_evidence, '{}'::jsonb);
BEGIN
  IF p_fence_key IS NULL OR btrim(p_fence_key) = '' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  IF p_state IS NULL OR p_state NOT IN (
    'succeeded', 'definitely_not_charged', 'indeterminate', 'unknown'
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_state');
  END IF;

  -- Un EXITO exige despacho. Liquidar 'succeeded' sobre una fila que nunca marco
  -- la frontera afirmaria una respuesta de proveedor que este proceso no pudo
  -- haber recibido; se rechaza en vez de escribirla.
  SELECT state INTO v_state
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key;

  IF v_state IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_state = 'prepared' AND p_state = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'invalid_transition', 'state', v_state);
  END IF;

  UPDATE public.lusha_prospecting_request_fence
  SET state               = p_state,
      outcome_class       = nullif(v_ev ->> 'outcome_class', ''),
      billing_certainty   = nullif(v_ev ->> 'billing_certainty', ''),
      retry_contract      = nullif(v_ev ->> 'retry_contract', ''),
      http_status         = (nullif(v_ev ->> 'http_status', ''))::integer,
      provider_request_id = nullif(v_ev ->> 'provider_request_id', ''),
      credits_charged     = (nullif(v_ev ->> 'credits_charged', ''))::numeric,
      results_returned    = (nullif(v_ev ->> 'results_returned', ''))::integer,
      rate_limit_minute_limit     = (nullif(v_ev ->> 'rate_limit_minute_limit', ''))::integer,
      rate_limit_minute_remaining = (nullif(v_ev ->> 'rate_limit_minute_remaining', ''))::integer,
      rate_limit_daily_limit      = (nullif(v_ev ->> 'rate_limit_daily_limit', ''))::integer,
      rate_limit_daily_remaining  = (nullif(v_ev ->> 'rate_limit_daily_remaining', ''))::integer,
      settled_at          = now(),
      updated_at          = now()
  WHERE fence_key = p_fence_key
    AND state IN ('prepared', 'dispatch_unsafe');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RETURN jsonb_build_object('status', 'settled', 'state', p_state);
  END IF;

  SELECT state INTO v_state
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key;

  IF v_state IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object('status', 'already_terminal', 'state', v_state);
END;
$settle$;

-- ============================================================
-- 9. GRANTS de las funciones — estado final declarativo
-- ============================================================
--
-- Solo `service_role`. Ni `anon` ni `authenticated` pueden reclamar, marcar ni
-- liquidar una valla: eso permitiria a un cliente de sesion fabricar el estado
-- que autoriza (o suprime) una peticion pagada.

REVOKE ALL ON FUNCTION public.claim_or_resume_lusha_prospecting_operation(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_or_resume_lusha_prospecting_operation(text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_or_resume_lusha_prospecting_operation(text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_or_resume_lusha_prospecting_operation(text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_lusha_prospecting_operation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_lusha_prospecting_operation(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_lusha_prospecting_operation(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_lusha_prospecting_operation(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_lusha_prospecting_request(text, uuid, integer, integer, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_lusha_prospecting_request(text, uuid, integer, integer, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_lusha_prospecting_request(text, uuid, integer, integer, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lusha_prospecting_request(text, uuid, integer, integer, text, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_lusha_prospecting_request_dispatched(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_lusha_prospecting_request_dispatched(text) FROM anon;
REVOKE ALL ON FUNCTION public.mark_lusha_prospecting_request_dispatched(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_lusha_prospecting_request_dispatched(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.settle_lusha_prospecting_request(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_lusha_prospecting_request(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.settle_lusha_prospecting_request(text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_lusha_prospecting_request(text, text, jsonb)
  TO service_role;

COMMENT ON TABLE public.lusha_prospecting_request_fence IS
  'AGENT1-LUSHA-CUT-L3. Una fila por peticion logica de Lusha Company Prospecting. Se escribe ANTES del envio para que una caida dura no pueda repetir una peticion que el proveedor quiza ya cobro. Sin payload de proveedor.';
