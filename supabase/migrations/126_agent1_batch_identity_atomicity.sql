-- ============================================================================
-- Migration 126: AGENT1-CUT3B4 — atomicidad de la admisión por identidad de LOTE
-- ============================================================================
--
-- QUÉ CIERRA, DICHO COMO DEFECTO
-- ------------------------------
--
-- CUT-3B2/B3 (PR #337) dejó UNA autoridad de identidad de lote en TypeScript, con
-- sus seis niveles (TIER 0 conflicto fiscal … TIER 5 nombre). Lo que NO resolvió, y
-- lo declaró por escrito, es la carrera:
--
--     Proceso A: siembra el registro del lote en el estado S → candidato A ÚNICO
--     Proceso B: siembra el registro del MISMO lote en S      → candidato B ÚNICO
--     A inserta. B inserta.
--
-- Las dos decisiones eran válidas contra S; la de B ya estaba CADUCA cuando se
-- comprometió. Ninguna barrera en base de datos lo impedía.
--
-- Esta migración añade esa barrera — y NADA MÁS que esa barrera.
--
--
-- LO QUE ESTA MIGRACIÓN NO ES
-- ---------------------------
--
-- 🔴 La base de datos NO se convierte en una SEGUNDA autoridad de identidad.
--
-- Aquí NO se normaliza un identificador fiscal, NO se normaliza un dominio, NO se
-- interpreta una URL de LinkedIn, NO se comparan ids de proveedor, NO se canoniza
-- un nombre y NO existe ningún nivel TIER. Esa política vive, entera y sin copia,
-- en `fiscal-identity.ts`, `company-identity-evidence.ts` y
-- `batch-identity-registry.ts`. Duplicarla en SQL habría creado dos ideas de «la
-- misma empresa» que divergirían en la primera corrección.
--
-- La función de escritura responde UNA sola pregunta, y no es de identidad:
--
--     ¿esta decisión de admisión se tomó contra el estado ACTUAL del lote?
--
-- Por eso tampoco se crea NINGÚN índice único de dominio, de LinkedIn, de id de
-- proveedor ni de `identity_key`. Un `UNIQUE(domain)` sería exactamente la
-- afirmación que TIER 0 existe para negar: dos personas jurídicas distintas —NIT
-- 800111222 y NIT 900333444— comparten dominio de grupo legítimamente, y un índice
-- las fusionaría en silencio. Un `UNIQUE(identity_key)` es imposible además por
-- hechos: la columna no es la autoridad plural de B23 y Producción ya contiene
-- duplicados históricos.
--
--
-- EL MECANISMO — VALLADO OPTIMISTA (OPTIMISTIC FENCING)
-- ----------------------------------------------------
--
-- `prospect_batches.identity_epoch` es un CONTADOR DE CAMBIOS por lote, no un
-- estado de negocio. TypeScript lee (filas + época) como UNA foto coherente,
-- decide con su propia política, y al persistir declara contra qué época decidió:
--
--   · época esperada == época actual ⇒ se inserta y la época avanza EXACTAMENTE 1
--   · época esperada != época actual ⇒ NO se inserta NADA, la época NO se mueve,
--                                       y se devuelve `stale` — que es control de
--                                       concurrencia normal, no una avería
--   · el INSERT falla                ⇒ la transacción entera revierte: ni fila ni
--                                       avance de época
--
-- El `FOR UPDATE` sobre la fila del lote es lo que hace REAL la garantía: dos
-- llamadas concurrentes sobre el MISMO lote se SERIALIZAN, y bajo READ COMMITTED la
-- segunda re-lee la fila ya actualizada al desbloquearse, así que ve E+1 y devuelve
-- `stale`. No es un argumento sobre el papel: es el comportamiento EvalPlanQual de
-- PostgreSQL, y la suite de PostgreSQL real de este corte lo ejercita con dos
-- sesiones de verdad.
--
-- El ámbito es UN LOTE. No hay época global ni cerrojo global: la actividad del lote
-- A no puede caducar una decisión del lote B.
--
--
-- IDEMPOTENCIA Y COMPATIBILIDAD
-- -----------------------------
--
--   · `ADD COLUMN IF NOT EXISTS` con `DEFAULT 0`: TODO lote existente arranca en 0
--     sin backfill y sin reescribir una sola fila de candidato.
--   · Sin backfill de identidades. Sin recálculo de `identity_key`. Sin tocar
--     ninguna fila histórica.
--   · Sin dependencia de la migración 124 (Agente 2A, teléfono): esta migración se
--     entiende y aplica sola.
--   · Reaplicarla no cambia una fila.
--
-- 🔴 Mientras esta migración NO esté aplicada, las tres funciones no existen y el
-- cliente de TypeScript lo detecta (SQLSTATE 42883 / PostgREST PGRST202) y conserva
-- EXACTAMENTE la ruta de escritura anterior a B4. La atomicidad está PRESENTE en el
-- código y INERTE hasta que la migración se aplique.
--
-- 0 proveedores. 0 créditos. 0 escrituras a HubSpot.
-- ============================================================================


-- ── 1. La época de identidad del lote ────────────────────────────────────────
--
-- `bigint` y no `integer`: es un contador monótono que sólo sube, y un lote de
-- larga vida con reintentos no debe poder desbordarlo.

ALTER TABLE public.prospect_batches
  ADD COLUMN IF NOT EXISTS identity_epoch BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.prospect_batches.identity_epoch IS
  'AGENT1-CUT3B4. Contador de cambios de la identidad del lote, para vallado '
  'optimista. NO es estado de negocio y NO codifica ninguna política de identidad: '
  'la autoridad de TIER 0-5 vive entera en TypeScript. Sólo lo avanza '
  'insert_fenced_prospect_candidates(), y exactamente una vez por llamada con '
  'éxito.';


-- ── 2. Foto COHERENTE de la identidad de un lote (SÓLO LECTURA) ──────────────
--
-- 🔴 Por qué esto es una función y no dos consultas.
--
-- Sembrar el registro con una consulta y leer la época con otra puede producir una
-- foto INCOHERENTE. El orden peligroso es concreto: leer las FILAS en el estado E,
-- que otro escritor inserte y avance a E+1, y leer entonces la ÉPOCA como E+1. La
-- decisión se tomaría contra las filas de E mientras se declara la época E+1 — y el
-- vallado la aceptaría, porque la época coincide. Esa es exactamente la carrera que
-- este corte cierra, reintroducida por la puerta de la lectura.
--
-- Una sola sentencia SQL ve UNA sola foto (`STABLE`, READ COMMITTED): filas y época
-- provienen del MISMO estado. Es la garantía que dos peticiones PostgREST separadas
-- no pueden dar.
--
-- Los estados que OCUPAN el lote llegan como PARÁMETRO. No se escriben aquí a
-- propósito: `BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES` es política de admisión y
-- vive en TypeScript. Codificarla también en SQL habría creado la segunda autoridad
-- que toda esta migración existe para no crear.
--
-- Devuelve las columnas CRUDAS. Ninguna se normaliza: la evidencia la compone
-- `buildCompanyIdentityEvidence`, que es el único constructor del corte.

CREATE OR REPLACE FUNCTION public.read_batch_identity_snapshot(
  p_batch_id           uuid,
  p_blocking_statuses  text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'batch_id',       b.id,
    'identity_epoch', b.identity_epoch,
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',             c.id,
            'name',           c.name,
            'domain',         c.domain,
            'website',        c.website,
            'country_code',   c.country_code,
            'tax_id',         c.tax_id,
            'tax_identifier', c.tax_identifier,
            'status',         c.status,
            'metadata',       c.metadata,
            'source_trace',   c.source_trace
          )
          ORDER BY c.created_at, c.id
        )
        FROM public.prospect_candidates c
        WHERE c.batch_id = b.id
          AND c.status = ANY (COALESCE(p_blocking_statuses, ARRAY[]::text[]))
      ),
      '[]'::jsonb
    )
  )
  FROM public.prospect_batches b
  WHERE b.id = p_batch_id;
$fn$;

COMMENT ON FUNCTION public.read_batch_identity_snapshot(uuid, text[]) IS
  'AGENT1-CUT3B4. Foto COHERENTE (filas ocupantes + identity_epoch) de un lote en '
  'UNA sola sentencia. Sólo lectura. Los estados ocupantes llegan como parámetro: '
  'la política de admisión NO se duplica en SQL.';


-- ── 3. Inserción VALLADA de candidatos ───────────────────────────────────────
--
-- Un único punto en el que la comprobación de época, el INSERT y el avance de la
-- época ocurren dentro de la MISMA transacción.
--
-- 🔴 Sobre la seguridad de la entrada. NO hay `EXECUTE`, NO hay SQL dinámico, NO hay
-- nombre de tabla ni de columna construido en tiempo de ejecución. El INSERT apunta
-- ESTÁTICAMENTE a `public.prospect_candidates`, y el payload se tipa con
-- `jsonb_populate_recordset(NULL::public.prospect_candidates, …)`, que es el
-- mecanismo TIPADO de PostgreSQL: cada clave se coacciona al tipo REAL de su
-- columna y cualquier clave desconocida se descarta sin llegar a SQL. Un proyector
-- de columnas enumerado a mano habría sido igual de seguro y estrictamente peor:
-- una columna añadida por una migración futura se perdería EN SILENCIO en la ruta
-- vallada mientras seguiría viajando por la directa.
--
-- 🔴 Sobre los DEFAULTS. `jsonb_populate_recordset` sobre un registro base NULL deja
-- en NULL todo lo que el payload no traiga — incluidas las columnas NOT NULL que
-- viven de su DEFAULT. Por eso el payload se pre-rellena con esos defaults ANTES de
-- tipar. La lista es explícita, y la suite de PostgreSQL real la RATCHEA contra el
-- catálogo: si una migración futura añade una columna NOT NULL con DEFAULT y no la
-- añade aquí, ese test FALLA. La lista no puede quedarse atrás en silencio.
--
-- 🔴 Sobre `batch_id`. Se FUERZA al lote vallado, siempre, después del payload. Un
-- llamador no puede usar el vallado de un lote para escribir en otro.
--
-- 🔴 Sobre `id`, `created_at` y `updated_at`. Se fuerzan también: dejar que el
-- llamador fije el `id` convertiría la valla en una superficie de sobrescritura.
--
-- Desenlaces:
--   'inserted'         época esperada == actual; filas escritas; época +1 exacta
--   'stale'            época esperada != actual; CERO escrituras; época intacta
--   'batch_not_found'  el lote no existe (o el llamador no lo ve por RLS)
--   'invalid_input'    payload no utilizable; CERO escrituras
--
-- Un fallo REAL del INSERT (constraint, CHECK, índice único) se PROPAGA. No se
-- captura a propósito: los escritores ya clasifican ese error —un choque con índice
-- único es un `duplicate` tardío, no una avería— y tragárselo aquí habría borrado
-- esa distinción. Al propagarse, la transacción entera revierte: ni fila, ni avance.

CREATE OR REPLACE FUNCTION public.insert_fenced_prospect_candidates(
  p_batch_id        uuid,
  p_expected_epoch  bigint,
  p_candidates      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  -- Defaults de las columnas NOT NULL que dependen de su DEFAULT. Ratcheado contra
  -- `information_schema` por la suite de PostgreSQL real de este corte.
  c_column_defaults CONSTANT jsonb := jsonb_build_object(
    'sources_checked',  '[]'::jsonb,
    'duplicate_status', 'unchecked',
    'status',           'generated',
    'metadata',         '{}'::jsonb,
    'review_flags',     '[]'::jsonb,
    'source_trace',     '{}'::jsonb,
    'hubspot_trace',    '{}'::jsonb,
    'commercial_trace', '{}'::jsonb
  );
  v_now             timestamptz := clock_timestamp();
  v_current_epoch   bigint;
  v_rows            jsonb;
  v_ids             jsonb;
  v_inserted        integer;
BEGIN
  IF p_batch_id IS NULL
     OR p_expected_epoch IS NULL
     OR p_candidates IS NULL
     OR jsonb_typeof(p_candidates) <> 'array'
     OR jsonb_array_length(p_candidates) = 0
  THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  -- Serializa a los escritores del MISMO lote. Bajo READ COMMITTED, la llamada que
  -- se queda esperando re-lee la fila YA actualizada al desbloquearse, así que ve la
  -- época avanzada y cae por la rama `stale`. Ésta es toda la garantía.
  SELECT b.identity_epoch
    INTO v_current_epoch
    FROM public.prospect_batches b
   WHERE b.id = p_batch_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'batch_not_found');
  END IF;

  IF v_current_epoch <> p_expected_epoch THEN
    -- CERO escrituras y CERO avance. La decisión de admisión era de otro estado.
    RETURN jsonb_build_object(
      'status',        'stale',
      'current_epoch', v_current_epoch
    );
  END IF;

  -- Defaults primero, payload encima, campos forzados al final: el orden decide y
  -- lo forzado no es negociable.
  SELECT jsonb_agg(
           c_column_defaults
             || elem
             || jsonb_build_object(
                  'id',         gen_random_uuid(),
                  'batch_id',   p_batch_id,
                  'created_at', v_now,
                  'updated_at', v_now
                )
         )
    INTO v_rows
    FROM jsonb_array_elements(p_candidates) AS elem
   WHERE jsonb_typeof(elem) = 'object';

  IF v_rows IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  WITH ins AS (
    INSERT INTO public.prospect_candidates
    SELECT * FROM jsonb_populate_recordset(NULL::public.prospect_candidates, v_rows)
    RETURNING id
  )
  SELECT COALESCE(jsonb_agg(ins.id), '[]'::jsonb), count(*)::integer
    INTO v_ids, v_inserted
    FROM ins;

  -- Una llamada con éxito avanza la época EXACTAMENTE una vez, escriba una fila o
  -- veinte: la época cuenta CAMBIOS del estado de identidad del lote, no filas.
  UPDATE public.prospect_batches
     SET identity_epoch = v_current_epoch + 1
   WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'status',         'inserted',
    'candidate_ids',  v_ids,
    'inserted_count', v_inserted,
    'previous_epoch', v_current_epoch,
    'next_epoch',     v_current_epoch + 1
  );
END;
$fn$;

COMMENT ON FUNCTION public.insert_fenced_prospect_candidates(uuid, bigint, jsonb) IS
  'AGENT1-CUT3B4. Comprobación de época + INSERT estáticamente dirigido a '
  'prospect_candidates + avance de época, en UNA transacción. NO contiene política '
  'de identidad: ni normalización fiscal, ni de dominio, ni de LinkedIn, ni TIER '
  'alguno. Devuelve stale sin escribir nada cuando la decisión venía de otro estado.';


-- ── 4. GRANTS — estado final declarativo ─────────────────────────────────────
--
-- `SECURITY INVOKER`: las dos funciones corren con el rol del llamador y por tanto
-- bajo SUS políticas RLS. No conceden NADA que el escritor no tuviera ya —hoy los
-- tres escritores insertan directamente en `prospect_candidates` y actualizan
-- `prospect_batches` con estos mismos roles—, así que esto no es escalada de
-- privilegio: es la MISMA capacidad, ahora transaccional.
--
-- `authenticated` está incluido porque la ruta de Lusha corre con el cliente de
-- sesión; `service_role` porque las rutas del asistente y de fuente estructurada
-- corren con el cliente administrativo. `anon` y `PUBLIC` quedan fuera, y se
-- REVOCAN primero porque en Supabase toda función nace ejecutable por PUBLIC.

REVOKE ALL ON FUNCTION public.read_batch_identity_snapshot(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_batch_identity_snapshot(uuid, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.read_batch_identity_snapshot(uuid, text[])
  TO postgres, authenticated, service_role;

REVOKE ALL ON FUNCTION public.insert_fenced_prospect_candidates(uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_fenced_prospect_candidates(uuid, bigint, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_fenced_prospect_candidates(uuid, bigint, jsonb)
  TO postgres, authenticated, service_role;
