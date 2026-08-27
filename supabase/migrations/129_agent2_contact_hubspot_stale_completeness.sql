-- Migración 129 — AGENT2-CONTACT-HUBSPOT-STALE-COMPLETENESS-CUT3A
-- (Agente 2A · cierra los dos huecos de seguimiento que CUT-2 dejó abiertos y declarados)
--
-- ═══════════════════════════════════════════════════════════════════
-- ⚠️ NUMERADA, Y NO APLICADA EN NINGUNA PARTE
-- ═══════════════════════════════════════════════════════════════════
--
--   APPLIED IN PRODUCTION: NO
--   APPLIED REMOTE:        NO
--   LOCAL ONLY:            YES   (sólo el arnés PostgreSQL local la aplica)
--
-- AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 la CANONICALIZÓ. Nació sin número a propósito
-- —la numeración 125/126/127 estaba en disputa aguas arriba y elegir un prefijo habría sido
-- apostar sobre el orden final de una secuencia que aquella tarea no controlaba—. En concreto, el
-- 125 lo ocupaba entonces un archivo SIN RASTREAR de otra tarea. Esa disputa se cerró: 125, 126 y
-- 127 están resueltas en `main` y el techo desplegable quedó en la 128, así que el número libre ya
-- no es una apuesta sino un hecho comprobable, y esta migración lo toma.
--
-- Esta cabecera NO nombra el archivo de esa otra tarea, y es deliberado: la guarda de AUTORÍA de
-- la cadena de Brasil recorre el TEXTO COMPLETO de toda migración que no sea suya, así que una
-- mención en prosa —aunque fuera sólo histórica— la haría fallar por decir la verdad. La
-- explicación no necesita el nombre: el número basta, y no hay nada ejecutable aquí que toque
-- ninguna migración ajena ni ningún `\i` que la arrastre. Hay una prueba que verifica lo segundo.
--
-- LO QUE EL NÚMERO CAMBIA, DICHO SIN ADORNOS: al empezar por `\d{3}_` este archivo entra en la
-- secuencia desplegable y por tanto DENTRO de las guardas de techo del repositorio, que filtran
-- exactamente ese patrón. Ya no hay ningún fichero de migración fuera del radar: la barrida de
-- techo lo ve, lo cuenta y lo somete al mismo escrutinio que a las 128 anteriores. Numerar NO
-- la aplica: las tres líneas de estado de arriba siguen siendo la verdad, y aplicarla en remoto
-- exige autorización explícita de la dueña.
--
-- ORDEN: 129 < 130 < 131 < 132. El orden de aplicación es el NUMÉRICO, y ya no depende de una
-- propiedad accidental del alfabeto. Esta es la PRIMERA del tramo: depende sólo de que 115 y
-- 117 ya existan, y las dos están muy por debajo.
--
-- ═══════════════════════════════════════════════════════════════════
-- QUÉ CIERRA
-- ═══════════════════════════════════════════════════════════════════
--
-- CUT-2 dejó dos huecos por escrito, y los dos son la misma clase de fallo: la ficha de un
-- contacto sigue diciendo `synced` cuando ya no lo está.
--
--   1. El MERGE de un candidato duplicado (117) puede proyectar un teléfono sobre un contacto
--      YA vinculado a HubSpot. El escalar cambia; el estado durable no se entera. A partir de
--      ahí la ficha afirma que HubSpot está al día sobre un número que HubSpot no ha visto
--      nunca.
--
--   2. BORRAR el teléfono saliente no se podía representar. CUT-2 sabía enviar un número y no
--      sabía quitarlo, así que un saliente que caía a `NULL` no se marcaba —marcar habría sido
--      prometer una operación inejecutable—. CUT-3A construye la operación (el PATCH limpia la
--      propiedad) y con ella el silencio deja de ser prudencia: es la afirmación falsa más
--      grave del conjunto, porque el operador cree que el dato desapareció de todas partes
--      mientras HubSpot lo sigue sirviendo.
--
-- ═══════════════════════════════════════════════════════════════════
-- POR QUÉ DENTRO DE LA TRANSACCIÓN, Y NO EN UN SEGUNDO `.update(...)`
-- ═══════════════════════════════════════════════════════════════════
--
-- Una segunda escritura desde la aplicación —después de la RPC— dejaría una ventana en la que
-- el teléfono nuevo ya está guardado y el estado sigue diciendo `synced`. Esa ventana ES el
-- defecto, sólo que más corta. Y sobrevive a los fallos al revés de como debería: si la RPC
-- entra y la segunda escritura no, el sistema queda exactamente en el estado que este corte
-- existe para eliminar, pero ahora convencido de haberlo arreglado.
--
-- Por eso la transición vive en SQL, en la MISMA transacción que la proyección que la causa, y
-- por eso el trinquete que prohíbe una segunda escritura de contacto tras el merge sigue
-- siendo válido y sigue siendo el que hay que respetar.
--
-- ═══════════════════════════════════════════════════════════════════
-- QUÉ **NO** HACE
-- ═══════════════════════════════════════════════════════════════════
--
--   * NO llama a HubSpot. No puede: es un UPDATE de metadata dentro de una transacción SQL, sin
--     red alcanzable. Enviar sigue siendo un clic humano — no hay autosync en CUT-3A.
--   * NO exporta nada durante una supresión de privacidad. Marca que HubSpot está desactualizado
--     y ahí termina. Una DSAR no empuja datos a un tercero para corregir a ese tercero.
--   * NO escribe `contacts.mobile_phone`. La lee —el saliente es `mobile_phone ?? phone` y sin
--     ella no se puede saber si algo cambió para HubSpot— y `MOBILE_PHONE_PROVENANCE_PENDING`
--     (4O-E4.1) queda exactamente igual de abierto que antes.
--   * NO crea contactos, NO borra filas, NO levanta un tombstone, NO llama a ningún proveedor y
--     NO escribe contabilidad. Los cuerpos de 115 y 117 se re-emiten con los splices mínimos y
--     todo lo demás byte a byte.
--   * NO amplía el vocabulario más allá de UN miembro: `phone_removed`. Se descartó un estado
--     específico de privacidad porque habría sido una segunda forma de nombrar la MISMA
--     operación pendiente, y el ejecutor ya sabe hacer esa operación.
--
-- ═══════════════════════════════════════════════════════════════════
-- IDEMPOTENCIA
-- ═══════════════════════════════════════════════════════════════════
--
-- Todo es `CREATE OR REPLACE FUNCTION` y bloques REVOKE/GRANT declarativos. No hay DDL de
-- tablas, ni columnas, ni índices, ni constraints. Ninguna fila se migra: el estado durable de
-- los contactos existentes se queda como está y sólo cambia cuando un escritor lo toque.


-- ═══════════════════════════════════════════════════════════════════
-- 1. El teléfono SALIENTE — una sola definición
-- ═══════════════════════════════════════════════════════════════════
--
-- Espejo exacto de `resolveOutboundHubSpotPhone` (TypeScript). Existe una sola porque la usan a
-- la vez quien CONSTRUYE el payload de HubSpot y quien decide si el contacto quedó
-- desactualizado; si fueran dos, un día divergirían y el sistema marcaría «pendiente» un cambio
-- que el PATCH no envía —o callaría uno que sí envía.
--
-- `mobile_phone` manda sobre `phone`, y el vacío se trata como AUSENCIA: un `'   '` guardado por
-- un formulario no es un teléfono, y compararlo como si lo fuera marcaría cambios inexistentes.

CREATE OR REPLACE FUNCTION public.hubspot_outbound_phone(
  p_phone        text,
  p_mobile_phone text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT COALESCE(
    NULLIF(BTRIM(COALESCE(p_mobile_phone, '')), ''),
    NULLIF(BTRIM(COALESCE(p_phone, '')), '')
  );
$function$;

COMMENT ON FUNCTION public.hubspot_outbound_phone(text, text) IS
  'AGENT2-CONTACT-HUBSPOT-STALE-COMPLETENESS-CUT3A — EL teléfono que viaja a HubSpot: mobile_phone ?? phone, recortado, con el vacío tratado como ausencia. Espejo exacto de resolveOutboundHubSpotPhone en TypeScript. Pura: no lee tablas, no escribe y no conoce el reloj.';


-- ═══════════════════════════════════════════════════════════════════
-- 2. LA autoridad de la transición a `stale` (lado SQL)
-- ═══════════════════════════════════════════════════════════════════
--
-- Espejo de `markContactHubSpotSyncStaleForPhoneChange`. UNA sola, compartida por el merge (117)
-- y por la supresión de privacidad (115), porque los caminos que tocan el teléfono oficial son
-- varios y una copia de la regla por escritor acabaría con fichas que discrepan sobre si HubSpot
-- está al día.
--
-- ── LA REGLA, Y POR QUÉ CADA CLÁUSULA ────────────────────────────
-- Se marca SÓLO si se cumple todo:
--   * la fila tiene `hubspot_contact_id` — sin vínculo no hay nada en HubSpot que desactualizar;
--   * hay estado durable LEGIBLE — un bloque ausente o con un `status` fuera del vocabulario es
--     territorio de REPARACIÓN (CUT-1), no de `stale`: un estado desconocido no autoriza a
--     declarar que hay algo pendiente igual que no autoriza a enviar nada;
--   * el SALIENTE cambió de verdad. Se compara `mobile_phone ?? phone`, NO las columnas: ganar
--     un número secundario que no cambia el escalar saliente no cambia lo que HubSpot recibiría,
--     y marcarlo prometería una actualización que sería un no-op;
--   * el contacto llegó a estar `synced`. Un `never_attempted` o un `blocked_*` no puede quedar
--     «desactualizado»: nunca estuvo al día.
--
-- ── LA HORA SE CONSERVA; LA RAZÓN SE REDERIVA ────────────────────
-- Si ya había algo pendiente, `stale_since` NO se re-sella —es desde CUÁNDO HubSpot está
-- desactualizado, y un segundo cambio no lo pone al día— y el `status` NO se toca: un `failed`
-- sigue siendo `failed`, porque «el último intento falló» y «queda algo por enviar» son dos
-- hechos distintos y perder el primero borraría que alguien ya lo intentó.
--
-- La RAZÓN sí se recalcula sobre el saliente de AHORA, y no es un detalle: la razón no recuerda,
-- INSTRUYE. Un `phone_changed` que sobreviviera a un borrado posterior haría que el siguiente
-- clic enviara un número que SellUp ya no tiene; un `phone_removed` que sobreviviera a un número
-- nuevo haría que ese clic lo BORRARA en HubSpot. Las dos equivocaciones son escrituras reales
-- en el CRM del cliente, en direcciones opuestas.
--
-- ── PRECONDICIÓN DEL LLAMADOR ────────────────────────────────────
-- La fila de `contacts` debe estar YA bloqueada por el llamador (`SELECT … FOR UPDATE`), que es
-- el caso en 115 y en 117. Esta función no toma el lock: hacerlo aquí invertiría el orden
-- candidato → contacto → teléfonos que 112/115/116/117 comparten, que es lo único que impide
-- que dos de esas transacciones se abracen.
--
-- `search_path` incluye `public` a propósito, y no por descuido: las políticas RLS de `contacts`
-- se evalúan bajo el `search_path` de la función en ejecución, y varias de sus funciones de
-- apoyo son INVOKER con `proconfig = NULL` y nombres sin cualificar. Con `pg_catalog, pg_temp` a
-- secas ese UPDATE fallaría con 42P01 —el fallo que la corrección de la M126 documentó— y una
-- transición de estado no puede tumbar el merge ni la erasure que la contienen.

CREATE OR REPLACE FUNCTION public.mark_contact_hubspot_sync_stale_for_phone(
  p_contact_id       uuid,
  p_previous_outbound text,
  p_now              timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  -- El vocabulario CERRADO del estado, idéntico al de TypeScript. Un `status` fuera de esta
  -- lista NO se disfraza de conocido.
  c_statuses      text[] := ARRAY[
    'never_attempted', 'blocked_no_email', 'blocked_no_hubspot_company',
    'synced', 'stale', 'failed'
  ];
  -- El vocabulario CERRADO de razones. Exactamente dos, porque el PATCH sabe ejecutar
  -- exactamente dos operaciones: escribir el teléfono y borrarlo. Nada de texto libre.
  c_reasons       text[] := ARRAY['phone_changed', 'phone_removed'];

  v_row           RECORD;
  v_block         jsonb;
  v_status        text;
  v_prior_reason  text;
  v_after         text;
  v_reason        text;
BEGIN
  -- ⚠️ `stale_since` es una CADENA ISO-8601 EN UTC, y se construye a mano por una razón que un
  -- arnés real destapó: `to_jsonb(timestamptz)` renderiza en la ZONA HORARIA DE LA SESIÓN.
  -- El mismo instante producía `2026-08-12T07:00:00-05:00` aquí y `2026-08-12T12:00:00.000Z`
  -- desde TypeScript (`new Date().toISOString()`), es decir DOS representaciones del mismo
  -- campo durable según qué escritor lo tocó por última vez —y según la zona de la conexión,
  -- que ni siquiera es estable entre llamadas—. Ese es exactamente el defecto que toda esta
  -- línea de trabajo existe para eliminar, así que el formato se fija explícitamente.
  IF p_contact_id IS NULL OR p_now IS NULL THEN
    RETURN 'invalid_input';
  END IF;

  SELECT c.id, c.phone, c.mobile_phone, c.hubspot_contact_id, c.metadata
    INTO v_row
  FROM public.contacts c
  WHERE c.id = p_contact_id;

  IF NOT FOUND THEN
    RETURN 'contact_not_found';
  END IF;

  -- El vínculo se lee de la FILA, nunca del bloque: el bloque recuerda el id que un intento
  -- guardó, la fila dice si el vínculo existe hoy.
  IF NULLIF(BTRIM(COALESCE(v_row.hubspot_contact_id, '')), '') IS NULL THEN
    RETURN 'not_linked';
  END IF;

  v_block := v_row.metadata -> 'hubspot_sync';
  IF v_block IS NULL OR jsonb_typeof(v_block) <> 'object' THEN
    RETURN 'no_durable_state';
  END IF;

  v_status := v_block ->> 'status';
  IF v_status IS NULL OR NOT (v_status = ANY (c_statuses)) THEN
    RETURN 'no_durable_state';
  END IF;

  v_after := public.hubspot_outbound_phone(v_row.phone, v_row.mobile_phone);

  IF v_after IS NOT DISTINCT FROM p_previous_outbound THEN
    RETURN 'no_outbound_change';
  END IF;

  v_reason := CASE WHEN v_after IS NULL THEN 'phone_removed' ELSE 'phone_changed' END;

  v_prior_reason := v_block ->> 'stale_reason';
  IF v_prior_reason IS NOT NULL AND NOT (v_prior_reason = ANY (c_reasons)) THEN
    v_prior_reason := NULL;
  END IF;

  -- ── Ya había algo pendiente ────────────────────────────────────
  -- La hora y el estado se conservan intactos. Sólo se escribe si la razón dejó de describir la
  -- operación que falta por ejecutar; cuando ya es la correcta no se toca ni un campo, para que
  -- una segunda pasada no genere una escritura que no cambia nada.
  IF v_prior_reason IS NOT NULL AND v_status IN ('stale', 'failed') THEN
    IF v_prior_reason = v_reason THEN
      RETURN 'already_pending';
    END IF;

    UPDATE public.contacts
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'hubspot_sync',
                           v_block || jsonb_build_object('stale_reason', v_reason)
                         )
     WHERE id = p_contact_id;

    RETURN 'reason_corrected';
  END IF;

  IF v_status <> 'synced' THEN
    RETURN 'not_previously_synced';
  END IF;

  -- `||` sobre el bloque anterior conserva TODO lo que este contrato no nombra: `method`,
  -- `attempted_at`, `hubspot_contact_id`, y también los campos de auditoría que el hito 17A.4C
  -- ya escribía (`synced_at`, `synced_by`, `mode`, `hubspot_company_id`, `company_association`),
  -- que la UI sigue leyendo. Sobrescribirlos con nada sería perder auditoría existente.
  --
  -- `attempted_at` y `method` NO se reescriben porque esto NO fue un intento de sincronización:
  -- estampar una hora nueva afirmaría un intento que nadie hizo.
  UPDATE public.contacts
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object(
                         'hubspot_sync',
                         v_block || jsonb_build_object(
                           'status',       'stale',
                           'last_error',   NULL,
                           'stale_since',  to_char(
                                             p_now AT TIME ZONE 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                                           ),
                           'stale_reason', v_reason
                         )
                       )
   WHERE id = p_contact_id;

  RETURN 'marked';
END;
$function$;

COMMENT ON FUNCTION public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz) IS
  'AGENT2-CONTACT-HUBSPOT-STALE-COMPLETENESS-CUT3A — LA autoridad SQL de la transicion a stale por cambio del telefono SALIENTE (mobile_phone ?? phone). Espejo de markContactHubSpotSyncStaleForPhoneChange en TypeScript y compartida por el merge (117) y la supresion de privacidad (115), para que ningun escritor lleve su propia copia de la regla. Marca SOLO si la fila tiene hubspot_contact_id, hay estado durable legible, el SALIENTE cambio de verdad y el contacto llego a estar synced. Si ya habia algo pendiente conserva stale_since y el status —un failed no se degrada a stale— y REDERIVA la razon del saliente actual, porque la razon instruye al PATCH en vez de recordar: phone_changed cuando hay numero, phone_removed cuando no. Vocabulario CERRADO de dos miembros, sin texto libre. NO llama a HubSpot, NO alcanza ninguna red, NO crea ni borra filas, NO escribe mobile_phone (solo la LEE, 4O-E4.1 intacta) y NO toca el vinculo. Exige que el llamador ya tenga la fila de contacts bloqueada: no toma el lock para no invertir el orden candidato -> contacto -> telefonos que comparten 112/115/116/117. Devuelve un veredicto MECANICO y sin PII: marked, reason_corrected, already_pending, not_linked, no_durable_state, no_outbound_change, not_previously_synced, contact_not_found o invalid_input.';

REVOKE ALL ON FUNCTION public.hubspot_outbound_phone(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hubspot_outbound_phone(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.hubspot_outbound_phone(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hubspot_outbound_phone(text, text) TO postgres, service_role;

-- `authenticated` queda revocado y NO se concede, igual que en 115 y 117: marcar el estado de
-- HubSpot es una consecuencia de una operación autorizada, nunca una operación por sí misma.
-- Un cliente que pudiera invocarla directamente podría declarar desactualizada la ficha de
-- cualquier contacto sin haber tocado un solo teléfono.
REVOKE ALL ON FUNCTION public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz) TO postgres, service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 3. La 117 re-emitida — PARTE A
-- ═══════════════════════════════════════════════════════════════════
--
-- Cuerpo de la 117 byte a byte salvo TRES splices, y ninguno cambia lo que la función decide
-- sobre teléfonos, identidad o procedencia:
--   * `c.mobile_phone` entra en el SELECT del paso 5 — una LECTURA, para poder calcular el
--     saliente. Sigue sin aparecer en ningún UPDATE de esta función;
--   * el saliente ANTERIOR se captura bajo el lock y antes de escribir nada;
--   * un paso 11b llama a la autoridad, después del enlace de erasure y dentro de la misma
--     transacción que la proyección del escalar del paso 10.
--
-- Todo lo demás —la guarda IDOR, la recomprobación de supresión PERSON bajo el lock, el orden
-- de locks, `ON CONFLICT DO NOTHING`, el incumbente que nunca se degrada, la ausencia de DELETE
-- y de `suppressed_at = NULL`— se conserva sin tocar.

CREATE OR REPLACE FUNCTION public.merge_contact_candidate_into_existing_contact(
  p_candidate_id        uuid,
  p_contact_id          uuid,
  p_account_id          uuid,
  p_review_patch        jsonb,
  p_scalar_fallback     jsonb,
  p_incumbent_bootstrap jsonb,
  p_actor_id            uuid,
  p_now                 timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  -- 112 / 115 / 116 rankings, verbatim. A static test asserts these two arrays are
  -- byte-identical to 116's, because two rankings over the same vocabulary is how the same
  -- person ends up with different primaries on two surfaces.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- The candidate statuses this function will act on. A merge starts from the verdict the
  -- duplicate gate already wrote; `pending_review` is 116's territory and is refused here so
  -- the two transactions can never both terminalise the same candidate.
  c_mergeable      text[] := ARRAY['duplicate'];

  v_candidate      RECORD;
  v_contact        RECORD;
  v_account_id     uuid;
  v_person_id      text;
  v_review         jsonb;
  v_merged_prev    text;
  v_merged_ids     jsonb;

  v_fb_provider    text;
  v_fb_mode        text;
  v_fb_norm        text;
  v_fb_display     text;
  v_fb_key         text;
  v_fb_type        text;
  v_fb_event       text;
  v_fb_phone_id    uuid;

  v_inc_phone_id   uuid;
  v_inc_state      text    := 'absent';
  v_inc_live_rows  integer := 0;

  v_seen           integer := 0;
  v_inserted       integer := 0;
  v_reused         integer := 0;
  v_skipped        integer := 0;
  v_src_inserted   integer := 0;
  v_src_reused     integer := 0;
  v_src_seen       integer := 0;
  v_scalar_fb      text    := 'absent';

  v_primary_id     uuid;
  v_primary_key    text;
  v_primary_kept   boolean := false;
  v_primary        RECORD;
  v_src            RECORD;
  v_scalar         text;
  v_scalar_type    text;
  v_scalar_source  text;
  v_scalar_raw     text;
  v_scalar_at      timestamptz;
  v_scalar_state   text    := 'incumbent_preserved';
  v_rows           integer := 0;

  -- CUT-3A. The OUTBOUND phone as it stood before this transaction wrote anything, and the
  -- mechanical verdict of the stale authority. Neither is a phone number in the envelope: see
  -- step 13.
  v_hs_prev_out    text;
  v_hs_decision    text    := 'not_evaluated';
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — validation. Fail closed BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'contact_id_missing');
  END IF;

  IF p_account_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'account_id_missing');
  END IF;

  IF p_review_patch IS NULL OR jsonb_typeof(p_review_patch) <> 'object' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'review_patch_invalid');
  END IF;

  -- The patch may only re-state the DUPLICATE verdict. A patch carrying `approved` would be
  -- using the merge transaction — which creates no contact — to claim an approval, and one
  -- carrying `discarded` would be writing the opposite of the decision the human just took.
  IF p_review_patch ->> 'status' IS DISTINCT FROM 'duplicate' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'review_patch_status_not_duplicate');
  END IF;

  IF p_now IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'now_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — lock the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- FIRST statement that touches a row. Every check that follows is decided on a snapshot the
  -- lock protects, not on the pre-call read the server action did.

  SELECT c.id,
         c.status,
         c.phone,
         c.matched_contacts_id,
         c.enrichment_run_id,
         c.enrichment_metadata,
         c.apollo_person_id,
         c.source,
         c.source_contact_id
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_found', 'detail', 'candidate_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — idempotency.
  -- ═══════════════════════════════════════════════════════════════
  -- The durable link is `enrichment_metadata.review.merged_into_contact_id`, written by step 12
  -- of this same function. `matched_contacts_id` cannot serve here the way it does in 116: the
  -- duplicate gate writes it on BOTH outcomes, so a discarded duplicate and a merged duplicate
  -- carry the same value and only this key tells them apart.
  --
  -- This is also the losing half of a double-click: the winner committed while this transaction
  -- waited on the lock, so what this reads is the winner's terminal state. Zero writes.

  v_review := COALESCE(v_candidate.enrichment_metadata -> 'review', '{}'::jsonb);
  v_merged_prev := v_review ->> 'merged_into_contact_id';

  IF v_merged_prev IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status',                    'already_merged',
      'candidate_id',              p_candidate_id,
      'contact_id',                v_merged_prev,
      'contact_created',           false,
      'phones_seen',               0,
      'phones_inserted',           0,
      'phones_reused',             0,
      'phones_skipped_suppressed', 0,
      'sources_inserted',          0,
      'sources_reused',            0,
      'primary_dedupe_key',        NULL,
      'primary_preserved',         true,
      'scalar_projection',         'incumbent_preserved',
      'scalar_fallback',           'absent',
      'incumbent_bootstrap',       'absent',
      -- CUT-3A. The idempotent path writes NOTHING, so it cannot have changed what HubSpot
      -- sees and does not pretend to have evaluated it. The key is present on every envelope
      -- so a caller never has to distinguish "absent" from "nothing happened".
      'hubspot_sync_transition',   'not_evaluated',
      'candidate_terminal',        true
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — mergeability, under the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- `pending_review` is not merged (it is 116's), and `approved` / `discarded` are conclusions
  -- somebody else reached.

  IF NOT (v_candidate.status = ANY (c_mergeable)) THEN
    RETURN jsonb_build_object(
      'status', 'candidate_not_mergeable',
      'detail', 'candidate_status_not_duplicate'
    );
  END IF;

  -- THE IDOR GUARD, and the reason the client's contact id is only ever a confirmation. The
  -- destination is the one the SERVER recorded when it detected the duplicate; a request naming
  -- any other contact is refused here, under the lock, before a single row is written.
  IF v_candidate.matched_contacts_id IS DISTINCT FROM p_contact_id THEN
    RETURN jsonb_build_object(
      'status', 'contact_mismatch',
      'detail', 'contact_id_not_the_recorded_match'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — PERSON suppression, re-checked UNDER the lock (4O-E3 / 113).
  -- ═══════════════════════════════════════════════════════════════
  -- 113's key resolution, statement for statement, so the SQL and the TypeScript guard resolve
  -- the SAME person. No person id or no account means there is no key to match, and that limit
  -- is NOT turned into a block by inference.
  --
  -- Erasure first ⇒ this SELECT sees the tombstone and NOTHING is written. Merge first ⇒ the
  -- erasure that follows takes this same candidate lock, then the contact lock, and tombstones
  -- what was written — reaching it through the link step 11 leaves behind. Both orderings end
  -- suppressed.

  SELECT r.account_id INTO v_account_id
  FROM public.contact_enrichment_runs r
  WHERE r.id = v_candidate.enrichment_run_id;

  v_account_id := COALESCE(v_account_id, p_account_id);

  v_person_id := COALESCE(
    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),
    CASE WHEN v_candidate.source = 'apollo'
      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)
    END
  );

  IF v_person_id IS NOT NULL
     AND v_account_id IS NOT NULL
     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN
    RETURN jsonb_build_object(
      'status',       'person_suppressed',
      'candidate_id', p_candidate_id,
      'contact_id',   NULL,
      'detail',       'person_suppression_tombstone'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — lock the EXISTING contact, read the incumbent scalar.
  -- ═══════════════════════════════════════════════════════════════
  -- Second lock, in 115's position. The account is re-asserted here and not trusted from the
  -- parameter: `matched_contacts_id` is a FK with no account clause, and a contact that has
  -- since moved account is out of scope for this merge. An ARCHIVED contact is refused too —
  -- the dedup read that produced the match filtered `archived_at IS NULL`, and a contact
  -- archived since is a destination the human was never shown.

  -- CUT-3A adds `c.mobile_phone` to this SELECT, and it is a READ. The outbound value HubSpot
  -- receives is `mobile_phone ?? phone`, so without this column the function cannot tell
  -- whether projecting the legacy scalar changes anything HubSpot can see — and would mark a
  -- contact stale whose outbound number never moved. It remains absent from every UPDATE in
  -- this function: MOBILE_PHONE_PROVENANCE_PENDING (4O-E4.1) is unaffected by reading it.
  SELECT c.id,
         c.account_id,
         c.phone,
         c.mobile_phone,
         c.phone_type,
         c.phone_source,
         c.phone_raw_type,
         c.phone_revealed_at,
         c.metadata,
         c.archived_at
    INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'contact_not_found', 'detail', 'contact_missing');
  END IF;

  IF v_contact.account_id IS DISTINCT FROM p_account_id THEN
    RETURN jsonb_build_object('status', 'contact_mismatch', 'detail', 'contact_account_mismatch');
  END IF;

  IF v_contact.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'contact_not_mergeable', 'detail', 'contact_archived');
  END IF;

  -- CUT-3A. Captured HERE — under the contact lock and before this transaction has written a
  -- single column — because it is the value HubSpot was last told about. Reading it after
  -- step 10 would compare the new number with itself and never mark anything.
  v_hs_prev_out := public.hubspot_outbound_phone(v_contact.phone, v_contact.mobile_phone);

  SELECT COUNT(*) INTO v_inc_live_rows
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
    AND p.suppressed_at IS NULL;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — bootstrap the incumbent scalar into the collection.
  -- ═══════════════════════════════════════════════════════════════
  -- ONLY for the legacy contact: a scalar and no live canonical row. The caller inverted the
  -- provenance in TypeScript, through the SAME table 116 uses, and normalised the number with
  -- THE normaliser — a second normaliser would mean the same number hashing to two keys
  -- depending on which writer saw it, which is deduplication failing silently and the tombstone
  -- failing with it. Here the vocabularies are re-validated and the row is inserted.
  --
  -- `observed_at` is the incumbent's OWN `phone_revealed_at` when it has one. Stamping `p_now`
  -- over a number that was revealed months ago would be back-dating an observation forward.

  IF p_incumbent_bootstrap IS NULL OR jsonb_typeof(p_incumbent_bootstrap) <> 'object' THEN
    v_inc_state := CASE
      WHEN NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NULL THEN 'absent'
      ELSE 'unrepresentable'
    END;
  ELSIF v_inc_live_rows > 0 THEN
    -- The contact already owns an official collection; there is nothing legacy to bootstrap and
    -- its scalar has already been projected from that collection by whoever wrote it.
    v_inc_state := 'collection_present';
  ELSIF NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '')
        IS DISTINCT FROM NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'observed_phone', '')), '') THEN
    -- The scalar changed between the caller's read and this lock. Promoting the stale value
    -- would attach a provenance to a number that is no longer on the row.
    v_inc_state := 'stale';
  ELSE
    v_fb_provider := p_incumbent_bootstrap ->> 'provider';
    v_fb_mode     := p_incumbent_bootstrap ->> 'acquisition_mode';
    v_fb_norm     := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'normalized_phone', '')), '');
    v_fb_display  := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'display_phone', '')), '');
    v_fb_key      := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'dedupe_key', '')), '');
    v_fb_type     := p_incumbent_bootstrap ->> 'phone_type';
    v_fb_event    := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'source_event_key', '')), '');

    IF v_fb_provider IS NULL
       OR NOT (v_fb_provider = ANY (ARRAY['apollo', 'lusha', 'apollo_cache', 'manual', 'unknown']))
       OR v_fb_mode IS NULL
       OR NOT (v_fb_mode = ANY (ARRAY['search', 'reveal', 'waterfall', 'cache', 'manual']))
       OR v_fb_norm IS NULL
       OR v_fb_key IS NULL
       OR v_fb_event IS NULL THEN
      v_inc_state := 'unrepresentable';
    ELSE
      IF v_fb_type IS NOT NULL AND NOT (v_fb_type = ANY (c_type_ranking)) THEN
        v_fb_type := NULL;
      END IF;

      INSERT INTO public.contact_phones (
        contact_id, normalized_phone, display_phone, dedupe_key,
        phone_type, phone_status, is_primary, first_seen_at, last_seen_at
      )
      VALUES (
        p_contact_id, v_fb_norm, COALESCE(v_fb_display, v_fb_norm), v_fb_key,
        v_fb_type, 'unknown', false,
        COALESCE(v_contact.phone_revealed_at, p_now),
        COALESCE(v_contact.phone_revealed_at, p_now)
      )
      ON CONFLICT (contact_id, dedupe_key) DO NOTHING
      RETURNING id INTO v_inc_phone_id;

      IF v_inc_phone_id IS NULL THEN
        -- A tombstone already holds this key. Never resurrected, never counted as promoted.
        v_inc_state := 'unrepresentable';
      ELSE
        INSERT INTO public.contact_phone_sources (
          contact_phone_id, provider, acquisition_mode,
          raw_provider_type, source_event_key, observed_at
        )
        VALUES (
          v_inc_phone_id, v_fb_provider, v_fb_mode,
          NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'raw_provider_type', '')), ''),
          'v1:incumbent:' || v_fb_event,
          COALESCE(v_contact.phone_revealed_at, p_now)
        )
        ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING;

        v_inc_state := 'promoted';
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — promote the LIVE candidate collection.
  -- ═══════════════════════════════════════════════════════════════
  -- 116's step 6, unchanged except for the destination. `suppressed_at IS NULL` on the staging
  -- row is the whole tombstone rule: a number 112 erased has nothing to promote, and its
  -- candidate row carries no number to promote anyway (109's `tombstone_is_empty` CHECK).
  --
  -- `is_primary` is deliberately NOT copied. The candidate's own primary means nothing on a
  -- contact that already has one, and election is step 9.

  SELECT COUNT(*) INTO v_seen
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id;

  SELECT COUNT(*) INTO v_skipped
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NOT NULL;

  WITH promoted AS (
    INSERT INTO public.contact_phones (
      contact_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    )
    SELECT p_contact_id,
           p.normalized_phone,
           p.display_phone,
           p.dedupe_key,
           p.phone_type,
           p.phone_status,
           false,
           p.first_seen_at,
           p.last_seen_at
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.suppressed_at IS NULL
    ORDER BY p.dedupe_key
    ON CONFLICT (contact_id, dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM promoted;

  -- Anything live that did NOT insert was already present as a live canonical row or as a
  -- tombstone. Both are "reused" in the sense that matters: the number is represented by a row
  -- this transaction did not create and must not modify. On an EXISTING contact this is a real,
  -- exercised path — the number the operator revealed may already be there.
  SELECT GREATEST(COUNT(*) - v_inserted, 0) INTO v_reused
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  -- ── Provenance ────────────────────────────────────────────────
  -- Every staging source of every LIVE staging number, joined to the official canonical row by
  -- `dedupe_key`. Apollo and Lusha observing the SAME number produce TWO source rows under ONE
  -- canonical row, because the join is on the number and never on the provider — and on an
  -- existing contact that also means a number ALREADY there simply gains the new provenance
  -- instead of being duplicated.
  --
  -- The join is restricted to LIVE official canonical rows: a tombstone must not gain new
  -- provenance, or the next erasure would find a live source justifying an erased number.

  SELECT COUNT(*) INTO v_src_seen
  FROM public.contact_enrichment_candidate_phone_sources s
  JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  WITH promoted_sources AS (
    INSERT INTO public.contact_phone_sources (
      contact_phone_id, provider, acquisition_mode,
      raw_provider_type, raw_provider_status,
      waterfall_run_id, reservation_id, provider_usage_log_id,
      candidate_phone_id, source_event_key, observed_at
    )
    SELECT op.id,
           s.provider,
           s.acquisition_mode,
           s.raw_provider_type,
           s.raw_provider_status,
           s.waterfall_run_id,
           s.reservation_id,
           s.provider_usage_log_id,
           s.candidate_phone_id,
           'v1:promoted:' || s.source_event_key,
           s.observed_at
    FROM public.contact_enrichment_candidate_phone_sources s
    JOIN public.contact_enrichment_candidate_phones cp ON cp.id = s.candidate_phone_id
    JOIN public.contact_phones op
      ON op.contact_id = p_contact_id
     AND op.dedupe_key = cp.dedupe_key
     AND op.suppressed_at IS NULL
    WHERE cp.candidate_id = p_candidate_id
      AND cp.suppressed_at IS NULL
    ORDER BY op.id, s.source_event_key
    ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_src_inserted FROM promoted_sources;

  v_src_reused := GREATEST(v_src_seen - v_src_inserted, 0);

  -- ═══════════════════════════════════════════════════════════════
  -- Step 8 — the scalar-only candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- 116's step 7, unchanged except for the destination. Only when the candidate's collection
  -- produced NOTHING live: a candidate that has a collection has already said everything it
  -- knows about its numbers, and its scalar is a projection of it.

  IF v_inserted = 0 AND v_reused = 0 THEN
    IF p_scalar_fallback IS NULL OR jsonb_typeof(p_scalar_fallback) <> 'object' THEN
      v_scalar_fb := CASE
        WHEN NULLIF(BTRIM(COALESCE(v_candidate.phone, '')), '') IS NULL THEN 'absent'
        ELSE 'unrepresentable'
      END;
    ELSE
      v_fb_provider := p_scalar_fallback ->> 'provider';
      v_fb_mode     := p_scalar_fallback ->> 'acquisition_mode';
      v_fb_norm     := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'normalized_phone', '')), '');
      v_fb_display  := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'display_phone', '')), '');
      v_fb_key      := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'dedupe_key', '')), '');
      v_fb_type     := p_scalar_fallback ->> 'phone_type';
      v_fb_event    := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'source_event_key', '')), '');

      IF v_fb_provider IS NULL
         OR NOT (v_fb_provider = ANY (ARRAY['apollo', 'lusha', 'apollo_cache', 'manual', 'unknown']))
         OR v_fb_mode IS NULL
         OR NOT (v_fb_mode = ANY (ARRAY['search', 'reveal', 'waterfall', 'cache', 'manual']))
         OR v_fb_norm IS NULL
         OR v_fb_key IS NULL
         OR v_fb_event IS NULL THEN
        v_scalar_fb := 'unrepresentable';
      ELSE
        IF v_fb_type IS NOT NULL AND NOT (v_fb_type = ANY (c_type_ranking)) THEN
          v_fb_type := NULL;
        END IF;

        INSERT INTO public.contact_phones (
          contact_id, normalized_phone, display_phone, dedupe_key,
          phone_type, phone_status, is_primary, first_seen_at, last_seen_at
        )
        VALUES (
          p_contact_id, v_fb_norm, COALESCE(v_fb_display, v_fb_norm), v_fb_key,
          v_fb_type, 'unknown', false, p_now, p_now
        )
        ON CONFLICT (contact_id, dedupe_key) DO NOTHING
        RETURNING id INTO v_fb_phone_id;

        IF v_fb_phone_id IS NULL THEN
          v_scalar_fb := 'unrepresentable';
        ELSE
          v_inserted := v_inserted + 1;
          v_seen     := v_seen + 1;

          INSERT INTO public.contact_phone_sources (
            contact_phone_id, provider, acquisition_mode,
            raw_provider_type, source_event_key, observed_at
          )
          VALUES (
            v_fb_phone_id, v_fb_provider, v_fb_mode,
            NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'raw_provider_type', '')), ''),
            'v1:promoted:' || v_fb_event,
            p_now
          )
          ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING;

          GET DIAGNOSTICS v_rows = ROW_COUNT;
          v_src_inserted := v_src_inserted + v_rows;
          v_src_seen     := v_src_seen + 1;
          v_scalar_fb    := 'promoted';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 9 — the primary. An incumbent is NEVER demoted.
  -- ═══════════════════════════════════════════════════════════════
  -- THE central rule of this migration, and the reason it does not reuse 116's election. 116
  -- elects on a contact it just created, where there is nothing to displace. Here there may be
  -- a primary the operator or an earlier reveal chose, and an ADDITIVE merge is not a
  -- repriorisation: a candidate arriving with a `personal_mobile` does not take the primary
  -- from an incumbent `work` line, and a MANUAL incumbent — which the ranking below would place
  -- first anyway — is protected before the ranking is even consulted.
  --
  -- Election only happens when the contact has NO live primary at all. Then, in order:
  --   * the incumbent scalar just bootstrapped, if there is one. It IS the number this contact
  --     has always had, and the collection must not start by preferring a stranger to it;
  --   * otherwise the shared ranking, which is 115's and 116's rung for rung, with `dedupe_key`
  --     as the total tie-break so the physical row order never participates.

  SELECT p.id, p.dedupe_key INTO v_primary
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
    AND p.is_primary
    AND p.suppressed_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    v_primary_id    := v_primary.id;
    v_primary_key   := v_primary.dedupe_key;
    v_primary_kept  := true;
  ELSIF v_inc_phone_id IS NOT NULL THEN
    SELECT p.id, p.dedupe_key INTO v_primary
    FROM public.contact_phones p
    WHERE p.id = v_inc_phone_id
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';
    IF FOUND THEN
      v_primary_id  := v_primary.id;
      v_primary_key := v_primary.dedupe_key;
    END IF;
  END IF;

  IF v_primary_id IS NULL THEN
    SELECT p.id, p.dedupe_key INTO v_primary
    FROM public.contact_phones p
    WHERE p.contact_id = p_contact_id
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid'
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM public.contact_phone_sources s
        WHERE s.contact_phone_id = p.id
          AND s.suppressed_at IS NULL
          AND s.provider = 'manual'
      ) THEN 0 ELSE 1 END,
      COALESCE(array_position(c_type_ranking, p.phone_type),
               array_length(c_type_ranking, 1) + 1),
      CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
      COALESCE((
        SELECT MIN(COALESCE(
                 array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
                 array_length(c_source_ranking, 1) + 1))
        FROM public.contact_phone_sources s
        WHERE s.contact_phone_id = p.id
          AND s.suppressed_at IS NULL
      ), array_length(c_source_ranking, 1) + 1),
      p.last_seen_at DESC,
      p.dedupe_key ASC
    LIMIT 1;

    IF FOUND THEN
      v_primary_id  := v_primary.id;
      v_primary_key := v_primary.dedupe_key;
    END IF;
  END IF;

  -- No demotion sweep. When the incumbent was kept there is nothing to change, and when there
  -- was no primary there is nothing to demote — every row this transaction inserted was
  -- inserted with `is_primary = false`. A blanket `UPDATE … SET is_primary = false` would be a
  -- statement capable of demoting an incumbent, and this function must not contain one.
  IF v_primary_id IS NOT NULL AND NOT v_primary_kept THEN
    UPDATE public.contact_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 10 — the legacy scalar. Written ONLY when it was NULL.
  -- ═══════════════════════════════════════════════════════════════
  -- Read under the contact lock in step 5, BEFORE anything was promoted. A contact that already
  -- had a number keeps it, with its type, its provenance and its timestamp, whatever the
  -- collection now looks like — including the case where the incumbent could not be
  -- bootstrapped, which is `HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING` and stays open.
  --
  -- `phone_processing_basis` is NOT projected — the official model has no column holding a legal
  -- basis, so any value would be fabricated. `phone_confidence` is never written: it stays the
  -- dead column 4O-E4 found and H2 refused to resurrect. `mobile_phone` is not in this UPDATE
  -- and must not be — MOBILE_PHONE_PROVENANCE_PENDING (4O-E4.1) stands until H5.

  IF v_primary_id IS NOT NULL
     AND NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NULL THEN
    SELECT p.display_phone, p.normalized_phone, p.phone_type INTO v_primary
    FROM public.contact_phones p
    WHERE p.id = v_primary_id;

    v_scalar      := COALESCE(v_primary.display_phone, v_primary.normalized_phone);
    v_scalar_type := v_primary.phone_type;

    -- Provenance from the most SPECIFIC LIVE source of the elected row, 115's comparator
    -- verbatim. A scalar must never assert a provenance that has been withdrawn.
    SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.observed_at INTO v_src
    FROM public.contact_phone_sources s
    WHERE s.contact_phone_id = v_primary_id
      AND s.suppressed_at IS NULL
    ORDER BY
      COALESCE(array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
               array_length(c_source_ranking, 1) + 1),
      s.observed_at DESC,
      s.id ASC
    LIMIT 1;

    IF FOUND THEN
      -- 112's mapping, verbatim.
      v_scalar_source := CASE
        WHEN v_src.provider = 'apollo_cache'                                THEN 'apollo_cache'
        WHEN v_src.provider = 'lusha'                                       THEN 'lusha_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode
               IN ('reveal', 'waterfall')                                   THEN 'apollo_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode = 'search' THEN 'apollo_search'
        WHEN v_src.provider = 'manual'                                      THEN 'manual'
        ELSE 'unknown'
      END;
      v_scalar_raw := v_src.raw_provider_type;
      v_scalar_at  := v_src.observed_at;
    ELSE
      v_scalar_source := 'unknown';
    END IF;

    UPDATE public.contacts
       SET phone             = v_scalar,
           phone_type        = v_scalar_type,
           phone_source      = v_scalar_source,
           phone_raw_type    = v_scalar_raw,
           phone_revealed_at = v_scalar_at
     WHERE id = p_contact_id
       -- The scalar is re-asserted NULL in the predicate. The row is locked so it cannot have
       -- changed; if the lock were ever lost, this matches zero rows instead of overwriting a
       -- number somebody typed in the meantime.
       AND NULLIF(BTRIM(COALESCE(phone, '')), '') IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_scalar_state := CASE WHEN v_rows > 0 THEN 'projected' ELSE 'incumbent_preserved' END;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 11 — record the merge ON THE CONTACT. The erasure link.
  -- ═══════════════════════════════════════════════════════════════
  -- Not decoration. `resolveContactErasureProvenance` authorises a DSAR deletion only when the
  -- contact ITSELF attests the write, and without this the numbers promoted above would be
  -- discoverable by a later erasure but not erasable by it. Append-only and de-duplicated;
  -- `source_candidate_id` is never touched, because it records where the contact CAME FROM and
  -- a merge does not change that.

  v_merged_ids := COALESCE(v_contact.metadata -> 'merged_candidate_ids', '[]'::jsonb);
  IF jsonb_typeof(v_merged_ids) <> 'array' THEN
    v_merged_ids := '[]'::jsonb;
  END IF;
  IF NOT (v_merged_ids @> to_jsonb(ARRAY[p_candidate_id::text])) THEN
    v_merged_ids := v_merged_ids || to_jsonb(p_candidate_id::text);
  END IF;

  UPDATE public.contacts
     SET metadata   = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('merged_candidate_ids', v_merged_ids),
         updated_by = COALESCE(p_actor_id, updated_by)
   WHERE id = p_contact_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'merge_contact_candidate_into_existing_contact: erasure link not written'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 11b — CUT-3A: HubSpot stops claiming to be up to date.
  -- ═══════════════════════════════════════════════════════════════
  -- If this merge changed the OUTBOUND phone of a contact that is linked to HubSpot and whose
  -- durable state says `synced`, that state is now a lie: SellUp holds a number HubSpot has
  -- never seen. The transition happens HERE, in the SAME transaction as the projection that
  -- caused it, and not in a second application-side UPDATE afterwards — that second write
  -- would leave a window in which the phone is already stored and the record still reads
  -- `synced`, which is precisely the falsehood this cut exists to remove. A rollback takes the
  -- number and the verdict about it back together.
  --
  -- This reaches NO network. It cannot: it is a metadata UPDATE inside a SQL transaction.
  -- Sending anything to HubSpot remains a human click, exactly as in CUT-2.
  --
  -- The rule itself lives in ONE function, shared with the DSAR path, and mirrors the single
  -- TypeScript authority. Two copies of "did the outbound phone change?" is how two surfaces
  -- end up disagreeing about whether HubSpot is current.
  v_hs_decision := public.mark_contact_hubspot_sync_stale_for_phone(
    p_contact_id, v_hs_prev_out, p_now
  );

  -- ═══════════════════════════════════════════════════════════════
  -- Step 12 — terminalise the candidate as a MERGED duplicate.
  -- ═══════════════════════════════════════════════════════════════
  -- LAST, and inside the same transaction as everything above: a failure at any point rolls the
  -- phones, the sources and the erasure link back with it.
  --
  -- The status stays `duplicate` — it IS one, and 068's CHECK has no better member; inventing a
  -- fifth would mean a migration on a column every list filter already reads. What distinguishes
  -- a MERGED duplicate from a DISCARDED one is `review.merged_into_contact_id`, injected here,
  -- which is also the idempotency key of step 2. `matched_contacts_id` cannot carry that
  -- distinction: the duplicate gate writes it on both outcomes.
  --
  -- `status = 'duplicate'` is re-asserted in the WHERE against the value read under the lock.

  UPDATE public.contact_enrichment_candidates
     SET status              = p_review_patch ->> 'status',
         duplicate_status    = COALESCE(p_review_patch ->> 'duplicate_status', duplicate_status),
         review_notes        = p_review_patch ->> 'review_notes',
         reviewed_by         = NULLIF(p_review_patch ->> 'reviewed_by', '')::uuid,
         reviewed_at         = NULLIF(p_review_patch ->> 'reviewed_at', '')::timestamptz,
         enrichment_metadata =
           COALESCE(p_review_patch -> 'enrichment_metadata', '{}'::jsonb)
           || jsonb_build_object(
                'review',
                COALESCE(p_review_patch -> 'enrichment_metadata' -> 'review', '{}'::jsonb)
                  || jsonb_build_object(
                       'merged_into_contact_id', p_contact_id::text,
                       'merged_at',              to_jsonb(p_now)
                     )
              )
   WHERE id = p_candidate_id
     AND status = 'duplicate';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'merge_contact_candidate_into_existing_contact: candidate terminal state not written'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 13 — the envelope.
  -- ═══════════════════════════════════════════════════════════════
  -- Counts, booleans, opaque ids and a `dedupe_key` — which is a SHA-256 by 114's design and
  -- never the number. NO phone number, NO display form, NO name, NO e-mail leaves this function.

  RETURN jsonb_build_object(
    'status',                    'merged',
    'candidate_id',              p_candidate_id,
    'contact_id',                p_contact_id,
    'contact_created',           false,
    'phones_seen',               v_seen,
    'phones_inserted',           v_inserted,
    'phones_reused',             v_reused,
    'phones_skipped_suppressed', v_skipped,
    'sources_inserted',          v_src_inserted,
    'sources_reused',            v_src_reused,
    'primary_dedupe_key',        v_primary_key,
    'primary_preserved',         v_primary_kept,
    'scalar_projection',         v_scalar_state,
    'scalar_fallback',           v_scalar_fb,
    'incumbent_bootstrap',       v_inc_state,
    -- CUT-3A. A MECHANICAL verdict and never a phone number: `marked`, `already_pending`,
    -- `reason_corrected`, `not_linked`, `no_durable_state`, `no_outbound_change` or
    -- `not_previously_synced`. It is here so a caller can distinguish "HubSpot was left
    -- claiming to be current" from "there was nothing to claim", which is the difference the
    -- whole cut is about — and it says nothing about WHAT the number is.
    'hubspot_sync_transition',   v_hs_decision,
    'candidate_terminal',        true
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════
-- 4. La 115 re-emitida — PRIVACIDAD
-- ═══════════════════════════════════════════════════════════════════
--
-- Cuerpo de la 115 byte a byte salvo TRES splices simétricos a los de la 117: `c.mobile_phone`
-- se LEE en el paso 1, el saliente anterior se captura bajo el lock, y un paso 6b llama a la
-- misma autoridad tras la reproyección del escalar.
--
-- ── LA DECISIÓN DE PRIVACIDAD, EXPLÍCITA ─────────────────────────
-- Se eligió (A) marcar con `phone_removed` y NO (B) introducir un estado pendiente específico de
-- privacidad. Razón: `stale` + `phone_removed` describe EXACTAMENTE el hecho —hay una operación
-- local sin enviar, y esa operación es borrar— y es la MISMA operación que el camino manual ya
-- sabe ejecutar. Un estado propio habría sido un segundo nombre para la misma cosa, y el
-- ejecutor habría tenido que aprender a tratarlos igual, que es la definición de vocabulario
-- redundante. La instrucción de expansión mínima se cumple con UN miembro nuevo.
--
-- Lo que NO se hace, y es la mitad del punto: marcar no exporta. No hay salida a la red desde
-- aquí. Una DSAR no empuja datos a un tercero para corregir a ese tercero; REGISTRA que el
-- tercero está desactualizado y un humano decide cuándo enviar el PATCH de borrado.
--
-- Lo que tampoco se hace: dejar un `synced` falso. Ese era el desenlace anterior y es el peor
-- de los tres, porque el operador creería que el dato desapareció de todas partes mientras
-- HubSpot lo sigue sirviendo.

CREATE OR REPLACE FUNCTION public.suppress_official_contact_phone_sources(
  p_contact_id         uuid,
  p_provider_scope     text,
  p_provider           text,
  p_dedupe_key         text,
  p_suppression_reason text,
  p_suppressed_by      uuid,
  p_suppressed_at      timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  -- `compareCandidatePhones()` / migration 112 step 4, verbatim. Reused and NOT restated in a
  -- second incompatible order: two rankings over the same vocabulary is how the candidate and
  -- the official collection end up electing different primaries for the same person.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  -- 112's provenance-specificity ranking, verbatim: reveal > cache > search. `manual:manual`
  -- is deliberately ABSENT — manual precedence is a PRIOR TIER (see step 5), not a rung on
  -- this ladder, because a manual `work` number must outrank a provider `personal_mobile`
  -- and no reordering of a single ladder can express that.
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- 114's suppression vocabulary (which is 109's). NOT the cache/audit vocabulary of 099 —
  -- the two sets share zero values and 112 owns the translation.
  c_reasons        text[] := ARRAY[
    'data_subject_request', 'operator_request', 'provider_retraction'
  ];

  c_scopes         text[] := ARRAY['all_suppressible_providers', 'single_provider'];

  -- 114's provider vocabulary, for validating `p_provider` before it can select nothing
  -- silently.
  c_providers      text[] := ARRAY['apollo', 'lusha', 'apollo_cache', 'manual', 'unknown'];

  -- The legacy allowlist of 4O-E4, which governs the SCALAR only.
  c_suppressible_legacy_sources text[] := ARRAY[
    'apollo_reveal', 'apollo_cache', 'lusha_reveal'
  ];

  v_contact                RECORD;
  v_official_rows          integer := 0;
  v_sources_suppressed     integer := 0;
  v_tombstoned             integer := 0;
  v_incumbent_id           uuid;
  v_incumbent_live         boolean := false;
  v_primary                RECORD;
  v_primary_id             uuid;
  v_primary_key            text;
  v_previous_primary_key   text;
  v_survivor_count         integer := 0;
  v_scalar                 text;
  v_scalar_type            text;
  v_scalar_source          text;
  v_scalar_raw_type        text;
  v_scalar_revealed_at     timestamptz;
  v_src                    RECORD;
  v_contact_rows           integer := 0;
  v_scalar_synced          boolean := false;
  v_scalar_guarded         boolean := false;

  -- CUT-3A. The OUTBOUND phone before this erasure wrote anything, and the mechanical verdict
  -- of the stale authority. Neither is a phone number in the envelope: see step 7.
  v_hs_prev_out            text;
  v_hs_decision            text    := 'not_evaluated';
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — validation. Fail closed BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every arm returns a mechanical `invalid_input` and writes nothing. An erasure that
  -- silently matched zero rows because its scope was misspelled would report success while
  -- leaving the number live, so an unrecognised scope is an ERROR and never an empty match.

  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'contact_id_missing');
  END IF;

  IF p_provider_scope IS NULL OR NOT (p_provider_scope = ANY (c_scopes)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_scope_unknown');
  END IF;

  IF p_provider_scope = 'single_provider' THEN
    IF p_provider IS NULL OR NOT (p_provider = ANY (c_providers)) THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_unknown');
    END IF;
  ELSIF p_provider IS NOT NULL THEN
    -- A provider passed alongside the all-providers scope means the caller believes one of
    -- the two, and the function cannot know which. Rejecting is the only answer that cannot
    -- silently erase more or less than intended.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_allowed');
  END IF;

  IF p_dedupe_key IS NOT NULL AND LENGTH(BTRIM(p_dedupe_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'dedupe_key_blank');
  END IF;

  IF p_suppression_reason IS NULL
     OR NOT (p_suppression_reason = ANY (c_reasons)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'suppression_reason_unknown');
  END IF;

  IF p_suppressed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'suppressed_at_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — lock the contact, then its canonical rows.
  -- ═══════════════════════════════════════════════════════════════
  -- The CONTACT row is the serialisation point, and locking it first is what makes two
  -- concurrent erasures on the same person strictly ordered instead of interleaved. Without
  -- it, two provider-specific erasures could each observe the other's provenance as still
  -- live, each conclude a live source remains, and both decline to tombstone a number whose
  -- last two sources are now withdrawn.
  --
  -- `contact_phones` rows are then locked in `id` order so two operations touching the same
  -- collection can never deadlock by taking the same locks in opposite orders.
  --
  -- `contact_phone_sources` is deliberately NOT locked directly: it is reachable ONLY through
  -- a canonical row, and every canonical row in scope is already locked. Locking it as well
  -- would add a dependency on `SELECT … FOR UPDATE` being satisfied by 114's COLUMN-LEVEL
  -- UPDATE grant — a subtlety worth not relying on when the parent lock is already sufficient.

  -- CUT-3A adds `c.mobile_phone`, and it is a READ. The value HubSpot receives is
  -- `mobile_phone ?? phone`, so without this column the function cannot tell whether clearing
  -- the legacy scalar changes anything HubSpot can see. It stays out of every UPDATE here:
  -- 4O-E4.1 says a provider-scoped erasure has no authority over a column with no provenance,
  -- and reading it does not create any.
  SELECT c.id, c.phone, c.mobile_phone, c.phone_source
    INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'contact_not_found', 'detail', 'contact_missing');
  END IF;

  -- Captured under the lock and before any write: this is what HubSpot was last told.
  v_hs_prev_out := public.hubspot_outbound_phone(v_contact.phone, v_contact.mobile_phone);

  PERFORM 1
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
  ORDER BY p.id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_official_rows
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — the Production no-op.
  -- ═══════════════════════════════════════════════════════════════
  -- No official collection ⇒ this function has NOTHING to say about the contact, and in
  -- particular no authority to re-project `contacts.phone` from an empty set. Returning here
  -- is what keeps 4O-E4 the sole owner of the legacy scalar until H3 populates the collection.

  IF v_official_rows = 0 THEN
    RETURN jsonb_build_object(
      'status',                     'no_official_collection',
      'sources_suppressed',         0,
      'phones_tombstoned',          0,
      'survivor_count',             0,
      'primary_dedupe_key',         NULL,
      'primary_changed',            false,
      'scalar_synced',              false,
      'scalar_guarded_by_provenance', false,
      -- CUT-3A. This path writes nothing and therefore changed nothing HubSpot can see.
      'hubspot_sync_transition',    'not_evaluated',
      'contact_settled',            true
    );
  END IF;

  -- The incumbent primary, read BEFORE anything is withdrawn. Step 5 needs to know whether
  -- the primary the operator had is still live, not merely which row ranks best now.
  SELECT p.id, p.dedupe_key
    INTO v_primary
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id AND p.is_primary
  LIMIT 1;

  IF FOUND THEN
    v_incumbent_id         := v_primary.id;
    v_previous_primary_key := v_primary.dedupe_key;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — withdraw the matching LIVE, SUPPRESSIBLE provenances.
  -- ═══════════════════════════════════════════════════════════════
  -- Only the suppression triad is written. `provider`, `acquisition_mode`, the raw provider
  -- labels, the accounting pointers, `candidate_phone_id`, `source_event_key`, `observed_at`
  -- and `created_at` are untouched — and could not be touched even by a bug, because 114
  -- grants UPDATE on three columns and no more. The row survives as evidence.
  --
  -- `suppressed_at IS NULL` is what makes a repeated erasure idempotent: the second call
  -- matches zero rows rather than re-stamping a withdrawal with a later timestamp and a
  -- possibly different actor.
  --
  -- The suppressibility predicate is 112's mapping composed with 4O-E4's allowlist, written
  -- out as the four positive cases it reduces to. `manual`, `unknown` and `(apollo, search)`
  -- are absent BY CONSTRUCTION, not by omission.

  UPDATE public.contact_phone_sources s
     SET suppressed_at      = p_suppressed_at,
         suppression_reason = p_suppression_reason,
         suppressed_by      = p_suppressed_by
   WHERE s.suppressed_at IS NULL
     AND s.contact_phone_id IN (
       SELECT p.id FROM public.contact_phones p
       WHERE p.contact_id = p_contact_id
         AND (p_dedupe_key IS NULL OR p.dedupe_key = p_dedupe_key)
     )
     AND (
       p_provider_scope = 'all_suppressible_providers'
       OR s.provider = p_provider
     )
     AND (
       s.provider = 'apollo_cache'
       OR s.provider = 'lusha'
       OR (s.provider = 'apollo' AND s.acquisition_mode IN ('reveal', 'waterfall'))
     );

  GET DIAGNOSTICS v_sources_suppressed = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — tombstone every canonical row with no live provenance left.
  -- ═══════════════════════════════════════════════════════════════
  -- This is the LAST-LIVE-SOURCE rule, and it is evaluated INSIDE the transaction that
  -- performed the withdrawal — which is the only place the answer is not a race.
  --
  -- The tombstone shape is 114's `contact_phones_tombstone_is_empty` CHECK restated: the row
  -- keeps `contact_id`, `dedupe_key`, `created_at` and its identity, and loses the number,
  -- the display form, the type and `is_primary`. Nothing is deleted, because the row IS the
  -- block: deleting it would let the next observation re-insert the erased number.
  --
  -- A canonical row whose sources were ALL ALREADY withdrawn before this call is included by
  -- `suppressed_at IS NULL` on the parent — that is a repair, not a new erasure, and it is
  -- the state a crash between step 3 and step 4 of an earlier attempt would have left. It is
  -- counted, so the audit shows it happened.

  UPDATE public.contact_phones p
     SET normalized_phone   = NULL,
         display_phone      = NULL,
         phone_type         = NULL,
         is_primary         = false,
         suppressed_at      = p_suppressed_at,
         suppression_reason = p_suppression_reason,
         suppressed_by      = p_suppressed_by
   WHERE p.contact_id = p_contact_id
     AND p.suppressed_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.contact_phone_sources s
       WHERE s.contact_phone_id = p.id
         AND s.suppressed_at IS NULL
     );

  GET DIAGNOSTICS v_tombstoned = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — re-elect a primary ONLY if the incumbent stopped being live.
  -- ═══════════════════════════════════════════════════════════════
  -- INCUMBENT STABILITY is a deliberate property, not an optimisation. An erasure must not
  -- reshuffle a collection it did not erase: if the operator's primary is still live, it
  -- STAYS the primary even when another row would now rank higher. Re-ranking on every
  -- provider erasure would silently move the number the whole product displays, for reasons
  -- that have nothing to do with the request.

  SELECT EXISTS (
    SELECT 1 FROM public.contact_phones p
    WHERE p.id = v_incumbent_id
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid'
      AND p.is_primary
  ) INTO v_incumbent_live;

  SELECT COUNT(*) INTO v_survivor_count
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
    AND p.suppressed_at IS NULL
    AND p.normalized_phone IS NOT NULL
    AND p.phone_status <> 'invalid';

  IF v_incumbent_live THEN
    v_primary_id  := v_incumbent_id;
    v_primary_key := v_previous_primary_key;
  ELSE
    -- Eligibility is 114's `contact_phones_primary_requires_live_number` CHECK restated:
    -- alive, numbered, not asserted invalid. A row this query accepts is therefore never one
    -- the database would then reject.
    --
    -- The ORDER BY, rung by rung:
    --   1. MANUAL PRECEDENCE — a live `manual` provenance wins outright. This is 4O-H0's
    --      decision and it is a TIER above the type ladder: a human-typed `work` number beats
    --      a provider-supplied `personal_mobile`, because the provider number is the one a
    --      privacy request can take away and the human one is the one somebody verified.
    --   2. best PhoneType (112's ranking, unchanged)
    --   3. `valid` over `unknown`
    --   4. most specific provenance (reveal > cache > search)
    --   5. most recent `last_seen_at`
    --   6. `dedupe_key` ascending — NOT NULL and unique per contact, so the comparator is
    --      TOTAL and the physical row order never participates in any step. Without a total
    --      comparator the "deterministic re-election" of two equally-ranked rows would be
    --      whatever the planner returned that day.
    SELECT p.id, p.dedupe_key, p.display_phone, p.normalized_phone, p.phone_type
      INTO v_primary
    FROM public.contact_phones p
    WHERE p.contact_id = p_contact_id
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid'
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM public.contact_phone_sources s
        WHERE s.contact_phone_id = p.id
          AND s.suppressed_at IS NULL
          AND s.provider = 'manual'
      ) THEN 0 ELSE 1 END,
      COALESCE(array_position(c_type_ranking, p.phone_type),
               array_length(c_type_ranking, 1) + 1),
      CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
      COALESCE((
        SELECT MIN(COALESCE(
                 array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
                 array_length(c_source_ranking, 1) + 1))
        FROM public.contact_phone_sources s
        WHERE s.contact_phone_id = p.id
          AND s.suppressed_at IS NULL
      ), array_length(c_source_ranking, 1) + 1),
      p.last_seen_at DESC,
      p.dedupe_key ASC
    LIMIT 1;

    IF FOUND THEN
      v_primary_id  := v_primary.id;
      v_primary_key := v_primary.dedupe_key;

      -- Demote first, promote second. `contact_phones_one_primary_idx` does not tolerate two
      -- primaries even for one statement, and this order needs no window.
      UPDATE public.contact_phones
         SET is_primary = false
       WHERE contact_id = p_contact_id
         AND is_primary
         AND id <> v_primary_id;

      UPDATE public.contact_phones
         SET is_primary = true
       WHERE id = v_primary_id
         AND NOT is_primary;
    ELSE
      -- Nothing electable survives. Defence in depth rather than a live path: step 4 already
      -- cleared `is_primary` on everything it tombstoned, and 114's CHECK makes "primary and
      -- not electable" unrepresentable. If the invariant were ever violated this repairs it
      -- instead of leaving a primary pointing at a number nobody may use.
      UPDATE public.contact_phones
         SET is_primary = false
       WHERE contact_id = p_contact_id
         AND is_primary;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — re-project the legacy `contacts` scalar tuple.
  -- ═══════════════════════════════════════════════════════════════
  -- The scalar is a COMPATIBILITY PROJECTION of the live primary, never a second source of
  -- truth. The real multi-source provenance lives in `contact_phone_sources` and is not
  -- reducible to one string; what the projection owes the legacy column is a value that is
  -- TRUE about a LIVE source, which is a weaker claim and an achievable one.
  --
  -- THE GUARD. If `contacts.phone_source` is not in 4O-E4's allowlist — `manual`, `unknown`,
  -- `apollo_search`, `provider_payload` or NULL — the tuple is left ENTIRELY alone. Not
  -- overwritten with the new primary, not cleared. This operation has no authority over that
  -- number: it may have been typed by a human, and 4O-E4's "FIX M1" is that a provider
  -- erasure never destroys curated data. Overwriting it with a provider number would be
  -- destroying it just as effectively as nulling it.

  IF NOT (COALESCE(BTRIM(v_contact.phone_source), '') = ANY (c_suppressible_legacy_sources)) THEN
    v_scalar_guarded := true;
  ELSE
    IF v_primary_id IS NOT NULL THEN
      SELECT p.display_phone, p.normalized_phone, p.phone_type
        INTO v_primary
      FROM public.contact_phones p
      WHERE p.id = v_primary_id;

      -- `resolveScalarPhoneFromCollection`, mirrored from 112: the display form is what the
      -- operator reads; the normalized form is the fallback when no display form was given.
      v_scalar      := COALESCE(v_primary.display_phone, v_primary.normalized_phone);
      v_scalar_type := v_primary.phone_type;

      -- Provenance comes from the most SPECIFIC **LIVE** source of the elected row. `AND
      -- s.suppressed_at IS NULL` is the whole point of §23: a scalar must never assert a
      -- provenance that has been withdrawn. When Apollo is erased and Lusha survives, this is
      -- what turns `apollo_reveal` into `lusha_reveal` in the same transaction.
      SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.observed_at
        INTO v_src
      FROM public.contact_phone_sources s
      WHERE s.contact_phone_id = v_primary_id
        AND s.suppressed_at IS NULL
      ORDER BY
        COALESCE(array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
                 array_length(c_source_ranking, 1) + 1),
        s.observed_at DESC,
        s.id ASC
      LIMIT 1;

      IF FOUND THEN
        -- 112's mapping, verbatim. Nothing is invented: when the pair maps to no value the
        -- legacy vocabulary already uses, `unknown` is a truthful statement about SellUp's
        -- knowledge and an existing member of that vocabulary, not a guess dressed as a fact.
        v_scalar_source := CASE
          WHEN v_src.provider = 'apollo_cache'                              THEN 'apollo_cache'
          WHEN v_src.provider = 'lusha'                                     THEN 'lusha_reveal'
          WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode
                 IN ('reveal', 'waterfall')                                 THEN 'apollo_reveal'
          WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode = 'search'
                                                                            THEN 'apollo_search'
          WHEN v_src.provider = 'manual'                                    THEN 'manual'
          ELSE 'unknown'
        END;
        -- Metadata is re-derived from the SURVIVING source and never carried over. Keeping
        -- Apollo's raw label next to a Lusha provenance would be asserting a fact about an
        -- observation that has been withdrawn.
        v_scalar_raw_type    := v_src.raw_provider_type;
        v_scalar_revealed_at := v_src.observed_at;
      ELSE
        -- A live canonical row with no live provenance cannot exist after step 4; if it
        -- somehow did, `unknown` is the honest answer rather than picking a provider.
        v_scalar_source := 'unknown';
      END IF;
    END IF;

    -- `phone_processing_basis` and `phone_confidence` are NOT projected.
    --
    -- `phone_processing_basis` is a LEGAL basis recorded by the reveal that observed the
    -- number; the official model has no column holding it, so any value written here would be
    -- fabricated. It is CLEARED alongside the number it belonged to, exactly as 4O-E4's patch
    -- clears it, and re-established by the writer that actually knows it.
    --
    -- `phone_confidence` remains the dead column 4O-E4 found: no writer populates it. H2 does
    -- not start. It is cleared with the rest of the tuple and never invented.
    --
    -- `mobile_phone` is NOT in this UPDATE and must not be: it has no provenance column at
    -- all (4O-E4.1), so a provider-specific erasure cannot know whether the number came from
    -- the provider it is erasing or from a human. MOBILE_PHONE_PROVENANCE_PENDING stands.
    UPDATE public.contacts
       SET phone                  = v_scalar,
           phone_type             = v_scalar_type,
           phone_source           = v_scalar_source,
           phone_raw_type         = v_scalar_raw_type,
           phone_revealed_at      = v_scalar_revealed_at,
           phone_processing_basis = NULL,
           phone_confidence       = NULL
     WHERE id = p_contact_id
       -- The provenance predicate is re-asserted at write time against the value READ under
       -- the lock. Belt and braces: the row is locked, so it cannot have changed — and if the
       -- lock were ever lost, this matches zero rows instead of erasing a tuple nobody observed.
       AND phone_source IS NOT DISTINCT FROM v_contact.phone_source
       AND (
         phone IS DISTINCT FROM v_scalar
         OR phone_type IS DISTINCT FROM v_scalar_type
         OR phone_source IS DISTINCT FROM v_scalar_source
         OR phone_raw_type IS DISTINCT FROM v_scalar_raw_type
         OR phone_revealed_at IS DISTINCT FROM v_scalar_revealed_at
         OR phone_processing_basis IS NOT NULL
         OR phone_confidence IS NOT NULL
       );

    GET DIAGNOSTICS v_contact_rows = ROW_COUNT;
    v_scalar_synced := v_contact_rows > 0;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6b — CUT-3A: HubSpot stops claiming to be up to date.
  -- ═══════════════════════════════════════════════════════════════
  -- An erasure that removed the outbound number of a HubSpot-linked contact leaves the CRM
  -- holding a number SellUp no longer has. Saying nothing would preserve a `synced` state that
  -- is false in the most consequential direction there is: the operator would believe the data
  -- is gone everywhere while HubSpot still serves it.
  --
  -- ── WHAT THIS DOES **NOT** DO ────────────────────────────────
  -- It does not export anything. It cannot: it is a metadata UPDATE inside a SQL transaction,
  -- with no network reachable from here at all. A DSAR does not push data to a third party in
  -- order to correct that third party — it RECORDS that the third party is out of date, and a
  -- human decides when to send the clearing PATCH. `phone_removed` is exactly that record, and
  -- it is the SAME vocabulary the manual path already knows how to execute; a privacy-specific
  -- state would have been a second way to say the same pending operation.
  --
  -- When the scalar tuple was GUARDED (a manual or unknown provenance this operation has no
  -- authority over), nothing was cleared, the outbound value is unchanged, and the authority
  -- returns `no_outbound_change` on its own. No special case is needed here.
  v_hs_decision := public.mark_contact_hubspot_sync_stale_for_phone(
    p_contact_id, v_hs_prev_out, p_suppressed_at
  );

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the envelope.
  -- ═══════════════════════════════════════════════════════════════
  -- Counts, booleans, a mechanical status and `primary_dedupe_key` — which is a SHA-256 by
  -- 114's design and never the number. NO phone number, NO display form, NO name, NO email
  -- leaves this function: an erasure that logged what it erased would be the leak it exists
  -- to prevent.
  --
  -- `already_suppressed` vs `suppressed` is decided by whether ANYTHING changed, so a
  -- repeated call is distinguishable from a first one WITHOUT being an error. `contact_settled`
  -- is the caller's single "the official surface of this contact is now consistent" signal.

  RETURN jsonb_build_object(
    'status',                       CASE
                                      WHEN v_sources_suppressed > 0
                                        OR v_tombstoned > 0
                                        OR v_contact_rows > 0
                                      THEN 'suppressed'
                                      ELSE 'already_suppressed'
                                    END,
    'sources_suppressed',           v_sources_suppressed,
    'phones_tombstoned',            v_tombstoned,
    'survivor_count',               v_survivor_count,
    'primary_dedupe_key',           v_primary_key,
    'primary_changed',              v_primary_key IS DISTINCT FROM v_previous_primary_key,
    'scalar_synced',                v_scalar_synced,
    'scalar_guarded_by_provenance', v_scalar_guarded,
    -- CUT-3A. MECHANICAL and PII-free, exactly like every other member here: `marked`,
    -- `already_pending`, `reason_corrected`, `not_linked`, `no_durable_state`,
    -- `no_outbound_change` or `not_previously_synced`. It reports that HubSpot was recorded as
    -- out of date, never what it holds.
    'hubspot_sync_transition',      v_hs_decision,
    'contact_settled',              true
  );
END;
$function$;