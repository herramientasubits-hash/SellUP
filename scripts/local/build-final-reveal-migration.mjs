// AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT — generador de la migración LOCAL.
//
// POR QUÉ ES UN GENERADOR Y NO UN ARCHIVO ESCRITO A MANO
//
// La migración final vuelve a emitir la función de la 128 ENTERA. Reescribirla a mano significa
// que cualquier divergencia accidental —una cláusula del guard del escalar, un `suppressed_at`,
// un rung del ranking— se convierte en un cambio de comportamiento que nadie pidió y que ninguna
// prueba nombra, porque la prueba compararía la copia consigo misma.
//
// Aquí el cuerpo se DERIVA del de la 128 aplicando exactamente los splices declarados abajo, y la
// suite `post-approval-reveal-stale-producer-final.test.ts` re-deriva lo mismo y compara byte a
// byte. Un splice que nadie declare no puede entrar, y un cambio en la 128 rompe la prueba en vez
// de quedar silenciosamente fuera de la definición viva.
//
// Uso:  node scripts/local/build-final-reveal-migration.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
export const SOURCE_MIGRATION = '128_project_approved_candidate_phones_onto_contact.sql';
export const TARGET_MIGRATION = '131_agent2_post_approval_reveal_stale_producer.sql';

const FN_OPEN = 'AS $function$';
const FN_CLOSE = '$function$;';

/**
 * Los splices, DECLARADOS. `find` tiene que aparecer EXACTAMENTE UNA vez en el cuerpo de la 128:
 * un anclaje ambiguo se rechaza en vez de aplicarse al primero que aparezca.
 */
export const SPLICES = [
  {
    id: 'S1-declare-vars',
    why: 'Dos variables nuevas. `v_hs_decision` arranca en `not_evaluated`, que es la verdad para todo camino que devuelve antes del paso 10.',
    find: '  v_inserted_ids   uuid[]  := ARRAY[]::uuid[];\n',
    replace:
      '  v_inserted_ids   uuid[]  := ARRAY[]::uuid[];\n' +
      '\n' +
      '  -- FINAL CUT — el teléfono SALIENTE (`mobile_phone ?? phone`) que HubSpot conoce, capturado\n' +
      '  -- bajo el lock del contacto y ANTES de que esta transacción escriba una sola columna. Es el\n' +
      '  -- único momento en que ese valor existe: después del paso 10 la fila ya lleva el nuevo.\n' +
      '  v_hs_prev_out    text;\n' +
      '  -- FINAL CUT — veredicto MECÁNICO de la autoridad de CUT-3A/CUT-3C, sin PII. `not_evaluated`\n' +
      '  -- hasta que se consulta: un camino que devolvió antes de proyectar no evaluó nada, y decir\n' +
      "  -- `no_outbound_change` ahí afirmaría una comparación que nadie hizo.\n" +
      "  v_hs_decision    text    := 'not_evaluated';\n",
  },
  {
    id: 'S2-read-mobile-phone',
    why: 'El saliente es `mobile_phone ?? phone`: sin leer `mobile_phone` bajo el lock, un contacto cuyo móvil tapa el escalar se marcaría como cambiado cuando HubSpot recibiría exactamente lo mismo.',
    find: '  SELECT ct.id, ct.account_id, ct.phone, ct.archived_at\n',
    replace: '  SELECT ct.id, ct.account_id, ct.phone, ct.mobile_phone, ct.archived_at\n',
  },
  {
    id: 'S3-capture-previous-outbound',
    why: 'Se captura en cuanto el contacto está validado y ANTES del paso 7, que es el primer paso que escribe. Leerlo después del paso 10 compararía el número nuevo consigo mismo y no marcaría nunca nada.',
    find:
      "  IF v_contact.archived_at IS NOT NULL THEN\n" +
      "    RETURN jsonb_build_object(\n" +
      "      'status', 'contact_not_projectable',\n" +
      "      'detail', 'contact_archived'\n" +
      "    );\n" +
      "  END IF;\n",
    replace:
      "  IF v_contact.archived_at IS NOT NULL THEN\n" +
      "    RETURN jsonb_build_object(\n" +
      "      'status', 'contact_not_projectable',\n" +
      "      'detail', 'contact_archived'\n" +
      "    );\n" +
      "  END IF;\n" +
      "\n" +
      "  -- FINAL CUT — el saliente ANTERIOR, bajo el lock que el paso 5 acaba de tomar y antes de la\n" +
      "  -- primera escritura de esta transacción. Mismo sitio y misma llamada que el paso 5 de la 117\n" +
      "  -- y el paso 1 de la 115 en CUT-3A/CUT-3C: una sola autoridad calcula el saliente, aquí y allí.\n" +
      "  v_hs_prev_out := public.hubspot_outbound_phone(v_contact.phone, v_contact.mobile_phone);\n",
  },
  {
    id: 'S4-mark-stale',
    why: 'La transición ocurre DENTRO de esta transacción, después de la proyección del escalar y antes del sobre. Una segunda escritura desde la aplicación dejaría una ventana con el teléfono guardado y la ficha diciendo `synced`, que es exactamente la mentira que este corte elimina.',
    find:
      '    GET DIAGNOSTICS v_rows = ROW_COUNT;\n' +
      '    v_scalar_synced := v_rows > 0;\n' +
      '  END IF;\n',
    replace:
      '    GET DIAGNOSTICS v_rows = ROW_COUNT;\n' +
      '    v_scalar_synced := v_rows > 0;\n' +
      '  END IF;\n' +
      '\n' +
      '  -- ═══════════════════════════════════════════════════════════════\n' +
      '  -- Step 10b — FINAL CUT: el estado durable de HubSpot, en ESTA transacción.\n' +
      '  -- ═══════════════════════════════════════════════════════════════\n' +
      '  -- Si el paso 10 movió el teléfono SALIENTE de un contacto vinculado cuyo estado durable\n' +
      "  -- decía `synced`, ese estado ya es falso: SellUp tiene un número que HubSpot no ha visto.\n" +
      '  -- La transición se escribe AQUÍ, en la misma transacción que la causó, y un rollback se\n' +
      '  -- lleva el número y el veredicto sobre él juntos.\n' +
      '  --\n' +
      '  -- Se llama SIEMPRE, no sólo cuando el paso 10 escribió. La autoridad compara el saliente de\n' +
      '  -- AHORA con el que se capturó bajo el lock y devuelve `no_outbound_change` sin escribir nada\n' +
      '  -- cuando no se movió — que es el caso normal de una reconciliación repetida y el de un\n' +
      '  -- `mobile_phone` que tapa el escalar. Condicionarla al paso 10 metería aquí una SEGUNDA\n' +
      '  -- respuesta a «¿cambió el saliente?», capaz de contradecir a la primera.\n' +
      '  --\n' +
      "  -- El cuarto argumento es `reveal`, y no es una etiqueta descriptiva: es lo que autoriza al\n" +
      '  -- ejecutor automático de CUT-3C a enviar este pendiente sin que nadie lo pulse. Viaja con el\n' +
      '  -- HECHO, dentro de la transacción que lo produce, porque una autorización que el ejecutor\n' +
      '  -- recibiera como parámetro dependería de que cada camino futuro se acordara de pasarla.\n' +
      '  -- `reveal` estaba declarado en el vocabulario CERRADO de CUT-3C y hasta ahora no lo escribía\n' +
      '  -- ningún llamador; ésta es la sentencia que lo escribe.\n' +
      '  --\n' +
      '  -- CERO red: es un UPDATE de metadata dentro de SQL. Enviar algo a HubSpot sigue siendo una\n' +
      '  -- fase POSTERIOR al COMMIT, en la aplicación, y sigue estando detrás de su propia bandera.\n' +
      '  v_hs_decision := public.mark_contact_hubspot_sync_stale_for_phone(\n' +
      "    p_contact_id, v_hs_prev_out, p_now, 'reveal'\n" +
      '  );\n',
  },
  {
    id: 'S5-envelope',
    why: 'El sobre lleva el veredicto para que la aplicación sepa si ESTA proyección dejó algo pendiente. Es lo único que decide si la fase 2 corre, y así una reconciliación que no movió nada no puede disparar un PATCH.',
    find: "    'scalar_fallback',           v_scalar_fb\n",
    replace:
      "    'scalar_fallback',           v_scalar_fb,\n" +
      '    -- FINAL CUT — veredicto MECÁNICO y sin PII: `marked`, `reason_corrected`,\n' +
      '    -- `source_corrected`, `already_pending`, `not_linked`, `no_durable_state`,\n' +
      '    -- `no_outbound_change`, `not_previously_synced`, `contact_not_found`, `invalid_source`,\n' +
      '    -- `invalid_input` o `not_evaluated`. No dice cuál es el número: dice si HubSpot quedó\n' +
      '    -- reclamando estar al día cuando ya no lo está.\n' +
      "    'hubspot_sync_transition',   v_hs_decision\n",
  },
];

export function functionBodyOf(sql) {
  const open = sql.indexOf(FN_OPEN);
  const close = sql.indexOf(FN_CLOSE, open);
  if (open < 0 || close < 0) throw new Error('no se encontró el cuerpo de la función');
  return sql.slice(open + FN_OPEN.length, close);
}

export function spliceBody(body) {
  let out = body;
  for (const s of SPLICES) {
    const hits = out.split(s.find).length - 1;
    if (hits !== 1) {
      throw new Error(`${s.id}: el anclaje aparece ${hits} veces, se exige exactamente 1`);
    }
    out = out.replace(s.find, s.replace);
  }
  return out;
}

const HEADER = `-- Migración 131: la proyección post-aprobación pasa a PRODUCIR el estado \`stale\` de HubSpot
-- (Agente 2 · AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT)
--
-- ═══════════════════════════════════════════════════════════════════
-- EL DEFECTO, DICHO COMO UN HECHO SOBRE EL ESQUEMA
-- ═══════════════════════════════════════════════════════════════════
--
-- La 128 escribe \`public.contacts.phone\`. No contiene las palabras \`stale\`, \`hubspot_sync\` ni
-- \`stale_source\`: ni una vez. Así que un contacto VINCULADO y \`synced\` al que se le revela un
-- teléfono después de su aprobación acaba con el número guardado aquí, con HubSpot conservando el
-- anterior —o ninguno— y con su propia ficha diciendo que está al día. La ficha no se equivoca por
-- un error de lógica: no hay ninguna sentencia en el esquema que pudiera cambiarla.
--
-- CUT-3A construyó la autoridad de esa transición y CUT-3C le añadió la PROCEDENCIA, con un
-- vocabulario cerrado de cuatro miembros. Uno de ellos, \`reveal\`, quedó declarado y SIN ningún
-- llamador: la propia cabecera de CUT-3C lo dice. Ésta es la sentencia que lo escribe.
--
-- ═══════════════════════════════════════════════════════════════════
-- POR QUÉ DENTRO DE LA MISMA TRANSACCIÓN
-- ═══════════════════════════════════════════════════════════════════
--
-- Una segunda escritura desde la aplicación, después de la RPC, dejaría una ventana en la que el
-- teléfono ya está guardado y el estado durable todavía dice \`synced\`. Esa ventana ES el defecto,
-- sólo más corta. Aquí el UPDATE del escalar y el veredicto sobre él son la misma transacción: un
-- rollback se lleva los dos.
--
-- CERO red. Desde SQL no hay ninguna: no se llama a \`http\`, ni a \`pg_net\`, ni a \`net.\`. Enviar
-- algo a HubSpot sigue siendo una FASE POSTERIOR AL COMMIT, en la aplicación, detrás de la bandera
-- de CUT-3C, y su fallo no puede deshacer nada de lo que esta función escribió.
--
-- ═══════════════════════════════════════════════════════════════════
-- QUÉ RAZÓN PUEDE PRODUCIR ESTA FUNCIÓN, Y POR QUÉ LA OTRA ES IMPOSIBLE
-- ═══════════════════════════════════════════════════════════════════
--
-- El paso 10 escribe \`phone\` bajo DOS guardas simultáneas: el escalar tenía que estar en NULL bajo
-- el lock (\`NULLIF(BTRIM(COALESCE(v_contact.phone,'')),'') IS NULL\`) y el principal electo tiene
-- que ser una fila que ESTA transacción insertó. Y el valor escrito es
-- \`COALESCE(display_phone, normalized_phone)\` de una fila cuya elección exige
-- \`normalized_phone IS NOT NULL\`, así que NO puede ser NULL.
--
-- De ahí que la única transición posible sobre el escalar sea NULL → VALOR:
--
--   * VALOR → VALOR es inalcanzable: la primera guarda lo excluye;
--   * VALOR → NULL es inalcanzable: el valor escrito nunca es NULL, y esta función no contiene
--     ningún \`SET phone = NULL\`;
--   * \`mobile_phone\` NO se toca (4O-E4.1 intacta), así que tampoco puede caer por ese lado.
--
-- Sobre el SALIENTE (\`mobile_phone ?? phone\`) eso deja exactamente dos desenlaces: si el móvil
-- tapaba el escalar el saliente NO cambia y no se marca nada; si no lo tapaba, el saliente pasa de
-- ausente a presente y la razón derivada es \`phone_changed\`.
--
-- ⇒ \`phone_removed\` es INALCANZABLE desde esta función. No se excluye por convenio: la autoridad
--   la derivaría igual si el saliente cayera, y no cae. La suite lo prueba en negativo.
--
-- ═══════════════════════════════════════════════════════════════════
-- ORDEN DE DEPENDENCIA (lo impone el número, no el alfabeto)
-- ═══════════════════════════════════════════════════════════════════
--
--   1. 129_agent2_contact_hubspot_stale_completeness.sql   \`hubspot_outbound_phone\`
--   2. 130_agent2_contact_hubspot_stale_source.sql          la autoridad de CUATRO args
--   3. 131_agent2_post_approval_reveal_stale_producer.sql   ESTE archivo
--
-- 129 < 130 < 131: el orden de aplicación es el NUMÉRICO, el mismo que ya gobierna las 128
-- migraciones anteriores. Antes de la canonicalización lo daba una propiedad accidental del
-- alfabeto (\`contact\` < \`post\` en ASCII); ahora lo da el prefijo, que es una garantía más
-- fuerte. Este archivo llama a la firma de CUATRO argumentos, que la 130 crea y cuya versión de
-- TRES borra: si se aplicara antes, la llamada no resolvería.
--
-- ═══════════════════════════════════════════════════════════════════
-- NUMERADA, Y NO APLICADA EN NINGUNA PARTE
-- ═══════════════════════════════════════════════════════════════════
--
--   APPLIED IN PRODUCTION: NO
--   APPLIED REMOTE:        NO
--   LOCAL ONLY:            YES   (sólo el arnés PostgreSQL local la aplica)
--
-- AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 la canonicalizó junto con la 129, la 130 y la
-- 132, con la disputa de numeración 125/126/127 ya cerrada en \`main\` y el techo desplegable en
-- la 128. Al empezar por \`\\d{3}_\` este archivo entra en la secuencia desplegable y DENTRO de
-- las guardas de techo, que filtran exactamente ese patrón: ya no queda ningún fichero de
-- migración fuera del radar. Numerar NO la aplica — las tres líneas de estado siguen siendo la
-- verdad, y aplicarla en remoto exige autorización explícita de la dueña.
--
-- ═══════════════════════════════════════════════════════════════════
-- IDEMPOTENTE, ADITIVO, REVERSIBLE
-- ═══════════════════════════════════════════════════════════════════
--
-- Un solo \`CREATE OR REPLACE FUNCTION\`. Cero DDL: ninguna tabla, columna, índice, trigger o
-- policy. Deshacerlo es volver a aplicar la 128.
--
-- ⚠️ GENERADO. El cuerpo es el de la 128 con los CINCO splices declarados en
-- \`scripts/local/build-final-reveal-migration.mjs\`, y
-- \`post-approval-reveal-stale-producer-final.test.ts\` los re-deriva y compara byte a byte. No
-- editar a mano: edítese el generador.

`;

export function build() {
  const source = readFileSync(join(ROOT, 'supabase/migrations', SOURCE_MIGRATION), 'utf8');
  const body = spliceBody(functionBodyOf(source));

  const signature = `CREATE OR REPLACE FUNCTION public.project_approved_candidate_phones_onto_contact(
  p_candidate_id    uuid,
  p_contact_id      uuid,
  p_scalar_fallback jsonb,
  p_actor_id        uuid,
  p_now             timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$`;

  // `search_path` NO gana `public`, y es deliberado: la autoridad de CUT-3A/CUT-3C lo lleva en su
  // PROPIA definición, y el `SET` de una función anidada rige mientras ella ejecuta. Añadirlo aquí
  // ampliaría la resolución de nombres de TODO el cuerpo de la 128 —que hoy cualifica cada objeto—
  // por un motivo que no es suyo. Es el mismo reparto que CUT-3C dejó en la 115 y la 117.

  const comment = `COMMENT ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) IS
  'AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT — la 128, re-emitida para que la proyeccion del telefono revelado PRODUZCA ademas el estado durable de HubSpot. Cuerpo de la 128 byte a byte salvo CINCO splices declarados: lee contacts.mobile_phone en el paso 5, captura el SALIENTE anterior (mobile_phone ?? phone) bajo el lock y antes de la primera escritura, llama en un paso 10b a LA autoridad compartida mark_contact_hubspot_sync_stale_for_phone con procedencia reveal, y devuelve su veredicto en el sobre como hubspot_sync_transition. La transicion es ATOMICA con la proyeccion del escalar: misma transaccion, y un rollback se lleva el numero y el veredicto juntos — una segunda escritura desde la aplicacion dejaria una ventana con el telefono guardado y la ficha diciendo synced, que es el defecto que este corte elimina. La autoridad se invoca SIEMPRE y no solo cuando el paso 10 escribio, porque ella misma compara el saliente y devuelve no_outbound_change sin escribir nada: condicionarla seria una SEGUNDA respuesta a la misma pregunta. reveal es el miembro que CUT-3C declaro sin llamador y que autoriza al PATCH automatico a salir; privacy sigue siendo inexportable y esta funcion no puede escribirlo. Solo phone_changed es alcanzable desde aqui: el paso 10 exige escalar NULL bajo el lock y principal recien insertado con normalized_phone NO NULO, asi que VALOR->VALOR y VALOR->NULL son imposibles y phone_removed no puede derivarse. NUNCA toca mobile_phone (4O-E4.1) y NUNCA escribe phone_confidence. NO llama a HubSpot, NO alcanza ninguna red (ni http, ni pg_net, ni net.), NO llama a ningun proveedor, NO reserva ni gasta un credito y NO escribe usage log, reserva ni corrida. Todo lo demas de la 128 se conserva intacto: el lock candidato -> contacto -> telefonos, la revalidacion de approved bajo el lock, el guard IDOR contra matched_contacts_id, la re-comprobacion de supresion POR PERSONA, el rechazo de la forma legacy escalar-con-coleccion-vacia, la eleccion de principal solo cuando el contacto no tenia, y el sobre sin PII.';`;

  const grants = `-- ═══════════════════════════════════════════════════════════════════
-- Privilegios: se RE-EMITEN, no se asumen
-- ═══════════════════════════════════════════════════════════════════
--
-- \`CREATE OR REPLACE\` conserva los privilegios existentes, así que estas cuatro sentencias son
-- redundantes cuando la 128 ya está aplicada. Se re-emiten porque este archivo tiene que ser
-- correcto TAMBIÉN cuando se aplica sobre una base donde la 128 no llegó a aplicarse: en ese caso
-- \`CREATE OR REPLACE\` crea la función desde cero y PostgreSQL le concede EXECUTE a PUBLIC. Una
-- función que ESCRIBE sobre un contacto oficial alcanzable con la clave anon es el defecto, con
-- independencia de que RLS rechazara después cada sentencia. Mismo patrón de cuatro sentencias que
-- 112, 113, 115, 116, 117 y la 128.

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) TO postgres, service_role;
`;

  return `${HEADER}${signature}${body}${FN_CLOSE}\n\n${comment}\n\n${grants}`;
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-final-reveal-migration.mjs');
if (isMain) {
  const out = build();
  const target = join(ROOT, 'supabase/migrations', TARGET_MIGRATION);
  if (process.argv.includes('--check')) {
    const current = readFileSync(target, 'utf8');
    if (current !== out) {
      console.error('DRIFT: la migración en disco no coincide con el generador');
      process.exit(1);
    }
    console.log('OK: byte-exacta');
  } else {
    writeFileSync(target, out);
    console.log(`escrita ${TARGET_MIGRATION} (${out.length} bytes)`);
  }
}
