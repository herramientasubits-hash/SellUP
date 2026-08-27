-- Migración 132 — AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL
-- (Agente 2A · la LÍNEA BASE durable de los contactos vinculados antes de que existiera el estado)
--
-- ═══════════════════════════════════════════════════════════════════
-- ⚠️ NUMERADA, Y NO APLICADA EN NINGUNA PARTE
-- ═══════════════════════════════════════════════════════════════════
--
--   APPLIED IN PRODUCTION: NO
--   APPLIED REMOTE:        NO
--   LOCAL ONLY:            YES   (sólo el arnés PostgreSQL local la aplica)
--
-- Por la MISMA razón que la 129, la 130 y la 131, y sin añadir ninguna nueva:
-- AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 la canonicalizó con la disputa 125/126/127 ya
-- cerrada en `main`. Al empezar por `\d{3}_` entra en la secuencia desplegable y DENTRO de las
-- guardas de techo, que filtran exactamente ese patrón. Numerar no la aplica: las tres líneas
-- de estado de arriba siguen siendo la verdad.
--
-- ═══════════════════════════════════════════════════════════════════
-- EL ORDEN DECLARADO Y EL ORDEN DEL DIRECTORIO YA COINCIDEN
-- ═══════════════════════════════════════════════════════════════════
--
-- El orden de aplicación DECLARADO de este tramo es:
--
--   1. 129_agent2_contact_hubspot_stale_completeness.sql
--   2. 130_agent2_contact_hubspot_stale_source.sql
--   3. 131_agent2_post_approval_reveal_stale_producer.sql
--   4. 132_agent2_hubspot_legacy_sync_state_backfill.sql   ← ESTE
--
-- Antes de la canonicalización este archivo caía TERCERO por nombre (`hubspot_…` <
-- `post_approval_…`) mientras se declaraba CUARTO, y esa discrepancia se decía aquí en voz alta
-- en vez de disimularse con un nombre retorcido. El número la ELIMINA: 132 es el último por
-- prefijo y el último por declaración, y no queda nada que recordar.
--
-- Lo que la desaparición de esa discrepancia NO cambia —y sigue siendo lo que importa— es que
-- este archivo NO DEPENDE de ninguno de los tres. No llama a `hubspot_outbound_phone`, no
-- reemplaza ni invoca `mark_contact_hubspot_sync_stale_for_phone`, no toca la 128 ni la 117 ni
-- la 115. Su única dependencia es que exista `public.contacts`. Hay una prueba que lo verifica
-- leyendo este propio archivo, para que la afirmación no dependa de que alguien la recuerde;
-- que el orden ya cuadre no la vuelve redundante, porque lo que ella defiende es la
-- INDEPENDENCIA, no la posición.
--
-- La dependencia real es al REVÉS y es de DATOS, no de esquema: la maquinaria de `stale` sólo
-- ve los contactos que este backfill inicializa. Aplicar antes o después no cambia el resultado
-- mientras nadie edite un teléfono en medio, y en un árbol local nadie lo hace.
--
-- ═══════════════════════════════════════════════════════════════════
-- QUÉ CIERRA
-- ═══════════════════════════════════════════════════════════════════
--
-- Hay contactos con `contacts.hubspot_contact_id` NO NULO y SIN bloque `metadata.hubspot_sync`
-- legible. Son anteriores a CUT-1.
--
-- Para toda la maquinaria construida en CUT-1 → FINAL CUT esos contactos son INVISIBLES:
--
--   * `mark_contact_hubspot_sync_stale_for_phone` devuelve `no_durable_state` y no escribe;
--   * `markContactHubSpotSyncStaleForPhoneChange` devuelve `{marked:false,'no_durable_state'}`;
--   * por tanto un cambio local de teléfono NUNCA los marca `stale`;
--   * y HubSpot conserva indefinidamente el número viejo —o uno que aquí ya se borró—;
--   * mientras la ficha, hasta este corte, deducía «Sincronizado» de la mera existencia del
--     vínculo y lo pintaba en VERDE. La ficha en la que el sistema menos sabía era la que con
--     más seguridad afirmaba estar al día.
--
-- Este archivo les escribe una LÍNEA BASE para que, DE AQUÍ EN ADELANTE, participen.
--
-- ═══════════════════════════════════════════════════════════════════
-- QUÉ SIGNIFICA EL `synced` QUE ESCRIBE — Y QUÉ NO
-- ═══════════════════════════════════════════════════════════════════
--
-- SIGNIFICA: existía un vínculo durable con HubSpot en el momento del backfill.
--
-- NO SIGNIFICA: que se haya comprobado que el teléfono, el email o el nombre locales coincidan
-- con los de HubSpot. Nadie lo comprobó. Este archivo no llama a HubSpot, no puede: es un
-- UPDATE de metadata dentro de una transacción SQL.
--
-- Y como esa diferencia no se puede probar leyendo el `status`, se escribe un campo propio:
-- `baseline_source = 'legacy_link_backfill'`. Vocabulario CERRADO de un miembro. La UI lo lee y
-- dice «Vinculado a HubSpot» en NEUTRO, nunca «Sincronizado» en verde.
--
-- ═══════════════════════════════════════════════════════════════════
-- POR QUÉ **NO** SE MARCA TODO COMO `stale`
-- ═══════════════════════════════════════════════════════════════════
--
-- Marcar `stale` toda la población vinculada habría sido la opción «prudente» aparente y es la
-- equivocada. `stale` afirma un hecho concreto: hay un cambio local POSTERIOR al último envío
-- que todavía no viajó. De la población histórica no se sabe eso — no se sabe nada. Afirmarlo
-- sería inventar N pendientes, y con el PATCH automático encendido cada uno sería una escritura
-- real en el CRM del cliente que nadie pidió.
--
-- La línea base no afirma frescura: la ESTABLECE COMO PUNTO DE PARTIDA. La divergencia anterior
-- al backfill queda DESCONOCIDA, y queda dicho que es desconocida.
--
-- ═══════════════════════════════════════════════════════════════════
-- QUÉ **NO** HACE
-- ═══════════════════════════════════════════════════════════════════
--
--   * NO llama a HubSpot y NO alcanza ninguna red.
--   * NO dispara el PATCH automático. No puede: el PATCH vive ENTERO en TypeScript, detrás de
--     una bandera, y se ejecuta después de una escritura LOCAL de teléfono. Un backfill de
--     metadata no es una escritura de teléfono y no tiene camino hacia ese ejecutor.
--   * NO crea contactos, NO crea vínculos, NO inventa un `hubspot_contact_id`.
--   * NO escribe `contacts.phone` ni `contacts.mobile_phone`. Ni siquiera las lee.
--   * NO inventa horas de sincronización: `attempted_at` queda NULL y `synced_at` no se crea
--     nunca —si el bloque legado ya traía uno, se CONSERVA tal cual; si no lo traía, sigue sin
--     existir—.
--   * NO adivina un `method`. Ver la auditoría de `mode` más abajo.
--   * NO toca contactos ARCHIVADOS: todos los caminos de sincronización de este repo filtran
--     `archived_at IS NULL`, así que inicializar un archivado escribiría estado para una fila
--     que ninguna maquinaria va a mirar.
--   * NO resuelve conflictos: cuando el bloque legado recuerda un id de HubSpot distinto del de
--     la columna, se SALTA la fila y se cuenta aparte.
--   * NO crea tabla de auditoría. Los recuentos son el valor de retorno de una función.
--
-- ═══════════════════════════════════════════════════════════════════
-- AUDITORÍA DEL `mode` LEGADO — POR QUÉ `method` QUEDA NULL SIEMPRE
-- ═══════════════════════════════════════════════════════════════════
--
-- El bloque que el hito 17A.4C escribía (y que sigue vivo en Producción) es EXACTAMENTE:
--
--   { status, synced_at, synced_by, hubspot_contact_id, mode, hubspot_company_id,
--     company_association }
--
-- con `mode ∈ {created, linked_existing}`.
--
-- Ese `mode` NO es el eje `method`. Dice CÓMO SE OBTUVO EL VÍNCULO —se creó una ficha nueva o se
-- enlazó una existente—, no QUIÉN disparó el intento. `method ∈ {manual, auto}` responde otra
-- pregunta y no hay función total del uno al otro: los dos valores de `mode` son compatibles con
-- los dos de `method`.
--
-- Por tanto: NO SE MAPEA. `method` queda NULL, que es la verdad —no consta el origen del
-- intento—, y `mode` se CONSERVA intacto como lo que es: auditoría.
--
-- (Un `method` ya escrito en el bloque tampoco se conserva, y por una razón que no es descuido:
-- una fila sólo es elegible porque su `status` NO es legible, es decir porque el bloque no lo
-- escribió ningún escritor conocido de este contrato. Heredar de ahí un `method` sería atribuir
-- a una persona o al autosync un intento que ningún escritor reconocido registró. Un bloque con
-- `method` fiable tiene `status` fiable, y ése no es elegible.)
--
-- ═══════════════════════════════════════════════════════════════════
-- IDEMPOTENCIA
-- ═══════════════════════════════════════════════════════════════════
--
-- La condición de elegibilidad exige que NO haya estado durable legible. El backfill escribe uno.
-- Por construcción, la segunda pasada encuentra cero filas elegibles y cambia CERO. No hace falta
-- una marca de «ya corrió»: el propio efecto es la marca.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. LA clasificación. Una fila, una clase, sin solapes.
-- ═══════════════════════════════════════════════════════════════════
--
-- Función PURA: recibe los tres valores de la fila que importan y no lee ninguna tabla. Existe
-- separada del UPDATE para que la MISMA regla decida a quién se escribe y a quién se cuenta —dos
-- copias de este predicado acabarían informando de una población distinta de la que se tocó.
--
-- El vocabulario de `status` es el CERRADO del contrato, copiado literal de CUT-3C y de
-- `readHubSpotSyncState`. «Legible» significa aquí exactamente lo mismo que allí, o el backfill
-- inicializaría filas que la autoridad de `stale` ya sabía leer.
--
-- ── EL ORDEN DE LAS RAMAS ES LA POLÍTICA ─────────────────────────
--
--   1. sin vínculo en la COLUMNA        → jamás se toca. Dos clases, para poder ver la anomalía
--                                          de un bloque que afirma un vínculo que la fila no tiene.
--   2. archivado                        → jamás se toca.
--   3. id embebido ≠ id de la columna   → CONFLICTO, jamás se toca. Va ANTES de `valid_state`
--                                          a propósito: un bloque que recuerda otro vínculo es
--                                          digno de informe aunque su `status` sea legible, y
--                                          ninguna de las dos clases se escribe nunca, así que
--                                          adelantarlo no cambia una sola fila — sólo la cuenta
--                                          en el sitio donde alguien la va a mirar.
--   4. estado durable legible           → intacto. Es la garantía de «no pisar CUT-1..3C».
--   5. resto                            → ELEGIBLE.

CREATE OR REPLACE FUNCTION public.hubspot_legacy_sync_backfill_class(
  p_hubspot_contact_id text,
  p_archived_at        timestamptz,
  p_metadata           jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  c_statuses text[] := ARRAY[
    'never_attempted', 'blocked_no_email', 'blocked_no_hubspot_company',
    'synced', 'stale', 'failed'
  ];
  v_link     text;
  v_block    jsonb;
  v_status   text;
  v_embedded text;
BEGIN
  -- El vínculo se lee de la COLUMNA. Un id con espacios o vacío no es un vínculo.
  v_link := NULLIF(BTRIM(COALESCE(p_hubspot_contact_id, '')), '');

  v_block := p_metadata -> 'hubspot_sync';
  IF v_block IS NULL OR jsonb_typeof(v_block) <> 'object' THEN
    -- Un array o un escalar donde debería haber un objeto NO es un bloque. Mismo criterio que
    -- `readHubSpotSyncState`, que rechaza los arrays explícitamente.
    v_block := NULL;
  ELSE
    v_status := v_block ->> 'status';
    IF v_status IS NULL OR NOT (v_status = ANY (c_statuses)) THEN
      v_status := NULL;
    END IF;
    v_embedded := NULLIF(BTRIM(COALESCE(v_block ->> 'hubspot_contact_id', '')), '');
  END IF;

  IF v_link IS NULL THEN
    -- CASO D — la metadata afirma un vínculo que la fila no tiene. NO se inventa la columna:
    -- crear un vínculo a partir de un recuerdo escribiría en el CRM del cliente contra una
    -- ficha que nadie ha confirmado que exista. Se cuenta aparte y se deja como está.
    IF v_block IS NOT NULL AND (v_embedded IS NOT NULL OR v_status = 'synced') THEN
      RETURN 'unlinked_state_claims_link';
    END IF;
    RETURN 'unlinked';
  END IF;

  IF p_archived_at IS NOT NULL THEN
    RETURN 'archived_linked';
  END IF;

  -- CASO C — dos ids distintos. Sobrescribir el bloque con el de la columna elegiría un ganador
  -- sin ninguna prueba de cuál es el vínculo vivo, y borraría la única pista de que hubo dos.
  IF v_embedded IS NOT NULL AND v_embedded <> v_link THEN
    RETURN 'conflict_embedded_id';
  END IF;

  -- Estado escrito por un escritor CONOCIDO del contrato: `never_attempted`, los dos bloqueos,
  -- `synced`, `stale` y `failed` quedan TODOS intactos.
  IF v_status IS NOT NULL THEN
    RETURN 'valid_state';
  END IF;

  -- CASOS A y B — sin bloque, o con bloque ilegible cuyo id embebido falta o COINCIDE.
  RETURN 'eligible';
END;
$function$;

COMMENT ON FUNCTION public.hubspot_legacy_sync_backfill_class(text, timestamptz, jsonb) IS
  'AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL — clasifica UNA fila de contacts para el backfill de la linea base de hubspot_sync. Funcion PURA: no lee tablas, no llama a HubSpot, no escribe. Devuelve exactamente una clase de un vocabulario CERRADO: unlinked, unlinked_state_claims_link (la metadata afirma un vinculo que la columna no tiene), archived_linked, conflict_embedded_id (el bloque recuerda otro id de HubSpot), valid_state (hay estado durable legible: intocable) o eligible. Legible significa lo mismo que en readHubSpotSyncState: bloque objeto con status dentro del vocabulario cerrado de seis miembros.';

REVOKE ALL ON FUNCTION public.hubspot_legacy_sync_backfill_class(text, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hubspot_legacy_sync_backfill_class(text, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.hubspot_legacy_sync_backfill_class(text, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hubspot_legacy_sync_backfill_class(text, timestamptz, jsonb)
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 2. El CENSO. La observabilidad, sin tabla de auditoría.
-- ═══════════════════════════════════════════════════════════════════
--
-- Devuelve el recuento por clase de TODA la tabla. Es de sólo lectura y sin PII: sólo números.
--
-- No hay tabla de auditoría porque no hace falta ninguna: el censo se puede volver a calcular
-- en cualquier momento a partir de las filas, y una tabla congelaría una foto que envejecería
-- sin que nadie la actualizara. Lo único que una tabla añadiría —«cuántas había ANTES»— lo
-- devuelve la propia función de backfill, que censa antes y después de su UPDATE.

CREATE OR REPLACE FUNCTION public.hubspot_legacy_sync_backfill_census()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT jsonb_build_object(
           'eligible',                  COALESCE(SUM((k = 'eligible')::int), 0),
           'valid_state',               COALESCE(SUM((k = 'valid_state')::int), 0),
           'conflict_embedded_id',      COALESCE(SUM((k = 'conflict_embedded_id')::int), 0),
           'archived_linked',           COALESCE(SUM((k = 'archived_linked')::int), 0),
           'unlinked',                  COALESCE(SUM((k = 'unlinked')::int), 0),
           'unlinked_state_claims_link', COALESCE(SUM((k = 'unlinked_state_claims_link')::int), 0),
           'total',                     COUNT(*)
         )
  FROM (
    SELECT public.hubspot_legacy_sync_backfill_class(
             c.hubspot_contact_id, c.archived_at, c.metadata
           ) AS k
    FROM public.contacts c
  ) AS classified;
$function$;

COMMENT ON FUNCTION public.hubspot_legacy_sync_backfill_census() IS
  'AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL — recuento por clase de toda la tabla contacts. Solo LECTURA y solo numeros: cero PII, cero ids. Es la observabilidad del backfill y sustituye a una tabla de auditoria, que congelaria una foto en vez de poder recalcularla.';

REVOKE ALL ON FUNCTION public.hubspot_legacy_sync_backfill_census() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hubspot_legacy_sync_backfill_census() FROM anon;
REVOKE ALL ON FUNCTION public.hubspot_legacy_sync_backfill_census() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hubspot_legacy_sync_backfill_census() TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 3. EL backfill.
-- ═══════════════════════════════════════════════════════════════════
--
-- ── POR QUÉ ES UNA FUNCIÓN Y NO UN UPDATE SUELTO ─────────────────
-- Para poder llamarla dos veces desde una prueba y comprobar que la segunda cambia CERO filas,
-- y para poder pasarle un reloj FIJO en vez de depender de `now()`. Un UPDATE suelto dentro de
-- la migración sería intestable en las dos dimensiones que más importan aquí.
--
-- ── LA FORMA DEL BLOQUE RESULTANTE ───────────────────────────────
--   bloque_previo  ||  sobrescrituras
--
-- El `||` conserva TODO lo que las sobrescrituras no nombran, y ahí está la auditoría legada
-- que la UI sigue leyendo: `synced_at`, `synced_by`, `mode`, `hubspot_company_id`,
-- `company_association`, y también los anexos operativos `auto_sync` / `auto_update` si los
-- hubiera. Nada de eso se pierde.
--
-- Las sobrescrituras nombran los OCHO campos del contrato, TODOS, para que el bloque resultante
-- sea completo y legible sin depender de qué traía el anterior:
--
--   status               'synced'   ← el vínculo existe. Sólo eso.
--   method               NULL       ← no consta el origen del intento. Ver la auditoría del `mode`.
--   attempted_at         NULL       ← no consta ningún intento. Estampar una hora lo inventaría.
--   last_error           NULL       ← un `synced` con error sería incoherente.
--   hubspot_contact_id   la COLUMNA ← la verdad del vínculo, recortada. Nunca el id embebido:
--                                     cuando difieren la fila ni siquiera es elegible.
--   stale_since          NULL       ┐  la línea base declara que NO consta nada pendiente. Un
--   stale_reason         NULL       ├─ marcador heredado de un bloque cuyo `status` era ilegible
--   stale_source         NULL       ┘  instruiría al ejecutor sobre una operación que nadie pidió.
--
-- más las dos anotaciones de procedencia:
--
--   baseline_source      'legacy_link_backfill'
--   baseline_at          la hora en que el backfill OBSERVÓ el vínculo — NO una hora de
--                        sincronización, y por eso no se llama `synced_at` ni la sobrescribe.
--                        Formato ISO-8601 UTC construido a mano, por la misma razón que en
--                        CUT-3C: `to_jsonb(timestamptz)` renderiza en la zona de la SESIÓN y
--                        produciría dos representaciones del mismo campo durable.

CREATE OR REPLACE FUNCTION public.backfill_legacy_hubspot_sync_state(p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_before  jsonb;
  v_after   jsonb;
  v_updated bigint := 0;
  v_now_iso text;
BEGIN
  IF p_now IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  v_now_iso := to_char(p_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_before  := public.hubspot_legacy_sync_backfill_census();

  WITH touched AS (
    UPDATE public.contacts c
       SET metadata =
             COALESCE(c.metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'hubspot_sync',
                  COALESCE(
                    CASE
                      WHEN jsonb_typeof(c.metadata -> 'hubspot_sync') = 'object'
                        THEN c.metadata -> 'hubspot_sync'
                    END,
                    '{}'::jsonb
                  )
                  || jsonb_build_object(
                       -- Los `NULL` van CUALIFICADOS (`::text`). `jsonb_build_object` es
                       -- VARIADIC "any" y un NULL sin tipo aborta con 42P18 («could not
                       -- determine data type»): el fallo sería en tiempo de ejecución, dentro
                       -- de la migración, y no al escribirla.
                       'status',             'synced',
                       'method',             NULL::text,
                       'attempted_at',       NULL::text,
                       'last_error',         NULL::text,
                       'hubspot_contact_id', BTRIM(c.hubspot_contact_id),
                       'stale_since',        NULL::text,
                       'stale_reason',       NULL::text,
                       'stale_source',       NULL::text,
                       'baseline_source',    'legacy_link_backfill',
                       'baseline_at',        v_now_iso
                     )
                )
     WHERE public.hubspot_legacy_sync_backfill_class(
             c.hubspot_contact_id, c.archived_at, c.metadata
           ) = 'eligible'
    RETURNING 1 AS one
  )
  SELECT COUNT(*) INTO v_updated FROM touched;

  v_after := public.hubspot_legacy_sync_backfill_census();

  -- El informe. Sin PII y sin un solo id: sólo la clase y su recuento.
  --
  -- `eligible_count` es el de ANTES —cuántas había que inicializar— y `after.eligible` debe ser
  -- CERO en la primera pasada: si no lo fuera, la condición del UPDATE y la del censo habrían
  -- divergido, que es exactamente el fallo que la función compartida existe para impedir. Hay
  -- una prueba que lo afirma.
  RETURN jsonb_build_object(
    'status',                    'ok',
    'ran_at',                    v_now_iso,
    'eligible_count',            v_before -> 'eligible',
    'updated_count',             v_updated,
    'conflict_count',            v_before -> 'conflict_embedded_id',
    'skipped_valid_state_count', v_before -> 'valid_state',
    'skipped_archived_count',    v_before -> 'archived_linked',
    'skipped_unlinked_count',    v_before -> 'unlinked',
    'anomaly_unlinked_state_claims_link_count',
                                 v_before -> 'unlinked_state_claims_link',
    'before',                    v_before,
    'after',                     v_after
  );
END;
$function$;

COMMENT ON FUNCTION public.backfill_legacy_hubspot_sync_state(timestamptz) IS
  'AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL — escribe la LINEA BASE durable de hubspot_sync sobre los contactos VINCULADOS y NO archivados que no tienen estado legible. status=synced significa aqui EXACTAMENTE que existia un vinculo durable en el momento del backfill, y NO que se haya comprobado que las propiedades locales coincidan con las de HubSpot: nadie lo comprobo, esta funcion no llama a HubSpot ni alcanza ninguna red. Por eso escribe baseline_source=legacy_link_backfill, que la UI lee para decir Vinculado a HubSpot en neutro en vez de Sincronizado en verde. method, attempted_at, last_error y los tres marcadores de pendiente quedan NULL: no consta ningun intento y no se inventa ninguna hora. El mode legado (created/linked_existing) NO se mapea a method (manual/auto): son ejes distintos. Conserva intacta toda la auditoria legada por el operador ||. NO toca filas con estado legible, archivadas, sin vinculo, ni aquellas cuyo bloque recuerda otro id de HubSpot. NO crea contactos, NO crea vinculos, NO escribe telefonos y NO dispara el PATCH automatico, que vive entero en TypeScript detras de una bandera y solo corre despues de una escritura LOCAL de telefono. Idempotente por construccion: la segunda pasada no encuentra filas elegibles. Devuelve un informe de RECUENTOS sin PII.';

REVOKE ALL ON FUNCTION public.backfill_legacy_hubspot_sync_state(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_legacy_hubspot_sync_state(timestamptz) FROM anon;
-- `authenticated` NO recibe nada, por la misma razón que en CUT-3C: esto no es una operación que
-- un cliente pida, es una reparación de datos que un operador ejecuta una vez. Un cliente capaz
-- de invocarla podría declarar `synced` la ficha de cualquier contacto vinculado sin haber
-- comprobado nada — y, peor, borrar los marcadores de un pendiente ajeno si algún día la
-- condición de elegibilidad se relajara por descuido.
REVOKE ALL ON FUNCTION public.backfill_legacy_hubspot_sync_state(timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_legacy_hubspot_sync_state(timestamptz)
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 4. La ejecución. Una vez, aquí, con el reloj del servidor.
-- ═══════════════════════════════════════════════════════════════════
--
-- Se ejecuta DENTRO de la migración porque el cambio de datos ES la migración; dejarlo para que
-- alguien lo lanzara a mano convertiría el corte en un runbook que se puede olvidar.
--
-- Los recuentos salen por `RAISE NOTICE` para que queden en el log de aplicación. No se guardan
-- en ninguna tabla: el censo se recalcula cuando haga falta llamando a la función.

DO $$
DECLARE
  v_report jsonb;
BEGIN
  v_report := public.backfill_legacy_hubspot_sync_state(now());
  RAISE NOTICE 'AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL %', v_report::text;
END $$;

COMMIT;
