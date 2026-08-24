/**
 * Tests ESTÁTICOS — SQL, alcance y cableado del check obligatorio
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-E2)
 *
 * Este archivo fija las propiedades que NO fallan al compilar ni al ejecutar el
 * camino feliz:
 *
 *   * la RPC nueva es SECURITY INVOKER, con `search_path` fijado, sin SQL dinámico
 *     y solo ejecutable por service_role/postgres;
 *   * el tombstone borra las cuatro columnas identificadoras Y conserva la
 *     `dedupe_key` (que es el bloqueo de reinserción);
 *   * NO existe un DELETE sobre la colección ni ninguna escritura sobre las
 *     procedencias;
 *   * el candidato se bloquea con FOR UPDATE;
 *   * el ranking del principal es el canónico, escalón por escalón;
 *   * el código TypeScript viejo ya NO vuelve a poner `phone = null` por PostgREST;
 *   * las migraciones 109/110/111 están intactas y no se creó ninguna otra;
 *   * la suite entra en el check obligatorio y no se perdió ningún paso previo.
 *
 * Sin red, sin Supabase, sin proveedores: solo se leen archivos del repositorio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CANDIDATE_PHONE_TYPE_RANKING } from '../phone-collection-core';
import { SUPPRESS_CANDIDATE_PHONE_COLLECTION_FN } from '../candidate-phone-collection-suppression-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

const read = (...segments: string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8');

const MIGRATION_FILE = '112_suppress_candidate_phone_collection.sql';
const WORKFLOW_PATH = ['.github', 'workflows', 'automatic-routing-tests.yml'];

/** Nombre EXACTO del script de la suite E2. Única fuente para los dos lados. */
const E2_TEST_SCRIPT = 'test:agent2a:phone-suppression-propagation';

const SQL = read('supabase', 'migrations', MIGRATION_FILE);

/** SQL sin comentarios: la prosa explica lo que NO se hace y daría falsos positivos. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const CODE = stripSqlComments(SQL);

/** Cuerpo ejecutable de la función (entre el AS $$ y el END $$). */
const FN_BODY = (() => {
  const start = CODE.indexOf('AS $$');
  const end = CODE.lastIndexOf('END $$');
  assert.ok(start !== -1 && end > start, 'no se encontró el cuerpo de la función');
  return CODE.slice(start, end);
})();

/**
 * Cada `RETURN jsonb_build_object(...)` de la función, con sus paréntesis
 * BALANCEADOS. Una expresión regular perezosa no sirve: la función tiene sobres de
 * una línea y sobres multilínea, y el más corto acabaría tragándose el resto del
 * cuerpo (incluido el `jsonb_build_object` de la metadata, que sí lleva 'number').
 */
function returnEnvelopes(): string[] {
  const marker = 'RETURN jsonb_build_object(';
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = FN_BODY.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < FN_BODY.length; i += 1) {
      if (FN_BODY[i] === '(') depth += 1;
      else if (FN_BODY[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(FN_BODY.slice(start + marker.length, i));
    from = i;
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════
// § 1 — numeración y migraciones intactas
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 1 · la migración nueva y solo ella', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  it('la migración 112 existe y sigue siendo la de 4O-E2', () => {
    assert.ok(files.includes(MIGRATION_FILE), 'falta la migración 112');
    assert.equal(
      files.filter((f) => f.startsWith('112')).length,
      1,
      '4O-E2 aporta exactamente una migración',
    );
  });

  it('el techo lo movieron 4O-E3 (113), 4O-H1 (114), 4O-H2 (115), 4O-H3 (116) y 4O-H3-B (117), y nadie más', () => {
    // Esta guarda NO fija el número más alto del directorio para siempre —sube cada
    // vez que un bloque AUTORIZADO añade la suya—, sino que por encima de la 112 solo
    // esté la que el hito siguiente declaró: AGENT2A-PHONE-REVEAL-4O-E3, que vuelve a
    // declarar las funciones 110/111 con la re-comprobación de supresión POR PERSONA
    // dentro de la transacción. Tiene su propia guarda estática, que además comprueba
    // que la 112 no se editó retroactivamente.
    //
    // AGENT2A-PHONE-REVEAL-4O-H1 añadió la 114: el esquema OFICIAL de múltiples teléfonos
    // (`contact_phones` + `contact_phone_sources`), creado INERTE y con su propia guarda
    // estática. No edita la 112 ni ninguna otra de la cadena, que es lo que se vigila.
    //
    // AGENT2A-PHONE-REVEAL-4O-H2 añadió la 115: la PRIVACIDAD de ese esquema oficial —dos
    // contadores en `phone_reveal_suppression_audit` y la función transaccional
    // `suppress_official_contact_phone_sources`—, también con su propia guarda estática.
    // Tampoco edita la 112: la lista sigue siendo EXACTA, no un rango abierto.
    const above = files.filter((f) => Number.parseInt(f.slice(0, 3), 10) > 112);
    assert.deepEqual(above, [
      '113_phone_reveal_person_suppression_recheck.sql',
      '114_official_contact_phones.sql',
      '115_official_contact_phone_privacy.sql',
      // 4O-H3: la aprobación ATÓMICA del candidato sobre el esquema oficial. Sólo una
      // función transaccional; no toca la colección de staging que esta suite protege.
      '116_approve_candidate_with_official_phones.sql',
      // 4O-H3-B: `merge_contact_candidate_into_existing_contact`, aplicada en Producción
      // desde el 2026-08-12 pero reconciliada al repo después de que esta guarda se
      // escribiera (de ahí que faltara aquí). LEE la colección de staging (112) para
      // promoverla hacia el contacto existente, pero no la escribe ni la altera — la 112
      // sigue siendo su única dueña, que es exactamente lo que esta guarda vigila. Es DML
      // sobre `contacts`/`contact_phones`, no crea, altera ni borra ninguna tabla, y no
      // toca `phone_reveal_suppression_audit` — no es dueña de la forma de ninguna tabla
      // de la colección que esta suite protege.
      '117_merge_candidate_into_existing_contact.sql',
      // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1: catálogo de Macro Industrias.
      // Ninguna de las dos toca la colección de staging que esta suite protege.
      '118_macro_industry_catalog_v2_draft.sql',
      '119_publish_macro_industry_catalog_v2_cutover.sql',
      // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) mueve el techo a la 120:
      // `provider_suppressions` + `provider_suppression_audit`, la supresión de teléfono
      // por identidad NATIVA del proveedor y SIN cuenta, más el backfill idempotente de
      // los tombstones legados y el `CREATE OR REPLACE` del helper transaccional
      // `phone_reveal_person_suppression_exists`. Es ADITIVA: no borra columna, no
      // suelta constraint y no reescribe ninguna migración anterior.
      '120_provider_native_phone_suppression.sql',
      // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 mueve el techo a la 121: la liquidación
      // TRUTHFUL del sobrepaso de presupuesto (Agente 1, contabilidad). Reemplaza la
      // constraint de `wizard_budget_reservations` y el cuerpo de
      // `confirm_wizard_credits`; no nombra ninguna tabla de teléfono. No crea, altera ni borra ninguna tabla de la
      // colección de staging que esta suite protege, y la 112 sigue siendo su única dueña.
      '121_wizard_budget_overage_reconciliation.sql',
      // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números»
      // (Agente 2A). Es de teléfono, pero no de este hito: añade la modalidad `search_more`
      // y una función que AÑADE teléfonos al CANDIDATO, y no toca lo que esta guarda vigila.
      '122_phone_reveal_search_more.sql',
      // AGENT1-PROVIDER-SEEN-MEMORY-2 mueve el techo a la 123: la memoria de qué empresa ya
      // nos mostró un proveedor de PAGO (Agente 1, economía de descubrimiento). NO es de
      // teléfono en absoluto: crea `provider_seen_entities`, que sólo guarda identidad de
      // EMPRESA —id nativo del proveedor y dominio normalizado— y no nombra ninguna tabla,
      // columna ni función de teléfono. Se declara NO aplicada en Producción.
      '123_provider_seen_entities.sql',
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: la identidad provider-native
      // (`contact_provider_identities`), el grano de reserva por OPERACIÓN y el claim
      // propio de la búsqueda de identidad. NO toca la colección de staging que esta
      // suite protege ni ninguna de las funciones 110/111/112: crea una tabla nueva,
      // añade columnas a la reserva y a la corrida, y re-declara la función de reserva.
      // Tiene su propia guarda estática y se declara NO aplicada en Producción.
      '124_cross_provider_phone_identity.sql',
      // BR-SOURCE-FUNCTIONAL-CUT-A: la identidad MENSUAL del snapshot de Receita
      // (`source_period` + unicidad period-aware en `source_company_snapshots`, estado de
      // publicación en `source_snapshot_runs`). NO es de teléfono en absoluto: no toca la
      // colección de staging que esta suite protege ni ninguna de las funciones 110/111/112.
      // Tiene su propia guarda estática y está AUTORADA y NO APLICADA.
      '125_br_receita_monthly_snapshot_identity.sql',
      // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY mueve el techo a la 126: el vallado
      // optimista de la admisión por identidad de LOTE (Agente 1). Añade
      // `prospect_batches.identity_epoch` y dos funciones sobre `prospect_batches` y
      // `prospect_candidates`; NO es de teléfono en absoluto y no nombra ninguna tabla,
      // columna ni función de teléfono, que es lo que esta guarda vigila. Trae su propia
      // guarda estática y NO edita ninguna migración anterior. NO aplicada en Producción.
      '126_agent1_batch_identity_atomicity.sql',
    ]);
  });

  it('la 112 declara que YA está aplicada, con la versión remota exacta', () => {
    // Las hermanas 109/110/111 llevan un marcador «NOT APPLIED» que una suite
    // estática fija, porque lo que evita el daño es que el archivo diga en qué
    // estado está. La 112 se aplicó ANTES que su código (migration-first), así
    // que aquí el marcador correcto es el contrario — y esta prueba lo sujeta:
    // sin ella, la cabecera podría volver a decir «NOT APPLIED» y empujar a
    // alguien a aplicarla por segunda vez.
    assert.match(SQL, /APPLIED IN PRODUCTION/);
    assert.match(SQL, /20260810163800/, 'debe constar la versión remota exacta');
    assert.equal(
      /NOT APPLIED/.test(SQL),
      false,
      'la 112 sí está aplicada: el marcador de las hermanas no aplicadas sería falso',
    );
  });

  it('las migraciones 109/110/111 NO fueron modificadas por este hito', () => {
    // Marcadores de identidad de cada una. Si el hito las hubiera editado, el
    // marcador o el bloque que lo rodea habría cambiado.
    const m109 = read('supabase', 'migrations', '109_contact_enrichment_candidate_phones.sql');
    assert.match(m109, /AGENT2A-PHONE-REVEAL-4O-B/);
    assert.equal(/4O-E2/.test(m109), false, 'la 109 no debe mencionar 4O-E2');

    const m110 = read('supabase', 'migrations', '110_persist_candidate_apollo_phone_reveal_result.sql');
    assert.match(m110, /AGENT2A-PHONE-REVEAL-4O-C-R1/);
    assert.equal(/4O-E2/.test(m110), false, 'la 110 no debe mencionar 4O-E2');

    const m111 = read('supabase', 'migrations', '111_persist_candidate_lusha_phone_reveal_result.sql');
    assert.match(m111, /4O-D/);
    assert.equal(/4O-E2/.test(m111), false, 'la 111 no debe mencionar 4O-E2');
  });

  it('la 112 no crea, altera ni borra ninguna TABLA de la colección', () => {
    assert.equal(/CREATE TABLE/i.test(CODE), false);
    assert.equal(/DROP TABLE/i.test(CODE), false);
    assert.equal(
      /ALTER TABLE public\.contact_enrichment_candidate_phone/i.test(CODE),
      false,
      'las tablas de la 109 no se alteran',
    );
  });

  it('la 112 no añade ningún trigger y no hace backfill', () => {
    assert.equal(/CREATE TRIGGER/i.test(CODE), false);
    assert.equal(/INSERT INTO/i.test(CODE), false, 'no se inserta ninguna fila');
  });

  it('el ÚNICO ALTER TABLE es el contador de la auditoría', () => {
    const alters = [...CODE.matchAll(/ALTER TABLE\s+(\S+)/gi)].map((m) => m[1]);
    assert.deepEqual([...new Set(alters)], ['public.phone_reveal_suppression_audit']);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 6 / § 5 — forma de la función
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 6 · seguridad de la RPC', () => {
  it('el nombre del SQL y el del TypeScript coinciden', () => {
    assert.ok(
      CODE.includes(`public.${SUPPRESS_CANDIDATE_PHONE_COLLECTION_FN}(`),
      'la constante de TypeScript no nombra la función del SQL',
    );
  });

  it('es SECURITY INVOKER, no DEFINER', () => {
    assert.match(CODE, /SECURITY INVOKER/);
    assert.equal(/SECURITY DEFINER/i.test(CODE), false);
  });

  it('fija `search_path`', () => {
    assert.match(CODE, /SET search_path = pg_catalog, pg_temp/);
  });

  it('no usa SQL dinámico', () => {
    assert.equal(/\bEXECUTE\b/i.test(FN_BODY), false, 'sin EXECUTE de cadenas');
    assert.equal(/format\(/i.test(FN_BODY), false);
    assert.equal(/quote_ident/i.test(FN_BODY), false);
  });

  it('revoca EXECUTE de PUBLIC, anon y authenticated', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      assert.ok(
        new RegExp(`REVOKE ALL ON FUNCTION[\\s\\S]*?FROM ${role}`).test(CODE),
        `falta el REVOKE para ${role}`,
      );
    }
  });

  it('solo concede EXECUTE a postgres y service_role', () => {
    const grants = [...CODE.matchAll(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO ([^;]+);/g)].map(
      (m) => m[1].trim(),
    );
    assert.deepEqual(grants, ['postgres, service_role']);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 3 / § 4 — tombstone y procedencias
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 3 · tombstone, nunca DELETE', () => {
  it('NO hay ningún DELETE en la función', () => {
    assert.equal(/\bDELETE\b/i.test(FN_BODY), false);
  });

  it('el tombstone borra las cuatro columnas identificadoras en UN statement', () => {
    const update = FN_BODY.match(
      /UPDATE public\.contact_enrichment_candidate_phones\s+SET([\s\S]*?);/,
    );
    assert.ok(update, 'no se encontró el UPDATE del tombstone');
    const body = update[1];
    assert.match(body, /normalized_phone\s*=\s*NULL/);
    assert.match(body, /display_phone\s*=\s*NULL/);
    assert.match(body, /phone_type\s*=\s*NULL/);
    assert.match(body, /is_primary\s*=\s*false/);
    assert.match(body, /suppressed_at\s*=\s*p_suppressed_at/);
    assert.match(body, /suppression_reason\s*=\s*p_suppression_reason/);
    assert.match(body, /suppressed_by\s*=\s*p_suppressed_by/);
  });

  it('la `dedupe_key` NUNCA se modifica: es el bloqueo de reinserción', () => {
    assert.equal(
      /dedupe_key\s*=\s*(NULL|'')/i.test(FN_BODY),
      false,
      'borrar la clave desbloquearía el número',
    );
  });

  it('el tombstone solo casa filas VIVAS (idempotencia)', () => {
    const update = FN_BODY.match(
      /UPDATE public\.contact_enrichment_candidate_phones\s+SET[\s\S]*?WHERE([\s\S]*?);/,
    );
    assert.ok(update);
    assert.match(update[1], /suppressed_at IS NULL/);
    assert.match(update[1], /candidate_id = p_candidate_id/);
  });

  it('la tabla de PROCEDENCIAS solo se LEE: ni UPDATE ni DELETE ni INSERT', () => {
    const sourcesTable = 'contact_enrichment_candidate_phone_sources';
    // Solo debe aparecer dentro de SELECT/FROM.
    for (const mutation of [
      `UPDATE public.${sourcesTable}`,
      `DELETE FROM public.${sourcesTable}`,
      `INSERT INTO public.${sourcesTable}`,
    ]) {
      assert.equal(
        FN_BODY.includes(mutation),
        false,
        `la función no debe ejecutar: ${mutation}`,
      );
    }
    assert.ok(
      FN_BODY.includes(`FROM public.${sourcesTable}`),
      'la procedencia sí se lee (para el ranking y la metadata)',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § 7 — lock y alcance atómico
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 7 · lock del candidato', () => {
  it('bloquea el candidato con SELECT ... FOR UPDATE', () => {
    assert.match(
      FN_BODY,
      /FROM public\.contact_enrichment_candidates c\s+WHERE c\.id = p_candidate_id\s+FOR UPDATE/,
    );
  });

  it('el lock precede a TODA escritura', () => {
    const lockAt = FN_BODY.indexOf('FOR UPDATE');
    const firstWriteAt = FN_BODY.search(/UPDATE public\./);
    assert.notEqual(lockAt, -1);
    assert.notEqual(firstWriteAt, -1);
    assert.ok(lockAt < firstWriteAt, 'ninguna escritura puede decidirse sin el lock');
  });

  it('reafirma el run dentro del lock (FIX M2/M3 conservado)', () => {
    assert.match(FN_BODY, /p_expected_enrichment_run_id IS NOT NULL/);
    assert.match(FN_BODY, /enrichment_run_mismatch/);
  });

  it('el escalar y la metadata del candidato se escriben en la MISMA función', () => {
    assert.match(FN_BODY, /UPDATE public\.contact_enrichment_candidates/);
    assert.match(FN_BODY, /phone\s*=\s*v_scalar/);
    assert.match(FN_BODY, /enrichment_metadata\s*=\s*v_next_metadata/);
  });

  it('la función no escribe caché, contactos, auditoría, usage-log ni reservas', () => {
    for (const table of [
      'phone_reveal_cache',
      'contacts',
      'phone_reveal_suppression_audit',
      'provider_usage_logs',
      'phone_reveal_credit_reservations',
      'phone_reveal_waterfall_runs',
    ]) {
      assert.equal(
        new RegExp(`(UPDATE|INSERT INTO|DELETE FROM) public\\.${table}\\b`).test(FN_BODY),
        false,
        `la función no debe escribir en ${table}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 8 — ranking canónico del principal
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 8 · reelección del principal', () => {
  it('el ranking de tipos del SQL es EXACTAMENTE el de phone-collection-core', () => {
    const array = FN_BODY.match(/c_type_ranking\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
    assert.ok(array, 'no se encontró c_type_ranking');
    const values = [...array[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(values, [...CANDIDATE_PHONE_TYPE_RANKING]);
  });

  it('el ranking de procedencia del SQL espeja SOURCE_SPECIFICITY_RANKING', () => {
    const array = FN_BODY.match(/c_source_ranking\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
    assert.ok(array, 'no se encontró c_source_ranking');
    const values = [...array[1].matchAll(/'([a-z_:]+)'/g)].map((m) => m[1]);
    // La lista viva en TypeScript no se exporta; se compara contra su fuente.
    const core = read('src', 'modules', 'contact-enrichment', 'phone-collection-core.ts');
    const tsArray = core.match(
      /SOURCE_SPECIFICITY_RANKING: readonly string\[\] = \[([\s\S]*?)\]/,
    );
    assert.ok(tsArray, 'no se encontró SOURCE_SPECIFICITY_RANKING');
    const tsValues = [...tsArray[1].matchAll(/'([a-z_:]+)'/g)].map((m) => m[1]);
    assert.deepEqual(values, tsValues);
  });

  it('la elegibilidad es la CHECK de la 109, las tres condiciones', () => {
    const select = FN_BODY.match(
      /SELECT p\.id, p\.dedupe_key[\s\S]*?ORDER BY([\s\S]*?)LIMIT 1;/,
    );
    assert.ok(select, 'no se encontró la elección del principal');
    const whole = FN_BODY.match(
      /SELECT p\.id, p\.dedupe_key[\s\S]*?LIMIT 1;/,
    );
    assert.ok(whole);
    assert.match(whole[0], /p\.suppressed_at IS NULL/);
    assert.match(whole[0], /p\.normalized_phone IS NOT NULL/);
    assert.match(whole[0], /p\.phone_status <> 'invalid'/);
  });

  it('el ORDER BY tiene los cinco escalones de compareCandidatePhones', () => {
    const order = FN_BODY.match(
      /SELECT p\.id, p\.dedupe_key[\s\S]*?ORDER BY([\s\S]*?)LIMIT 1;/,
    );
    assert.ok(order);
    const clause = order[1];
    assert.match(clause, /array_position\(c_type_ranking, p\.phone_type\)/);
    assert.match(clause, /CASE p\.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1/);
    assert.match(clause, /array_position\(c_source_ranking/);
    assert.match(clause, /p\.last_seen_at DESC/);
    assert.match(clause, /p\.dedupe_key ASC/);
  });

  it('el orden de llegada del proveedor NO participa en ningún escalón', () => {
    const order = FN_BODY.match(
      /SELECT p\.id, p\.dedupe_key[\s\S]*?ORDER BY([\s\S]*?)LIMIT 1;/,
    );
    assert.ok(order);
    // `created_at` (el momento en que la fila entró) no decide nada: si lo hiciera,
    // el orden del array del proveedor acabaría eligiendo el principal por la
    // puerta de atrás. `p.id` sí aparece, pero SOLO dentro de la subconsulta que
    // resuelve la procedencia (`s.candidate_phone_id = p.id`), nunca como criterio.
    assert.equal(/p\.created_at/.test(order[1]), false);
    const sortKeys = order[1]
      // La subconsulta correlacionada se elimina antes de mirar los criterios.
      .replace(/COALESCE\(\(\s*SELECT[\s\S]*?\), array_length\(c_source_ranking, 1\) \+ 1\)/, 'SOURCE_RANK')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    assert.equal(
      sortKeys.some((key) => /^p\.id\b/.test(key)),
      false,
      '`p.id` no puede ser un criterio de orden',
    );
    // El último escalón es la clave, siempre presente y única.
    assert.match(sortKeys[sortKeys.length - 1], /^p\.dedupe_key ASC$/);
  });

  it('degrada antes de promover (el índice parcial no admite dos principales)', () => {
    const demoteAt = FN_BODY.search(/SET is_primary = false\s+WHERE candidate_id = p_candidate_id\s+AND is_primary\s+AND id <> v_primary_id/);
    const promoteAt = FN_BODY.search(/SET is_primary = true/);
    assert.notEqual(demoteAt, -1, 'falta la degradación del principal anterior');
    assert.notEqual(promoteAt, -1, 'falta la promoción del superviviente');
    assert.ok(demoteAt < promoteAt, 'degradar debe preceder a promover');
  });

  it('el escalar sale del principal elegido, no de un parámetro del llamador', () => {
    assert.match(
      FN_BODY,
      /v_scalar\s*:=\s*COALESCE\(v_primary\.display_phone, v_primary\.normalized_phone\)/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § 10 — metadata: espejo de stripPhoneFromEnrichmentMetadata
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 10 · metadata del candidato', () => {
  it('sin superviviente elimina SOLO el bloque `phone`', () => {
    assert.match(
      FN_BODY,
      /v_next_metadata\s*:=\s*COALESCE\(v_candidate\.enrichment_metadata, '\{\}'::jsonb\) - 'phone'/,
    );
    // Nunca se reemplaza la metadata entera por un objeto vacío: eso borraría
    // relevancia, completion y trazas de proveedor.
    assert.equal(
      /enrichment_metadata\s*=\s*'\{\}'::jsonb/.test(FN_BODY),
      false,
      'la metadata no se puede vaciar',
    );
  });

  it('el borrado del bloque espeja `delete next.phone` del core puro', () => {
    const core = read(
      'src',
      'modules',
      'contact-enrichment',
      'phone-cache-suppression-core.ts',
    );
    assert.match(core, /delete next\.phone/);
    // Un solo bloque lógico: `phone`, en los dos lados.
    assert.ok(FN_BODY.includes("- 'phone'"));
  });

  it('con superviviente la metadata describe el MISMO número que el escalar', () => {
    const build = FN_BODY.match(/jsonb_build_object\(\s*'number',\s*v_scalar([\s\S]*?)\)/);
    assert.ok(build, 'no se encontró el bloque de metadata del superviviente');
    assert.match(build[1], /'type',\s*v_meta_type/);
    assert.match(build[1], /'source',\s*v_meta_source/);
    assert.match(build[1], /'raw_type',\s*v_meta_raw_type/);
  });

  it('la procedencia se DERIVA, no se inventa: sin mapeo el source es `unknown`', () => {
    assert.match(FN_BODY, /ELSE 'unknown'/);
    // Los valores derivados pertenecen al vocabulario de phone_source ya existente.
    for (const value of ['apollo_reveal', 'apollo_cache', 'lusha_reveal', 'apollo_search', 'manual']) {
      assert.ok(FN_BODY.includes(`'${value}'`), `falta el mapeo a ${value}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 12 — el escritor viejo del candidato ya no existe
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 12 · la RPC es la AUTORIDAD sobre el escalar', () => {
  const actions = read(
    'src',
    'modules',
    'contact-enrichment',
    'phone-cache-suppression-actions.ts',
  );

  it('la acción ya NO actualiza `contact_enrichment_candidates` por PostgREST', () => {
    // Este es el defecto en espejo: un segundo escritor pondría `phone = null`
    // encima de un superviviente legítimamente reelegido.
    assert.equal(
      /\.from\('contact_enrichment_candidates'\)\s*\n?\s*\.update\(/.test(actions),
      false,
      'no puede quedar un UPDATE del candidato fuera de la transacción',
    );
  });

  it('la acción sigue LEYENDO los candidatos por su apollo_person_id', () => {
    assert.match(actions, /\.from\('contact_enrichment_candidates'\)/);
    assert.match(actions, /\.eq\('apollo_person_id',\s*tombstone\.providerPersonId\)/);
  });

  it('la acción llama a la propagación transaccional una vez por candidato', () => {
    assert.match(actions, /suppressCandidatePhoneCollection\(\{/);
    assert.match(actions, /scope:\s*DSAR_CANDIDATE_PHONE_SUPPRESSION_SCOPE/);
    assert.match(actions, /dedupeKey:\s*null/);
  });

  it('el motivo se TRADUCE antes de llegar a la colección', () => {
    assert.match(
      actions,
      /mapSuppressionReasonToCandidatePhoneReason\(\s*plan\.reasonCode,?\s*\)/,
    );
    // Nunca se pasa el motivo de la caché tal cual.
    assert.equal(
      /reason:\s*plan\.reasonCode/.test(actions),
      false,
      'un pass-through fallaría la CHECK de la 109 en el 100% de las filas',
    );
  });

  it('un fallo de la propagación NO se reporta como éxito', () => {
    assert.match(actions, /'candidate_phone_collection_failed'/);
    // `ok` se deriva de `failureCode === null`, así que un fallo lo apaga.
    assert.match(actions, /ok:\s*failureCode === null/);
  });

  it('el tombstone de la CACHÉ sigue escribiéndose antes de la propagación', () => {
    const cacheAt = actions.search(/\.update\(tombstone\.cacheEntryPatch\)/);
    const propagationAt = actions.search(/suppressCandidatePhoneCollection\(\{/);
    assert.notEqual(cacheAt, -1);
    assert.notEqual(propagationAt, -1);
    assert.ok(cacheAt < propagationAt);
  });

  it('la propagación va antes del borrado de contactos y de la auditoría', () => {
    const propagationAt = actions.search(/suppressCandidatePhoneCollection\(\{/);
    const contactsAt = actions.search(/\.from\('contacts'\)\s*\n?\s*\.update\(patch\)/);
    const auditAt = actions.search(/buildPhoneCacheSuppressionAuditRow\(\{/);
    assert.ok(propagationAt < contactsAt);
    assert.ok(propagationAt < auditAt);
  });

  it('el error de la propagación no imprime el mensaje del driver', () => {
    // PostgreSQL cita valores de la query en sus errores, y uno de ellos es un
    // teléfono. El `catch` no captura la excepción a propósito: sin binding no hay
    // nada que se pueda imprimir por descuido.
    assert.match(
      actions,
      /\} catch \{\s*\n[\s\S]{0,400}?suppression candidate collection propagation failed/,
      'el catch de la propagación debe ser sin binding y con un mensaje mecánico',
    );
    const block = actions.slice(
      actions.indexOf('} catch {'),
      actions.indexOf("'candidate_phone_collection_failed';", actions.indexOf('} catch {')),
    );
    assert.equal(/\.message/.test(block), false, 'no se imprime el mensaje del driver');
    assert.equal(
      /catch \((\w+)\)/.test(block),
      false,
      'el catch no debe capturar la excepción en una variable',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15 / § 16 — contador de auditoría, tipado y sin PII
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 15 · contador de la auditoría', () => {
  it('la columna es NOT NULL, DEFAULT 0 y con CHECK >= 0', () => {
    assert.match(
      CODE,
      /ADD COLUMN IF NOT EXISTS candidate_phone_rows_suppressed integer NOT NULL DEFAULT 0/,
    );
    assert.match(CODE, /CHECK \(candidate_phone_rows_suppressed >= 0\)/);
  });

  it('es una COLUMNA tipada y no una clave escondida en `metadata`', () => {
    const core = read(
      'src',
      'modules',
      'contact-enrichment',
      'phone-cache-suppression-core.ts',
    );
    const row = core.match(
      /export interface PhoneCacheSuppressionAuditRow \{([\s\S]*?)\n\}/,
    );
    assert.ok(row);
    assert.match(row[1], /candidate_phone_rows_suppressed: number;/);
    // La clave no puede vivir DENTRO del bloque metadata.
    const metaBlock = row[1].match(/metadata: \{([\s\S]*?)\};/);
    assert.ok(metaBlock);
    assert.equal(/candidate_phone_rows_suppressed/.test(metaBlock[1]), false);
  });

  it('la auditoría no registra ninguna dedupe_key, teléfono ni identidad', () => {
    const core = read(
      'src',
      'modules',
      'contact-enrichment',
      'phone-cache-suppression-core.ts',
    );
    const builder = core.match(
      /export function buildPhoneCacheSuppressionAuditRow\(args: \{[\s\S]*?\n\}\n/,
    );
    assert.ok(builder);
    for (const banned of [
      'dedupeKey',
      'dedupe_key',
      'primaryDedupeKey',
      'normalizedPhone',
      'displayPhone',
      'email',
      'linkedin',
      'full_name',
    ]) {
      assert.equal(
        builder[0].includes(banned),
        false,
        `la auditoría no debe llevar ${banned}`,
      );
    }
  });

  it('los agregados de la reelección son un conteo y una bandera, nada más', () => {
    const core = read(
      'src',
      'modules',
      'contact-enrichment',
      'phone-cache-suppression-core.ts',
    );
    assert.match(core, /candidate_phone_survivor_count: number;/);
    assert.match(core, /candidate_phone_primary_changed: boolean;/);
  });
});

describe('4O-E2 § 16 · la RPC no devuelve PII', () => {
  it('el sobre solo lleva conteos, banderas, un status y una dedupe_key', () => {
    const returns = returnEnvelopes();
    assert.ok(returns.length > 0, 'no se encontró ningún sobre de retorno');

    /** Claves de primer nivel del sobre: los literales en posición impar. */
    const ALLOWED_KEYS = new Set([
      'status',
      'detail',
      'suppressed_count',
      'already_suppressed_count',
      'survivor_count',
      'primary_dedupe_key',
      'primary_changed',
      'candidate_phone_cleared',
      'candidate_updated',
      'candidate_settled',
    ]);

    for (const body of returns) {
      // Ninguna clave fuera del contrato: una clave nueva es la única forma de que
      // un valor nuevo salga de la función.
      for (const match of body.matchAll(/^\s*'([a-z_]+)',/gm)) {
        assert.ok(
          ALLOWED_KEYS.has(match[1]),
          `clave no contemplada en el sobre: ${match[1]}`,
        );
      }
      // Y ningún VALOR devuelto es un número ni se deriva de uno. `v_scalar`
      // aparece solo dentro de `v_scalar IS NULL`, que es una bandera.
      for (const banned of ['v_meta_raw_type', 'v_meta_source', 'p_dedupe_key']) {
        assert.equal(
          body.includes(banned),
          false,
          `el sobre no debe devolver ${banned}`,
        );
      }
      const scalarUses = [...body.matchAll(/v_scalar\b(\s*IS NULL)?/g)];
      for (const use of scalarUses) {
        assert.ok(
          use[1],
          'v_scalar solo puede aparecer como `v_scalar IS NULL`, nunca como valor',
        );
      }
      // Las columnas de teléfono solo pueden aparecer dentro de un COUNT.
      for (const column of ['normalized_phone', 'display_phone']) {
        for (const use of body.matchAll(new RegExp(`p\\.${column}`, 'g'))) {
          const context = body.slice(Math.max(0, use.index - 220), use.index);
          assert.match(
            context,
            /SELECT COUNT\(\*\)/,
            `p.${column} solo puede usarse dentro de un COUNT, nunca devolverse`,
          );
        }
      }
    }
  });

  it('la función no lanza NINGUNA excepción propia: reporta mecánicamente', () => {
    // No hay ni un RAISE. Es deliberado y comprobable: el mensaje de una excepción
    // de PL/pgSQL viaja al log del servidor y de ahí al de la aplicación, y en una
    // función que manipula teléfonos cualquier interpolación acabaría publicando
    // uno. Todo se resuelve devolviendo un `status` cerrado.
    assert.equal(/\bRAISE\b/i.test(FN_BODY), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 17 / § 18 / § 19 / § 20 — lo que NO se toca
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 · deuda declarada y alcance no tocado', () => {
  it('la política terminal de E1 sigue intacta', () => {
    const e1 = read(
      'src',
      'modules',
      'contact-enrichment',
      'candidate-phone-suppression-persistence.ts',
    );
    assert.match(e1, /blocked_suppressed|expectedStatuses/);
    assert.match(e1, /\.in\('phone_reveal_status'/);
    assert.match(e1, /\.is\('phone', null\)/);
    // E2 no escribe tombstones desde ese archivo ni cambia su contrato.
    assert.equal(/suppress_candidate_phone_collection/.test(e1), false);
  });

  // Este test nació como guarda de alcance de E2: «E2 no amplió la allowlist a
  // Lusha». La ampliación llegó en 4O-E4, con la cadena de procedencia demostrada de
  // punta a punta, así que la guarda pasa a fijar el conjunto EXACTO resultante. Lo
  // que sigue siendo la propiedad de fondo —y lo que el assert protege— es que la
  // lista no admita nada sin procedencia: `manual`, `unknown`, `apollo_search`,
  // `provider_payload` y `NULL` quedan fuera.
  it('la allowlist de procedencias borrables en contacts es exactamente Apollo + Lusha', () => {
    const core = read(
      'src',
      'modules',
      'contact-enrichment',
      'phone-cache-suppression-core.ts',
    );
    const list = core.match(
      /SUPPRESSIBLE_CONTACT_PHONE_SOURCES: readonly string\[\] = \[([\s\S]*?)\]/,
    );
    assert.ok(list);
    const values = [...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(values, ['apollo_cache', 'apollo_reveal', 'lusha_reveal']);
  });

  it('la pata manual de Lusha no fue modificada por este hito', () => {
    const manual = read(
      'src',
      'modules',
      'contact-enrichment',
      'lusha-phone-fallback-actions.ts',
    );
    assert.equal(/4O-E2/.test(manual), false);
    assert.equal(/suppress_candidate_phone_collection/.test(manual), false);
  });

  it('sólo la 114 (4O-H1) crea la tabla `contact_phones`', () => {
    // Invertido por 4O-H1, que es quien la crea. Lo que se sigue protegiendo es que tenga
    // una única dueña: la forma del esquema oficial no puede repartirse entre migraciones.
    const creators: string[] = [];
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      if (
        /CREATE TABLE[^;]*\bpublic\.contact_phones\b/i.test(
          readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        )
      ) {
        creators.push(file);
      }
    }
    assert.deepEqual(creators, ['114_official_contact_phones.sql']);
  });

  it('el hito no activa ni menciona como activable el flag del waterfall', () => {
    for (const rel of [
      ['supabase', 'migrations', MIGRATION_FILE],
      ['src', 'modules', 'contact-enrichment', 'candidate-phone-collection-suppression-core.ts'],
      ['src', 'modules', 'contact-enrichment', 'candidate-phone-collection-suppression-persistence.ts'],
      ['src', 'modules', 'contact-enrichment', 'candidate-phone-suppression-reason-mapping.ts'],
    ]) {
      const src = read(...rel);
      assert.equal(
        /ENABLE_PHONE_REVEAL_WATERFALL\s*=/.test(src),
        false,
        `${rel.join('/')} no debe tocar el flag`,
      );
    }
  });

  it('ningún módulo nuevo llama a un proveedor ni mueve un crédito', () => {
    for (const rel of [
      'candidate-phone-collection-suppression-core.ts',
      'candidate-phone-collection-suppression-persistence.ts',
      'candidate-phone-suppression-reason-mapping.ts',
    ]) {
      const src = read('src', 'modules', 'contact-enrichment', rel);
      for (const banned of ['apollo.io', 'lusha.com', 'fetch(', 'hubspot', 'reserveCredits']) {
        assert.equal(
          src.toLowerCase().includes(banned.toLowerCase()),
          false,
          `${rel} no debe usar ${banned}`,
        );
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 24 — el check obligatorio ejecuta la suite
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 24 · required check', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('package.json declara el script de la suite E2', () => {
    const script = pkg.scripts[E2_TEST_SCRIPT];
    assert.ok(script, `falta el script ${E2_TEST_SCRIPT} en package.json`);
    for (const suite of [
      'candidate-phone-suppression-reason-mapping-4o-e2.test.ts',
      'candidate-phone-collection-suppression-core-4o-e2.test.ts',
      'candidate-phone-collection-suppression-static-4o-e2.test.ts',
    ]) {
      assert.ok(script.includes(suite), `el script no ejecuta ${suite}`);
    }
  });

  it('la suite de PostgreSQL real tiene su propio script (arnés opcional)', () => {
    const script = pkg.scripts['test:agent2a:phone-suppression-propagation-postgres'];
    assert.ok(script, 'falta el script de la suite de PostgreSQL real');
    assert.ok(
      script.includes('candidate-phone-collection-suppression-postgres-4o-e2.test.ts'),
    );
  });

  it('el workflow obligatorio ejecuta el script de la suite E2', () => {
    const workflow = read(...WORKFLOW_PATH);
    assert.ok(
      workflow.includes(`npm run ${E2_TEST_SCRIPT}`),
      `el workflow obligatorio no ejecuta ${E2_TEST_SCRIPT}`,
    );
  });

  it('no se eliminó ningún paso previo del workflow', () => {
    const workflow = read(...WORKFLOW_PATH);
    for (const step of [
      'npm run typecheck',
      'npm run test:agent2a:automatic-routing',
      'npm run test:agent2a:phone-waterfall',
      'npm run test:agent2a:phone-credit-reservation',
      'npm run test:agent2a:phone-budget-accounting',
      'npm run test:agent2a:candidate-phone-collection',
      'npm run test:agent2a:apollo-phone-collection-capture',
      'npm run test:agent2a:phone-suppression-terminal',
    ]) {
      assert.ok(workflow.includes(step), `el workflow perdió el paso: ${step}`);
    }
  });
});
