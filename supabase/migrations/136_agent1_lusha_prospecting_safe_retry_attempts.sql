-- Migration 136 — AGENT1-LUSHA-CUT-L4: historial DURABLE de INTENTOS y el
-- reclamo atomico de UN reintento seguro.
--
-- ============================================================================
-- POR QUE EXISTE
-- ============================================================================
--
-- CUT-L2 obtuvo del soporte HUMANO de Lusha un contrato de facturacion explicito
-- para `POST /v3/companies/prospecting`:
--
--     429  -> 0 creditos -> seguro de reintentar POR CONTRATO
--     5xx  -> 0 creditos -> seguro de reintentar POR CONTRATO
--     499 / timeout / 4xx generico / 2xx ilegible -> PUDO cobrarse -> NO
--
-- CUT-L3 puso la valla durable que impide que una caida dura vuelva a comprar la
-- misma pagina, y lo hizo con una regla deliberadamente absoluta:
--
--     existe fila de valla -> NUNCA se re-ejecuta
--
-- Esa regla es correcta para CUT-L3 y sigue siendolo. Lo que NO se puede hacer
-- para habilitar el reintento es ablandarla: cambiar
-- `mayReExecuteLushaFencedRequest()` a `true` borraria la evidencia del intento 1
-- —la fila es UNA— y reabriria la carrera que CUT-L3 cerro.
--
-- De ahi esta migracion. UNA peticion logica deja de ser UNA fila y pasa a ser:
--
--     peticion logica (valla, 135)
--       -> intento 1
--       -> intento 2   (como maximo, y solo si el 1 PROBO 0 creditos)
--
-- Cada intento es UN despacho HTTP posible y tiene su propia evidencia durable.
-- El intento 1 NO se sobrescribe cuando arranca el 2.
--
-- ============================================================================
-- LO QUE ESTA MIGRACION NO HACE
-- ============================================================================
--
--   * NO reescribe la 135. La 135 esta MERGEADA en main y es inmutable. Aqui se
--     REEMPLAZAN sus funciones por versiones conscientes del intento —misma
--     FIRMA, asi que un despliegue viejo sigue llamandolas sin romperse— y se
--     ANADEN dos columnas de proyeccion a su tabla.
--   * NO amplia el contrato de reintento. Solo `http_429_rate_limited` y
--     `http_5xx_provider_failure` autorizan un intento 2. `499`, timeout,
--     `4xx` generico, `2xx` malformado y el rechazo local PRE-envio NO.
--   * NO permite un intento 3. El techo es de ESQUEMA (CHECK) y ademas de
--     RUNTIME (la RPC de reclamo). Dos guardas independientes a proposito.
--   * NO enciende Lusha, ni ningun flag. Es esquema.
--   * NO toca presupuesto, ni page size, ni tope de paginas, ni objetivo, ni
--     techo de reserva. Un reintento solo se autoriza DESPUES de que el
--     proveedor probara 0 creditos, asi que no hay credito nuevo que reservar.
--   * NO guarda payload del proveedor: ni empresas, ni dominios, ni nombres, ni
--     la clave de API. Solo estado, cifras de facturacion e ids internos.
--   * NO concede DELETE ni TRUNCATE a nadie. El historial de intentos es
--     EVIDENCIA ECONOMICA: un historial que el runtime puede borrar no es
--     evidencia, es una sugerencia.
--
-- APLICADA EN PRODUCCION = NO. Se entrega sin aplicar. Cuando la 136 no existe,
-- el runtime NO puede reclamar reintento (SQLSTATE 42883 / PostgREST PGRST202 ->
-- `capability_absent`) y CUT-L4 se degrada exactamente a CUT-L3: primer intento
-- vallado, cero reintentos. Nunca a un segundo `fetch()` sin valla.

-- ============================================================
-- 1. Proyeccion de "ultimo intento" sobre la valla de la 135
-- ============================================================
--
-- La valla sigue siendo la autoridad de la PETICION LOGICA —una fila, una pagina
-- pagada— y sigue siendo la que consultan `complete_lusha_prospecting_operation`
-- y todo el codigo de CUT-L3. Lo que cambia es lo que su columna `state`
-- SIGNIFICA: pasa de "el desenlace de la unica llamada" a "el desenlace del
-- ULTIMO intento".
--
-- 🔴 Que la proyeccion se reinicie a `prepared` cuando arranca el intento 2 NO
-- destruye nada: la evidencia del intento 1 vive INMUTABLE en
-- `lusha_prospecting_request_attempts`, que es la autoridad del historial. Lo que
-- se reinicia es la VISTA, no el hecho.

ALTER TABLE public.lusha_prospecting_request_fence
  ADD COLUMN IF NOT EXISTS latest_attempt_no integer NOT NULL DEFAULT 1;

ALTER TABLE public.lusha_prospecting_request_fence
  ADD COLUMN IF NOT EXISTS attempts_used integer NOT NULL DEFAULT 1;

DO $add_attempt_checks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lusha_prospecting_request_fence_latest_attempt_check'
  ) THEN
    ALTER TABLE public.lusha_prospecting_request_fence
      ADD CONSTRAINT lusha_prospecting_request_fence_latest_attempt_check
      CHECK (latest_attempt_no >= 1 AND latest_attempt_no <= 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lusha_prospecting_request_fence_attempts_used_check'
  ) THEN
    ALTER TABLE public.lusha_prospecting_request_fence
      ADD CONSTRAINT lusha_prospecting_request_fence_attempts_used_check
      CHECK (attempts_used >= 1 AND attempts_used <= 2 AND attempts_used >= latest_attempt_no);
  END IF;
END
$add_attempt_checks$;

COMMENT ON COLUMN public.lusha_prospecting_request_fence.latest_attempt_no IS
  'AGENT1-LUSHA-CUT-L4. Numero del intento que la columna `state` PROYECTA. El historial completo e inmutable vive en lusha_prospecting_request_attempts.';

-- ============================================================
-- 2. lusha_prospecting_request_attempts — EL HISTORIAL INMUTABLE
-- ============================================================
--
-- Una fila = UN despacho HTTP posible al proveedor.
--
-- POR QUE UNA TABLA APARTE Y NO MAS COLUMNAS EN LA VALLA:
--
--   1. Cardinalidad. Un intento no es un atributo de la peticion, es una
--      OCURRENCIA. Aplanar dos ocurrencias en columnas `*_1` / `*_2` habria
--      convertido el techo de intentos en una propiedad del ancho de la fila.
--   2. INMUTABILIDAD. La regla del corte es que el intento 1 no se puede pisar.
--      Con una fila por intento eso lo garantiza la PRIMARY KEY y un UPDATE
--      acotado por `attempt_no`; con columnas aplanadas lo garantizaria la
--      disciplina de quien escriba el UPDATE, que no es una garantia.
--   3. ATOMICIDAD del reclamo. "Exactamente un trabajador crea el intento 2" es
--      una afirmacion sobre un INSERT unico, no sobre un merge de columnas.
--
-- NO guarda payload del proveedor. La tabla no tiene donde ponerlo, y eso es
-- parte de lo que la suite de PostgreSQL real comprueba.

CREATE TABLE IF NOT EXISTS public.lusha_prospecting_request_attempts (
  -- La peticion LOGICA a la que pertenece el intento. FK SIN cascada: borrar una
  -- valla no puede llevarse por delante la evidencia de gasto de sus intentos.
  fence_key           text        NOT NULL
    REFERENCES public.lusha_prospecting_request_fence(fence_key),
  -- 🔴 EL TECHO, en el ESQUEMA. CUT-L4 permite como maximo DOS intentos por
  -- peticion logica: el original y UN reintento. Subirlo exige una migracion
  -- nueva y deliberada — no un cambio de constante en TypeScript.
  attempt_no          integer     NOT NULL
    CONSTRAINT lusha_prospecting_request_attempts_attempt_no_check
    CHECK (attempt_no >= 1 AND attempt_no <= 2),
  provider            text        NOT NULL DEFAULT 'lusha'
    CONSTRAINT lusha_prospecting_request_attempts_provider_check
    CHECK (provider = 'lusha'),
  -- Se DESNORMALIZA a proposito desde la valla: la RPC de cierre de operacion
  -- cuenta intentos sin resolver por operacion, y hacerlo con un JOIN habria
  -- puesto la correccion del cierre a merced del plan del planificador.
  operation_id        uuid        NOT NULL
    REFERENCES public.lusha_prospecting_operations(operation_id),
  branch_index        integer     NOT NULL
    CONSTRAINT lusha_prospecting_request_attempts_branch_check CHECK (branch_index >= 0),
  page_index          integer     NOT NULL
    CONSTRAINT lusha_prospecting_request_attempts_page_check CHECK (page_index >= 0),
  -- El MISMO vocabulario que la valla de CUT-L3. Que sea el mismo no es economia
  -- de tipos: es que un intento y una peticion de un solo intento son el mismo
  -- hecho, y darles dos vocabularios habria obligado a traducir en cada lectura.
  state               text        NOT NULL
    CONSTRAINT lusha_prospecting_request_attempts_state_check
    CHECK (state IN (
      'prepared',
      'dispatch_unsafe',
      'succeeded',
      'definitely_not_charged',
      'indeterminate',
      'unknown'
    )),

  -- Evidencia del desenlace de ESTE intento. Toda NULL mientras no sea terminal.
  outcome_class       text        NULL,
  billing_certainty   text        NULL
    CONSTRAINT lusha_prospecting_request_attempts_billing_check
    CHECK (billing_certainty IS NULL OR billing_certainty IN (
      'definitely_not_charged',
      'potentially_charged',
      'settled_from_provider',
      'unknown'
    )),
  retry_contract      text        NULL,
  http_status         integer     NULL,
  -- `x-request-id` del SERVIDOR de Lusha, de ESTE intento. Que el del intento 2
  -- sea DISTINTO del del 1 es esperado y correcto: son dos peticiones HTTP.
  -- TRAZA. Nunca clave, nunca idempotencia, nunca autoridad de replay.
  provider_request_id text        NULL,
  credits_charged     numeric     NULL,
  results_returned    integer     NULL,

  -- Instantanea de cuota de los CUATRO headers que Lusha si envia (CUT-L2). Cada
  -- intento tiene la SUYA: el intento 2 ocurre un segundo despues y su cuota
  -- restante es otra.
  rate_limit_minute_limit     integer NULL,
  rate_limit_minute_remaining integer NULL,
  rate_limit_daily_limit      integer NULL,
  rate_limit_daily_remaining  integer NULL,

  prepared_at         timestamptz NOT NULL DEFAULT now(),
  -- Instante en que ESTE intento cruzo la frontera. NO afirma que Lusha lo
  -- recibiera: afirma que SellUp ya no puede probar que no.
  dispatched_at       timestamptz NULL,
  settled_at          timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- 🔴 LA UNICIDAD DEL INTENTO. Dos trabajadores que corran a reclamar el intento
  -- 2 de la misma peticion compiten AQUI, en el indice, y solo uno gana. Un
  -- `SELECT` seguido de `INSERT` habria dejado la carrera abierta y con ella dos
  -- llamadas HTTP de reintento.
  PRIMARY KEY (fence_key, attempt_no),

  -- Coherencia de tupla, identica en espiritu a la de la 135.
  CONSTRAINT lusha_prospecting_request_attempts_dispatch_tuple_check CHECK (
    (state = 'prepared' AND dispatched_at IS NULL AND settled_at IS NULL)
    OR (state = 'dispatch_unsafe' AND dispatched_at IS NOT NULL AND settled_at IS NULL)
    OR (state IN ('succeeded', 'definitely_not_charged', 'indeterminate', 'unknown')
        AND settled_at IS NOT NULL)
  ),
  CONSTRAINT lusha_prospecting_request_attempts_success_dispatch_check CHECK (
    state <> 'succeeded' OR dispatched_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_request_attempts_operation
  ON public.lusha_prospecting_request_attempts (operation_id);

-- Intentos que quedaron sin liquidar: la cola de revision HUMANA.
CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_request_attempts_unsettled
  ON public.lusha_prospecting_request_attempts (prepared_at DESC)
  WHERE state IN ('prepared', 'dispatch_unsafe');

ALTER TABLE public.lusha_prospecting_request_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_lusha_prospecting_request_attempts_all"
  ON public.lusha_prospecting_request_attempts;
CREATE POLICY "service_role_lusha_prospecting_request_attempts_all"
  ON public.lusha_prospecting_request_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Estado final declarativo. Supabase concede los 8 privilegios por DEFAULT
-- PRIVILEGES, asi que hay que REVOCAR antes de conceder: un GRANT solo SUMA.
REVOKE ALL ON TABLE public.lusha_prospecting_request_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.lusha_prospecting_request_attempts FROM anon;
REVOKE ALL ON TABLE public.lusha_prospecting_request_attempts FROM authenticated;
REVOKE ALL ON TABLE public.lusha_prospecting_request_attempts FROM service_role;
-- Sin DELETE y sin TRUNCATE ni siquiera para `service_role`.
GRANT SELECT, INSERT, UPDATE ON TABLE public.lusha_prospecting_request_attempts
  TO service_role;

COMMENT ON TABLE public.lusha_prospecting_request_attempts IS
  'AGENT1-LUSHA-CUT-L4. Historial INMUTABLE de despachos posibles al proveedor por peticion logica de Lusha Company Prospecting. Como maximo dos intentos: el original y UN reintento, y solo cuando el anterior PROBO 0 creditos (429 / 5xx). Sin payload de proveedor.';

-- ============================================================
-- 3. BACKFILL — el intento 1 de las vallas que ya existan
-- ============================================================
--
-- La 135 se entrega sin aplicar y Lusha no esta activado, asi que en la practica
-- no hay filas. Eso NO autoriza a escribir una migracion que dependa de que la
-- tabla este vacia: la correccion de un backfill no puede ser una suposicion
-- sobre el estado de Produccion.
--
-- IDEMPOTENTE (`ON CONFLICT DO NOTHING`), DETERMINISTA (todo sale de la propia
-- fila de valla, sin relojes nuevos ni aleatoriedad) y NO DESTRUCTIVO (no borra,
-- no reescribe, no toca la valla). Cero llamadas al proveedor.

INSERT INTO public.lusha_prospecting_request_attempts (
  fence_key, attempt_no, provider, operation_id, branch_index, page_index, state,
  outcome_class, billing_certainty, retry_contract, http_status, provider_request_id,
  credits_charged, results_returned,
  rate_limit_minute_limit, rate_limit_minute_remaining,
  rate_limit_daily_limit, rate_limit_daily_remaining,
  prepared_at, dispatched_at, settled_at, created_at, updated_at
)
SELECT
  f.fence_key, 1, 'lusha', f.operation_id, f.branch_index, f.page_index, f.state,
  f.outcome_class, f.billing_certainty, f.retry_contract, f.http_status, f.provider_request_id,
  f.credits_charged, f.results_returned,
  f.rate_limit_minute_limit, f.rate_limit_minute_remaining,
  f.rate_limit_daily_limit, f.rate_limit_daily_remaining,
  f.claimed_at, f.dispatched_at, f.settled_at, f.created_at, f.updated_at
FROM public.lusha_prospecting_request_fence f
ON CONFLICT (fence_key, attempt_no) DO NOTHING;

-- ============================================================
-- 4. claim_lusha_prospecting_request — REEMPLAZO consciente del intento
-- ============================================================
--
-- MISMA FIRMA que en la 135, a proposito: un despliegue de la aplicacion ANTERIOR
-- a CUT-L4 corriendo contra una base CON la 136 sigue llamando exactamente a esta
-- funcion y sigue obteniendo el comportamiento de CUT-L3 — solo que ahora tambien
-- deja escrito su intento 1. Reemplazar en vez de anadir una funcion nueva es lo
-- que impide que existan dos caminos de reclamo, uno de los cuales no registraria
-- intentos.
--
-- 🔴 DOS CAMBIOS, y los dos son de seguridad:
--
--   1. `SELECT ... FOR UPDATE` sobre la fila de la OPERACION. La 135 solo
--      comprobaba con `EXISTS` que la operacion siguiera abierta, y eso deja
--      abierta la carrera que CUT-L3 dejo anotada como deuda: el cierre de la
--      operacion podia colarse entre la comprobacion y el INSERT. Con CUT-L4 esa
--      carrera deja de ser teorica —el reclamo de reintento ocurre DESPUES de que
--      la corrida crea haber terminado la pagina— asi que se cierra aqui: el
--      reclamo y el cierre serializan sobre la MISMA fila.
--   2. El INSERT del intento 1 ocurre en la MISMA transaccion que el de la valla.
--      Una valla sin intento seria una peticion sin historial, es decir el unico
--      estado desde el que la RPC de reintento no puede decidir nada.

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
  v_op_state text;
BEGIN
  IF p_fence_key IS NULL OR btrim(p_fence_key) = ''
     OR p_operation_id IS NULL
     OR p_branch_index IS NULL OR p_branch_index < 0
     OR p_page_index IS NULL OR p_page_index < 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  -- 🔴 EL PUNTO DE SERIALIZACION. Bloquear la operacion aqui es lo que hace
  -- imposible que un cierre y un reclamo se crucen: quien llegue segundo espera.
  SELECT state INTO v_op_state
  FROM public.lusha_prospecting_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF v_op_state IS NULL OR v_op_state NOT IN ('open', 'reconciliation_required') THEN
    RETURN jsonb_build_object('status', 'operation_not_open');
  END IF;

  INSERT INTO public.lusha_prospecting_request_fence (
    fence_key, provider, state, operation_id, client_request_id,
    branch_index, page_index, triggered_by, reservation_id,
    latest_attempt_no, attempts_used
  )
  VALUES (
    p_fence_key, 'lusha', 'prepared', p_operation_id,
    nullif(btrim(coalesce(p_client_request_id, '')), ''),
    p_branch_index, p_page_index, p_triggered_by, p_reservation_id,
    1, 1
  )
  ON CONFLICT (fence_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    INSERT INTO public.lusha_prospecting_request_attempts (
      fence_key, attempt_no, provider, operation_id, branch_index, page_index, state
    )
    VALUES (
      p_fence_key, 1, 'lusha', p_operation_id, p_branch_index, p_page_index, 'prepared'
    )
    ON CONFLICT (fence_key, attempt_no) DO NOTHING;

    RETURN jsonb_build_object('status', 'claimed', 'state', 'prepared', 'attempt_no', 1);
  END IF;

  SELECT state INTO v_state
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key;

  RETURN jsonb_build_object('status', 'already_claimed', 'state', v_state);
END;
$claim$;

-- ============================================================
-- 5. mark_lusha_prospecting_request_dispatched — marca valla E intento
-- ============================================================
--
-- LA FRONTERA, ahora por intento. Misma firma que en la 135 y mismo contrato de
-- salida; lo que cambia es que la marca cae sobre la valla Y sobre la fila del
-- intento vigente, en la MISMA transaccion.
--
-- 🔴 O se marcan las dos o no se marca ninguna. Una valla marcada con su intento
-- en `prepared` diria dos cosas contradictorias sobre el mismo despacho, y la
-- de reintento leeria la equivocada.

CREATE OR REPLACE FUNCTION public.mark_lusha_prospecting_request_dispatched(
  p_fence_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $mark$
DECLARE
  v_state       text;
  v_attempt_no  integer;
  v_att_state   text;
BEGIN
  IF p_fence_key IS NULL OR btrim(p_fence_key) = '' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT state, latest_attempt_no INTO v_state, v_attempt_no
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key
  FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN jsonb_build_object('status', 'not_claimable', 'state', NULL);
  END IF;

  IF v_state <> 'prepared' THEN
    RETURN jsonb_build_object('status', 'not_claimable', 'state', v_state);
  END IF;

  SELECT state INTO v_att_state
  FROM public.lusha_prospecting_request_attempts
  WHERE fence_key = p_fence_key AND attempt_no = v_attempt_no
  FOR UPDATE;

  -- Sin intento vigente en `prepared` NO se marca nada. Fallo CERRADO: el
  -- llamador aborta el envio, que es la direccion que no cuesta dinero.
  IF v_att_state IS NULL OR v_att_state <> 'prepared' THEN
    RETURN jsonb_build_object('status', 'not_claimable', 'state', coalesce(v_att_state, v_state));
  END IF;

  UPDATE public.lusha_prospecting_request_attempts
  SET state = 'dispatch_unsafe', dispatched_at = now(), updated_at = now()
  WHERE fence_key = p_fence_key AND attempt_no = v_attempt_no;

  UPDATE public.lusha_prospecting_request_fence
  SET state = 'dispatch_unsafe', dispatched_at = now(), updated_at = now()
  WHERE fence_key = p_fence_key;

  RETURN jsonb_build_object(
    'status', 'marked', 'state', 'dispatch_unsafe', 'attempt_no', v_attempt_no
  );
END;
$mark$;

-- ============================================================
-- 6. settle_lusha_prospecting_request — liquida valla E intento
-- ============================================================
--
-- Misma firma y mismo contrato de salida que en la 135. La evidencia se escribe
-- en la fila del intento vigente —donde queda INMUTABLE— y se PROYECTA sobre la
-- valla para que todo el codigo de CUT-L3 siga leyendo lo que ya leia.

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
  v_state      text;
  v_attempt_no integer;
  v_updated    integer;
  v_ev         jsonb := coalesce(p_evidence, '{}'::jsonb);
BEGIN
  IF p_fence_key IS NULL OR btrim(p_fence_key) = '' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  IF p_state IS NULL OR p_state NOT IN (
    'succeeded', 'definitely_not_charged', 'indeterminate', 'unknown'
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_state');
  END IF;

  SELECT state, latest_attempt_no INTO v_state, v_attempt_no
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key
  FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Un EXITO exige despacho: liquidar 'succeeded' sobre una fila que nunca marco
  -- la frontera afirmaria una respuesta que este proceso no pudo haber recibido.
  IF v_state = 'prepared' AND p_state = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'invalid_transition', 'state', v_state);
  END IF;

  IF v_state NOT IN ('prepared', 'dispatch_unsafe') THEN
    RETURN jsonb_build_object('status', 'already_terminal', 'state', v_state);
  END IF;

  -- 🔴 El intento se liquida ACOTADO por `attempt_no` y solo desde no-terminal.
  -- Ese `AND state IN (...)` es lo que impide que una liquidacion tardia del
  -- intento 1 pise la del intento 2 — y viceversa.
  UPDATE public.lusha_prospecting_request_attempts
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
    AND attempt_no = v_attempt_no
    AND state IN ('prepared', 'dispatch_unsafe');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RETURN jsonb_build_object('status', 'already_terminal', 'state', v_state);
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
  WHERE fence_key = p_fence_key;

  RETURN jsonb_build_object('status', 'settled', 'state', p_state, 'attempt_no', v_attempt_no);
END;
$settle$;

-- ============================================================
-- 7. claim_lusha_prospecting_retry_attempt — LA CAPACIDAD NUEVA
-- ============================================================
--
-- El reclamo ATOMICO de UN reintento seguro. Es lo unico que CUT-L4 anade a la
-- superficie de escritura, y hace las seis cosas del § 16 en UNA transaccion:
--
--   1. bloquea la operacion (serializa contra el cierre);
--   2. bloquea la valla y lee el ULTIMO intento durable;
--   3. verifica la elegibilidad CONTRA LA EVIDENCIA, no contra memoria;
--   4. verifica el techo de intentos;
--   5. crea EXACTAMENTE un intento siguiente;
--   6. devuelve la autorizacion.
--
-- ── LA ELEGIBILIDAD, LITERAL ────────────────────────────────────────────────
--
--     state             = definitely_not_charged
--     billing_certainty = definitely_not_charged
--     retry_contract    = retryable_by_contract
--     outcome_class     IN (http_429_rate_limited, http_5xx_provider_failure)
--     attempt_no        < 2
--
-- Las cuatro primeras son redundantes ENTRE SI mientras la taxonomia de CUT-L2 se
-- mantenga coherente, y por eso se exigen las cuatro: si un dia una de ellas se
-- escribiera mal, las otras tres bloquean. Redundancia deliberada en el lado que
-- cuesta dinero.
--
-- 🔴 `local_pre_dispatch_failure` NO entra, y no es un olvido. Su
-- `billing_certainty` es `definitely_not_charged` de verdad —la peticion nunca
-- salio— pero CUT-L4 se limita a lo que el proveedor CONFIRMO: 429 y 5xx. Un
-- rechazo local es un fallo de SellUp, y reintentarlo automaticamente repetiria
-- el mismo fallo mientras la causa siga ahi. Ampliar el alcance es otro corte.
--
-- 🔴 Que el intento 2 reinicie la PROYECCION de la valla a `prepared` es lo que
-- permite que el resto del sistema —marca, liquidacion, cierre— siga funcionando
-- sin saber que existen los intentos. La evidencia del intento 1 NO se toca.

CREATE OR REPLACE FUNCTION public.claim_lusha_prospecting_retry_attempt(
  p_fence_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $retry$
DECLARE
  v_operation_id  uuid;
  v_op_state      text;
  v_branch        integer;
  v_page          integer;
  v_last_no       integer;
  v_last_state    text;
  v_last_billing  text;
  v_last_contract text;
  v_last_class    text;
  v_next_no       integer;
  v_inserted      integer;
BEGIN
  IF p_fence_key IS NULL OR btrim(p_fence_key) = '' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT operation_id INTO v_operation_id
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key;

  IF v_operation_id IS NULL THEN
    RETURN jsonb_build_object('status', 'fence_not_found');
  END IF;

  -- 🔴 EL MISMO PUNTO DE SERIALIZACION que el reclamo inicial y que el cierre.
  -- Con esto, "operacion cerrada + intento 2 despachado" deja de ser un estado
  -- alcanzable: quien llegue segundo encuentra la decision del primero ya escrita.
  SELECT state INTO v_op_state
  FROM public.lusha_prospecting_operations
  WHERE operation_id = v_operation_id
  FOR UPDATE;

  IF v_op_state IS NULL OR v_op_state NOT IN ('open', 'reconciliation_required') THEN
    RETURN jsonb_build_object('status', 'operation_not_open', 'operation_state', v_op_state);
  END IF;

  SELECT branch_index, page_index INTO v_branch, v_page
  FROM public.lusha_prospecting_request_fence
  WHERE fence_key = p_fence_key
  FOR UPDATE;

  SELECT attempt_no, state, billing_certainty, retry_contract, outcome_class
  INTO v_last_no, v_last_state, v_last_billing, v_last_contract, v_last_class
  FROM public.lusha_prospecting_request_attempts
  WHERE fence_key = p_fence_key
  ORDER BY attempt_no DESC
  LIMIT 1;

  -- Sin historial no hay nada sobre lo que decidir. Fallo CERRADO.
  IF v_last_no IS NULL THEN
    RETURN jsonb_build_object('status', 'no_attempt_history');
  END IF;

  IF v_last_state <> 'definitely_not_charged'
     OR v_last_billing IS DISTINCT FROM 'definitely_not_charged'
     OR v_last_contract IS DISTINCT FROM 'retryable_by_contract'
     OR v_last_class IS NULL
     OR v_last_class NOT IN ('http_429_rate_limited', 'http_5xx_provider_failure') THEN
    RETURN jsonb_build_object(
      'status', 'not_retryable',
      'state', v_last_state,
      'outcome_class', v_last_class,
      'attempt_no', v_last_no
    );
  END IF;

  v_next_no := v_last_no + 1;

  -- EL TECHO, en el runtime de la BASE. El CHECK de la tabla lo repite; que
  -- ambos existan es a proposito: un solo guardia no es un techo, es una opinion.
  IF v_next_no > 2 THEN
    RETURN jsonb_build_object(
      'status', 'attempts_exhausted', 'attempt_no', v_last_no, 'max_attempts', 2
    );
  END IF;

  INSERT INTO public.lusha_prospecting_request_attempts (
    fence_key, attempt_no, provider, operation_id, branch_index, page_index, state
  )
  VALUES (
    p_fence_key, v_next_no, 'lusha', v_operation_id, v_branch, v_page, 'prepared'
  )
  ON CONFLICT (fence_key, attempt_no) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Otro trabajador gano la carrera. NO se despacha: exactamente una llamada HTTP
  -- de reintento por peticion logica.
  IF v_inserted <> 1 THEN
    RETURN jsonb_build_object('status', 'already_claimed', 'attempt_no', v_next_no);
  END IF;

  -- La PROYECCION vuelve a `prepared`. El historial del intento 1 sigue intacto en
  -- `lusha_prospecting_request_attempts`; lo que se reinicia es la vista.
  UPDATE public.lusha_prospecting_request_fence
  SET state               = 'prepared',
      latest_attempt_no   = v_next_no,
      attempts_used       = v_next_no,
      dispatched_at       = NULL,
      settled_at          = NULL,
      outcome_class       = NULL,
      billing_certainty   = NULL,
      retry_contract      = NULL,
      http_status         = NULL,
      provider_request_id = NULL,
      credits_charged     = NULL,
      results_returned    = NULL,
      rate_limit_minute_limit     = NULL,
      rate_limit_minute_remaining = NULL,
      rate_limit_daily_limit      = NULL,
      rate_limit_daily_remaining  = NULL,
      updated_at          = now()
  WHERE fence_key = p_fence_key;

  RETURN jsonb_build_object('status', 'claimed', 'attempt_no', v_next_no, 'state', 'prepared');
END;
$retry$;

-- ============================================================
-- 8. complete_lusha_prospecting_operation — cierre consciente del intento
-- ============================================================
--
-- Misma firma y mismo espiritu que en la 135: la operacion NO cierra si queda
-- alguna peticion sin verdad de facturacion asentada. Lo que CUT-L4 anade es que
-- ahora tambien mira los INTENTOS.
--
-- 🔴 Por que no basta con la valla. Cuando el intento 2 esta EN VUELO, la valla
-- proyecta `prepared` y eso ya bloquearia. Pero la proyeccion es una comodidad y
-- podria cambiar; el historial es el hecho. Contar sobre las dos hace que el
-- cierre siga siendo correcto aunque la proyeccion se pierda, y cierra la mitad
-- que el § 17 pide: una operacion no puede completarse por encima de un intento
-- activo.
--
-- 🔴 `FOR UPDATE` sobre la operacion sigue siendo el punto de serializacion, el
-- MISMO que ahora toman el reclamo inicial y el de reintento.

CREATE OR REPLACE FUNCTION public.complete_lusha_prospecting_operation(
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $complete_op$
DECLARE
  v_state             text;
  v_unsettled         integer;
  v_unsettled_attempts integer;
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

  SELECT count(*) INTO v_unsettled_attempts
  FROM public.lusha_prospecting_request_attempts
  WHERE operation_id = p_operation_id
    AND state NOT IN ('succeeded', 'definitely_not_charged');

  IF v_unsettled > 0 OR v_unsettled_attempts > 0 THEN
    UPDATE public.lusha_prospecting_operations
    SET state = 'reconciliation_required',
        reconciliation_required_at = coalesce(reconciliation_required_at, now()),
        updated_at = now()
    WHERE operation_id = p_operation_id;

    RETURN jsonb_build_object(
      'status', 'blocked_unsettled_requests',
      'state', 'reconciliation_required',
      'unsettled', v_unsettled + v_unsettled_attempts
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
-- 9. GRANTS de las funciones — estado final declarativo
-- ============================================================
--
-- Solo `service_role`. Ni `anon` ni `authenticated` pueden reclamar un reintento:
-- eso permitiria a un cliente de sesion autorizarse una segunda llamada pagada.
--
-- Los REVOKE/GRANT de las funciones REEMPLAZADAS se repiten porque
-- `CREATE OR REPLACE` conserva los privilegios existentes, pero esta migracion
-- tiene que ser correcta tambien sobre una base donde la 135 se hubiera aplicado
-- a medias. Declarar el estado final es mas barato que razonar sobre el previo.

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

REVOKE ALL ON FUNCTION public.claim_lusha_prospecting_retry_attempt(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_lusha_prospecting_retry_attempt(text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_lusha_prospecting_retry_attempt(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lusha_prospecting_retry_attempt(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_lusha_prospecting_operation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_lusha_prospecting_operation(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_lusha_prospecting_operation(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_lusha_prospecting_operation(uuid)
  TO service_role;
