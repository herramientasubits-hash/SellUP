// Agente 2A — DERIVACIÓN de la migración 113 (AGENT2A-PHONE-REVEAL-4O-E3)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// La 113 tiene que volver a declarar ENTERAS las dos funciones de las migraciones
// 110 y 111: `CREATE OR REPLACE FUNCTION` con la MISMA firma sustituye el cuerpo
// completo, y no hay forma de «parchear» unas líneas. Son ~1.800 líneas de SQL que,
// copiadas a mano, se convierten en el riesgo real de este hito: una divergencia
// silenciosa entre lo que la 110/111 hace hoy en Producción y lo que la 113
// desplegaría mañana no la ve nadie leyendo el diff.
//
// Así que la 113 no se escribe: se DERIVA. Este módulo lee el SQL real de la 110 y
// de la 111 en disco y les aplica un conjunto CERRADO de tres ediciones literales
// por función (una variable de DECLARE, cuatro columnas más en el SELECT del lock y
// un bloque nuevo Step 2b). Cualquier otra diferencia es imposible por construcción.
//
// La suite estática de E3 llama a `buildPhonePersonSuppressionRecheckMigration()` y
// compara byte a byte con el archivo en disco. Si alguien edita la 113 a mano, o
// edita la 110/111 sin regenerar, el check obligatorio falla.
//
// NO es código de producción: vive bajo `__tests__/support` y nadie lo importa
// desde `src` fuera de las pruebas. No lee flags, no toca red y no ejecuta SQL.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nombre del archivo de migración que este módulo deriva. */
export const MIGRATION_113_FILENAME =
  '113_phone_reveal_person_suppression_recheck.sql';

export interface FunctionRestatementEdit {
  /** Migración de la que se toma el cuerpo ORIGINAL. */
  sourceFile: string;
  /** Nombre de la función restatement. */
  functionName: string;
  /** Línea de DECLARE a partir de la cual se insertan las variables nuevas. */
  declareAnchor: string;
  declareAdd: string;
  /** `SELECT … INTO v_candidate` del lock, tal cual está en la migración origen. */
  selectAnchor: string;
  selectReplacement: string;
  /** Resolución del id de persona, distinta en cada proveedor. */
  personExpr: string;
  /** Sobre `suppressed` con la forma EXACTA que ya devuelve esa función. */
  suppressedReturn: string;
}

/**
 * Ancla de inserción: el encabezado del Step 3 existente. El bloque nuevo va
 * inmediatamente ANTES, así que la comprobación por persona ocurre después del lock
 * y del token de pertenencia, y antes de cualquier lectura o escritura de números.
 */
export const STEP_3_ANCHOR =
  '  -- ═══════════════════════════════════════════════════════════════\n' +
  '  -- Step 3 — tombstones, re-checked UNDER the lock.\n';

export const APOLLO_EDIT: FunctionRestatementEdit = {
  sourceFile: '110_persist_candidate_apollo_phone_reveal_result.sql',
  functionName: 'persist_candidate_apollo_phone_reveal_result',
  declareAnchor: '  v_legacy_suppressed boolean := false;\n',
  declareAdd:
    '  -- AGENT2A-PHONE-REVEAL-4O-E3 — clave de la supresión POR PERSONA, resuelta bajo el lock.\n' +
    '  v_person_id         text    := NULL;\n' +
    '  v_account_id        uuid    := NULL;\n',
  selectAnchor:
    '  SELECT c.id,\n' +
    '         c.enrichment_metadata,\n' +
    '         c.phone_reveal_status,\n' +
    '         c.phone_reveal_request_id\n' +
    '    INTO v_candidate\n',
  selectReplacement:
    '  SELECT c.id,\n' +
    '         c.enrichment_metadata,\n' +
    '         c.phone_reveal_status,\n' +
    '         c.phone_reveal_request_id,\n' +
    '         -- AGENT2A-PHONE-REVEAL-4O-E3 — columnas con las que se resuelve la clave de la\n' +
    '         -- supresión POR PERSONA sin salir de la transacción ni del lock.\n' +
    '         c.enrichment_run_id,\n' +
    '         c.apollo_person_id,\n' +
    '         c.source,\n' +
    '         c.source_contact_id\n' +
    '    INTO v_candidate\n',
  personExpr:
    '  v_person_id := COALESCE(\n' +
    '    -- 1. el id que este mismo evento acaba de confirmar para la persona;\n' +
    '    public.phone_reveal_normalized_apollo_person_id(p_apollo_person_id),\n' +
    '    -- 2. la columna del candidato (migración 098);\n' +
    '    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),\n' +
    '    -- 3. `source_contact_id` SOLO si el candidato es de origen Apollo.\n' +
    "    CASE WHEN v_candidate.source = 'apollo'\n" +
    '      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)\n' +
    '    END\n' +
    '  );\n',
  suppressedReturn:
    '    RETURN jsonb_build_object(\n' +
    "      'status',                   'suppressed',\n" +
    "      'inserted_phone_count',     0,\n" +
    "      'updated_phone_count',      0,\n" +
    "      'inserted_source_count',    0,\n" +
    "      'suppressed_skipped_count', 0,\n" +
    "      'primary_dedupe_key',       NULL,\n" +
    "      'primary_set',              false,\n" +
    "      'candidate_terminalized',   false\n" +
    '    );\n',
};

export const LUSHA_EDIT: FunctionRestatementEdit = {
  sourceFile: '111_persist_candidate_lusha_phone_reveal_result.sql',
  functionName: 'persist_candidate_lusha_phone_reveal_result',
  declareAnchor: '  v_legacy_suppressed  boolean := false;\n',
  declareAdd:
    '  -- AGENT2A-PHONE-REVEAL-4O-E3 — clave de la supresión POR PERSONA, resuelta bajo el lock.\n' +
    '  v_person_id          text    := NULL;\n' +
    '  v_account_id         uuid    := NULL;\n',
  selectAnchor:
    '  SELECT c.id,\n' +
    '         c.enrichment_metadata,\n' +
    '         c.phone_reveal_status,\n' +
    '         c.phone_reveal_provider\n' +
    '    INTO v_candidate\n',
  selectReplacement:
    '  SELECT c.id,\n' +
    '         c.enrichment_metadata,\n' +
    '         c.phone_reveal_status,\n' +
    '         c.phone_reveal_provider,\n' +
    '         -- AGENT2A-PHONE-REVEAL-4O-E3 — columnas con las que se resuelve la clave de la\n' +
    '         -- supresión POR PERSONA sin salir de la transacción ni del lock.\n' +
    '         c.enrichment_run_id,\n' +
    '         c.apollo_person_id,\n' +
    '         c.source,\n' +
    '         c.source_contact_id\n' +
    '    INTO v_candidate\n',
  // Lusha no entrega ningún id de persona Apollo, así que la clave sale del
  // candidato — que es el MISMO sujeto que la DSAR borró. Un id Lusha
  // (`v1.<token>`) lo rechaza el validador y nunca se usa como clave.
  personExpr:
    '  v_person_id := COALESCE(\n' +
    '    -- 1. la columna del candidato (migración 098);\n' +
    '    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),\n' +
    '    -- 2. `source_contact_id` SOLO si el candidato es de origen Apollo.\n' +
    "    CASE WHEN v_candidate.source = 'apollo'\n" +
    '      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)\n' +
    '    END\n' +
    '  );\n',
  suppressedReturn:
    '    RETURN jsonb_build_object(\n' +
    "      'status',                   'suppressed',\n" +
    "      'inserted_phone_count',     0,\n" +
    "      'updated_phone_count',      0,\n" +
    "      'inserted_source_count',    0,\n" +
    "      'suppressed_skipped_count', 0,\n" +
    "      'primary_dedupe_key',       NULL,\n" +
    "      'primary_set',              false,\n" +
    "      'candidate_scalar_updated', false,\n" +
    "      'candidate_terminalized',   false\n" +
    '    );\n',
};

export const FUNCTION_EDITS: readonly FunctionRestatementEdit[] = [
  APOLLO_EDIT,
  LUSHA_EDIT,
];

/** El bloque nuevo, idéntico salvo por la resolución del id y el sobre de salida. */
export function buildStep2bBlock(edit: FunctionRestatementEdit): string {
  return (
    '  -- ═══════════════════════════════════════════════════════════════\n' +
    '  -- Step 2b — PERSON-level suppression, re-checked UNDER the lock (4O-E3).\n' +
    '  -- ═══════════════════════════════════════════════════════════════\n' +
    '  -- Step 3 re-checks the tombstones of the NUMBERS this event carries, and on its own\n' +
    '  -- that is not enough. A DSAR erases a PERSON: what it tombstoned are the numbers the\n' +
    '  -- collection ALREADY held. A number this provider had never returned before has no\n' +
    '  -- tombstone to match, so the number-level check waves it through — and the person\n' +
    '  -- whose data was erased ends up with a live phone again, minutes after the erasure.\n' +
    '  --\n' +
    '  -- The TypeScript guard (`evaluateInFlightPhoneSuppression`) reads exactly this state,\n' +
    '  -- but it reads it BEFORE the provider call and OUTSIDE this lock, so a suppression\n' +
    '  -- that commits in between is invisible to it. Reading it HERE puts the check inside\n' +
    '  -- the very transaction that would otherwise persist the result:\n' +
    '  --\n' +
    '  --   * erasure commits first  ⇒ this SELECT sees the tombstone ⇒ nothing is written;\n' +
    '  --   * this transaction first ⇒ the erasure that follows takes this same candidate\n' +
    '  --     lock and tombstones what was written (migration 112).\n' +
    '  --\n' +
    '  -- Both orderings end suppressed, which is the property the pre-call guard alone could\n' +
    '  -- not provide. The DSAR writes the cache tombstone BEFORE it propagates to the\n' +
    '  -- collection (`phone-cache-suppression-actions.ts`), so neither interleaving of those\n' +
    '  -- two writes leaves a window either.\n' +
    '  --\n' +
    '  -- The key is the one the durable tombstone ALREADY uses — (apollo, person, account)\n' +
    '  -- in `phone_reveal_cache` — so no new suppression model is introduced here and the\n' +
    '  -- candidate-level model stays deferred. Country is deliberately NOT part of the key:\n' +
    '  -- an erasure blocks that person in that account even if the candidate country changes.\n' +
    '  --\n' +
    '  -- No person id or no account means there is no key to match. That is the guard\n' +
    '  -- `not_evaluable` limit and it is NOT turned into a block by inference: no matching by\n' +
    '  -- phone, email, name or LinkedIn happens here or anywhere else.\n' +
    '  --\n' +
    '  -- The provider was already called and already charged by the time this runs. This step\n' +
    '  -- withholds the NUMBER, never the cost: no usage log, reservation or waterfall row is\n' +
    '  -- written from inside this function, so the spend survives exactly as it was recorded.\n' +
    '\n' +
    '  SELECT r.account_id\n' +
    '    INTO v_account_id\n' +
    '  FROM public.contact_enrichment_runs r\n' +
    '  WHERE r.id = v_candidate.enrichment_run_id;\n' +
    '\n' +
    edit.personExpr +
    '\n' +
    '  IF v_person_id IS NOT NULL\n' +
    '     AND v_account_id IS NOT NULL\n' +
    '     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN\n' +
    '    -- Fail closed with NOTHING written and WITHOUT terminalizing the candidate, exactly\n' +
    '    -- like the number-level verdict below. The terminal trace (`error` +\n' +
    '    -- `blocked_suppressed`), the run abort and the reservation settlement belong to the\n' +
    '    -- 4O-E1 policy in the TypeScript layer and are NOT duplicated in SQL.\n' +
    edit.suppressedReturn +
    '  END IF;\n' +
    '\n'
  );
}

/**
 * Extrae `CREATE OR REPLACE FUNCTION public.<fn>(` … `END $$;\n` (inclusive).
 *
 * El terminador es `END $$;` y no `$$;` a secas porque el cuerpo contiene literales
 * dollar-quoted anidados (`$fn$`) y varios `END` de bloque: anclar en el cierre real
 * de la función evita cortar por un delimitador interior.
 */
export function extractFunctionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}(`);
  if (start < 0) throw new Error(`function not found in source: ${functionName}`);
  const terminator = '\nEND $$;\n';
  const end = sql.indexOf(terminator, start);
  if (end < 0) throw new Error(`function terminator not found: ${functionName}`);
  return sql.slice(start, end + terminator.length);
}

function replaceExactlyOnce(
  text: string,
  find: string,
  replacement: string,
  label: string,
): string {
  const first = text.indexOf(find);
  if (first < 0) throw new Error(`anchor not found: ${label}`);
  if (text.indexOf(find, first + find.length) >= 0) {
    throw new Error(`anchor not unique: ${label}`);
  }
  return text.slice(0, first) + replacement + text.slice(first + find.length);
}

/**
 * Las TRES ediciones cerradas. El orden es irrelevante (las anclas no se solapan),
 * pero se aplican siempre igual para que la salida sea determinista.
 */
export function transformFunctionBody(
  body: string,
  edit: FunctionRestatementEdit,
): string {
  let out = replaceExactlyOnce(
    body,
    edit.declareAnchor,
    edit.declareAnchor + edit.declareAdd,
    `${edit.functionName}:declare`,
  );
  out = replaceExactlyOnce(
    out,
    edit.selectAnchor,
    edit.selectReplacement,
    `${edit.functionName}:select`,
  );
  out = replaceExactlyOnce(
    out,
    STEP_3_ANCHOR,
    buildStep2bBlock(edit) + STEP_3_ANCHOR,
    `${edit.functionName}:step3`,
  );
  return out;
}

/** Cabecera declarativa + los dos helpers nuevos. */
export const MIGRATION_113_HEADER = `-- Migration 113: person-level phone suppression re-checked INSIDE the persistence
-- transaction (AGENT2A-PHONE-REVEAL-4O-E3)
--
-- ── QUÉ DEFECTO CIERRA ─────────────────────────────────────────────
--
-- Las migraciones 110 y 111 ya vuelven a comprobar, bajo el lock del candidato, los
-- tombstones de los NÚMEROS que trae el evento. Eso deja fuera el caso que importa:
-- una DSAR borra una PERSONA, y lo que tombstonea son los números que la colección
-- YA tenía. Un número que el proveedor no había devuelto nunca no tiene tombstone
-- que emparejar, así que la comprobación por número lo deja pasar y la persona
-- borrada vuelve a tener teléfono visible minutos después de la supresión.
--
-- La comprobación POR PERSONA sí existía, pero solo en TypeScript
-- (\`evaluateInFlightPhoneSuppression\`), y allí se lee ANTES de la llamada al
-- proveedor y FUERA del lock. Entre esa lectura y el COMMIT de la persistencia caben
-- la respuesta del proveedor y una DSAR entera. Esta migración mueve la comprobación
-- DENTRO de la transacción que persiste el resultado, que es el único sitio donde
-- puede ser una garantía y no una carrera ganada por casualidad.
--
-- ── QUÉ NO CAMBIA ──────────────────────────────────────────────────
--
--   * la FIRMA de las dos funciones es idéntica — mismo nombre, mismos parámetros,
--     mismo tipo de retorno—, así que ningún llamador cambia y PostgREST no queda
--     con dos sobrecargas ambiguas;
--   * el sobre de respuesta no gana ni pierde claves: el veredicto nuevo reutiliza
--     el \`status = 'suppressed'\` que las dos funciones ya devolvían;
--   * la política terminal (\`error\` + \`blocked_suppressed\`), el aborto de la
--     corrida y la liquidación de la reserva siguen siendo de 4O-E1, en TypeScript;
--   * el COSTO REAL no se toca: esta función no escribe usage logs, ni reservas, ni
--     filas de corrida. Retiene el NÚMERO, nunca el cargo ya incurrido;
--   * no se crea ningún modelo de supresión nuevo. La clave es la que el tombstone
--     duradero ya usa: (apollo, provider_person_id, account_id) en
--     \`phone_reveal_cache\`. El modelo de supresión A NIVEL DE CANDIDATO sigue
--     pendiente y NO se introduce aquí.
--
-- ── POR QUÉ SE VUELVEN A DECLARAR ENTERAS ──────────────────────────
--
-- \`CREATE OR REPLACE FUNCTION\` sustituye el cuerpo completo: no existe forma de
-- parchear unas líneas. Para que la restatement no pueda divergir de lo que hoy
-- corre en Producción, este archivo NO se escribió a mano — se DERIVA del SQL real
-- de la 110 y la 111 aplicando tres ediciones literales por función, y la suite
-- estática de E3 vuelve a derivarlo y compara byte a byte con este archivo.
--
-- Las migraciones 110 y 111 NO se modifican: siguen en disco tal cual se aplicaron.
--
-- ── SEGURIDAD ──────────────────────────────────────────────────────
--
-- Todo lo que se crea aquí es SECURITY INVOKER con \`search_path\` fijado, sin SQL
-- dinámico y con EXECUTE solo para \`service_role\`. Los dos helpers nuevos leen —
-- no escriben— y el techo de privilegios de la migración 109 sigue aplicando.
--
-- Esta migración NO: activa ningún flag, llama a ningún proveedor, mueve un crédito,
-- escribe HubSpot, crea contactos, hace backfill ni inserta una sola fila.
--
-- APPLIED IN PRODUCTION: NO — pendiente de autorización explícita.

-- ── 1. Validador del id de persona Apollo ──────────────────────────
--
-- Espejo EXACTO de \`normalizeApolloPersonId\` (src/server/integrations/apollo-person-id.ts):
-- recorta, rechaza el espacio de ids de otros proveedores (Lusha \`v1.<token>\`) y exige
-- la forma ObjectId de 24 hex. Devuelve el valor RECORTADO conservando mayúsculas,
-- igual que el TypeScript, porque la caché guarda el id tal cual se escribió.
--
-- Existe como función y no inline para que las dos restatements la compartan y para
-- que una suite pueda ejecutarla contra los mismos casos que el validador de TS.

CREATE OR REPLACE FUNCTION public.phone_reveal_normalized_apollo_person_id(
  p_value text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_value IS NULL                        THEN NULL
    WHEN btrim(p_value) = ''                    THEN NULL
    WHEN lower(btrim(p_value)) LIKE 'v1.%'      THEN NULL
    WHEN btrim(p_value) ~ '^[0-9a-fA-F]{24}$'   THEN btrim(p_value)
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) IS
  'AGENT2A-PHONE-REVEAL-4O-E3 — normalizes/validates an Apollo person id (MongoDB ObjectId, 24 hex) exactly like normalizeApolloPersonId in TypeScript: trims, rejects other providers id spaces (Lusha v1.<token>) and returns NULL for anything else. Used by the in-transaction person-level suppression re-check so the SQL and the TypeScript guard resolve the SAME key. Pure, reads nothing, writes nothing.';

REVOKE ALL ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) FROM anon;
REVOKE ALL ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) TO postgres, service_role;

-- ── 2. ¿Hay tombstone POR PERSONA para (apollo, persona, cuenta)? ───
--
-- Espejo EXACTO de \`readPhoneCacheSuppression\` + \`evaluatePhoneCacheSuppressionState\`
-- (phone-cache-store.ts / phone-cache-core.ts): misma tabla, mismas tres columnas de
-- la clave y el mismo criterio — \`suppressed_at\` no nulo ⇒ suprimido. El país NO entra
-- en la clave, igual que en el guard: una supresión bloquea a esa persona en esa cuenta
-- aunque el país del candidato cambie o se desconozca.
--
-- STABLE y no IMMUTABLE porque lee una tabla. Dentro de la transacción de persistencia
-- eso es justo lo que hace falta: la lectura ocurre en el mismo instante lógico que la
-- escritura que autoriza o bloquea.

CREATE OR REPLACE FUNCTION public.phone_reveal_person_suppression_exists(
  p_provider_person_id text,
  p_account_id         uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.phone_reveal_cache c
    WHERE c.provider           = 'apollo'
      AND c.provider_person_id = p_provider_person_id
      AND c.account_id         = p_account_id
      AND c.suppressed_at IS NOT NULL
  );
$fn$;

COMMENT ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) IS
  'AGENT2A-PHONE-REVEAL-4O-E3 — true when a DSAR/suppression tombstone exists in phone_reveal_cache for (apollo, provider_person_id, account_id). Same key and same criterion as the TypeScript guard (readPhoneCacheSuppression + evaluatePhoneCacheSuppressionState); country is deliberately not part of the key. Read-only: it creates no suppression state and it is not a new suppression model — it reads the durable one that already exists. Called from inside the persistence transactions of migrations 110/111 (restated by this migration) so a suppression committed after the pre-call guard cannot be outrun. Service-role only.';

REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) TO postgres, service_role;

-- ── 3. Restatement de la migración 110 ─────────────────────────────
--
-- Cuerpo IDÉNTICO al de la 110 salvo las tres ediciones descritas arriba. Los
-- COMMENT y los GRANT de la 110 siguen vigentes: \`CREATE OR REPLACE\` conserva el
-- comentario y los privilegios de la función cuando la firma no cambia. Se vuelven a
-- declarar igualmente al final, para que el estado final de esta migración sea
-- explícito y no herede nada por omisión.

`;

export const MIGRATION_113_FOOTER = `
-- ── 5. Estado final de privilegios, declarado explícitamente ───────
--
-- \`CREATE OR REPLACE\` conserva los privilegios existentes, así que este bloque no
-- CAMBIA nada hoy: existe para que el estado final quede escrito en la propia
-- migración y no dependa de leer la 110 y la 111 para saber quién puede ejecutar.

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) TO postgres, service_role;
`;

/** Separador entre las dos restatements. */
export const MIGRATION_113_LUSHA_SECTION_HEADER = `
-- ── 4. Restatement de la migración 111 ─────────────────────────────
--
-- Mismas tres ediciones, con una diferencia deliberada: Lusha no entrega ningún id
-- de persona Apollo, así que la clave sale del candidato — que es el MISMO sujeto que
-- la DSAR borró. Un id Lusha nunca puede convertirse en clave: el validador lo rechaza.

`;

/** Deriva el archivo COMPLETO de la migración 113 desde el SQL real de 110 y 111. */
export function buildPhonePersonSuppressionRecheckMigration(
  repoRoot: string,
): string {
  const dir = join(repoRoot, 'supabase/migrations');
  const bodies = FUNCTION_EDITS.map((edit) =>
    transformFunctionBody(
      extractFunctionBody(readFileSync(join(dir, edit.sourceFile), 'utf8'), edit.functionName),
      edit,
    ),
  );
  return (
    MIGRATION_113_HEADER +
    bodies[0] +
    MIGRATION_113_LUSHA_SECTION_HEADER +
    bodies[1] +
    MIGRATION_113_FOOTER
  );
}
