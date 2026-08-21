/**
 * Agente 2A — el CONTRATO de la migración 117 y del cableado del merge humano
 * (AGENT2A-PHONE-REVEAL-4O-H3-B).
 *
 * Esta suite fija lo que el SQL DICE. La hermana `…-postgres-4o-h3b` demuestra lo que GARANTIZA.
 * Las dos hacen falta: un `ON CONFLICT DO NOTHING` presente no prueba que no se resucite un
 * tombstone (eso lo prueba PostgreSQL), pero su AUSENCIA sí probaría que se puede — y esa es una
 * regresión que se introduce editando una línea, no rediseñando nada.
 *
 * Varias afirmaciones son deliberadamente NEGATIVAS (no crea contactos, no hay DELETE, no hay un
 * `suppressed_at = NULL`, no hay una desactivación masiva de `is_primary`, no se toca
 * `mobile_phone`). Su valor entero está en lo que IMPIDEN.
 *
 * Y una es de NO-DIVERGENCIA: los dos rankings de la 117 deben ser byte-idénticos a los de la
 * 116. Dos rankings sobre el mismo vocabulario es cómo la misma persona acaba con principales
 * distintos según qué transacción la tocó por última vez.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const migration = read('supabase/migrations/117_merge_candidate_into_existing_contact.sql');
const migration116 = read('supabase/migrations/116_approve_candidate_with_official_phones.sql');
const reviewCore = read('src/modules/contact-enrichment/candidate-review-core.ts');
const mergeCore = read('src/modules/contact-enrichment/existing-contact-merge-core.ts');
const persistence = read('src/modules/contact-enrichment/existing-contact-merge-persistence.ts');
const actions = read('src/modules/contact-enrichment/actions.ts');
const suppressionCore = read('src/modules/contact-enrichment/phone-cache-suppression-core.ts');

/**
 * SÓLO el cuerpo ejecutable de la función, sin comentarios.
 *
 * Recortar aquí es load-bearing: la cabecera y el `COMMENT ON FUNCTION` describen EN PROSA justo
 * lo que estas pruebas afirman que no ocurre («nunca toca mobile_phone», «no crea contactos»),
 * así que medir sobre el archivo entero mediría la documentación en vez del código — y una
 * afirmación negativa que casa con su propia explicación no afirma nada.
 */
function executableBody(sql: string): string {
  const start = sql.indexOf('AS $function$');
  const end = sql.indexOf('$function$;');
  assert.ok(start > 0 && end > start, 'no se pudo aislar el cuerpo de la función');
  return sql
    .slice(start, end)
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

const body = executableBody(migration);
const body116 = executableBody(migration116);

/** Quita comentarios de línea y de bloque de una fuente TypeScript. */
const stripTs = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

const count = (haystack: string, needle: RegExp) => haystack.match(needle)?.length ?? 0;

// ═══════════════════════════════════════════════════════════════
// 1. Lo que la función NO hace
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — la 117 no crea, no borra y no resucita', () => {
  it('NO inserta en `contacts`: un merge no crea a nadie', () => {
    assert.equal(
      /INSERT\s+INTO\s+public\.contacts\b/i.test(body),
      false,
      'la 117 no puede crear contactos — eso es la 116, y por eso son dos funciones',
    );
  });

  it('NO contiene un solo DELETE', () => {
    assert.equal(/\bDELETE\s+FROM\b/i.test(body), false);
  });

  it('NO contiene ningún `suppressed_at = NULL`: un tombstone no se levanta', () => {
    assert.equal(/suppressed_at\s*=\s*NULL/i.test(body), false);
  });

  it('NO toca `mobile_phone` (4O-E4.1) ni `phone_confidence` (columna muerta)', () => {
    assert.equal(/mobile_phone/i.test(body), false);
    assert.equal(/phone_confidence/i.test(body), false);
  });

  it('NO nombra a ningún proveedor externo, tabla de créditos, reserva ni usage log', () => {
    for (const forbidden of [
      /provider_usage_logs\s*\(/i,
      /wizard_monthly_budget_periods/i,
      /wizard_budget_reservations/i,
      /INSERT\s+INTO\s+public\.phone_reveal_credit_reservations/i,
      /INSERT\s+INTO\s+public\.phone_reveal_waterfall_runs/i,
      /hubspot/i,
    ]) {
      assert.equal(forbidden.test(body), false, `la 117 no puede tocar ${forbidden}`);
    }
  });

  it('NO compara emails, nombres ni números: la identidad no se resuelve en SQL', () => {
    // El destino llega decidido y CONFIRMADO. Una comparación aquí sería una segunda
    // resolución de identidad, divergente de la única que el humano vio.
    assert.equal(/\bc\.email\b|\bfull_name\b|ILIKE|similarity\s*\(/i.test(body), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. El incumbente
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — el incumbente nunca se degrada', () => {
  it('NO existe una desactivación masiva de `is_primary`', () => {
    // La 116 sí tiene una (`SET is_primary = false WHERE … AND id <> …`) porque elige sobre un
    // contacto que acaba de crear. Aquí esa misma sentencia podría destronar al principal del
    // operador, así que directamente no existe.
    assert.equal(
      /SET\s+is_primary\s*=\s*false/i.test(body),
      false,
      'una sentencia capaz de degradar al principal existente no puede existir en este archivo',
    );
    // Y la 116 la conserva: esta prueba también vigila que no se «arregle» borrándola de allí.
    assert.equal(/SET\s+is_primary\s*=\s*false/i.test(body116), true);
  });

  it('el escalar heredado sólo se escribe cuando estaba vacío', () => {
    const update = body.slice(body.indexOf('UPDATE public.contacts\n       SET phone'));
    assert.ok(update.length > 0, 'no se encontró la proyección del escalar');
    assert.match(
      update.slice(0, update.indexOf(';')),
      /AND\s+NULLIF\(BTRIM\(COALESCE\(phone,\s*''\)\),\s*''\)\s+IS\s+NULL/i,
      'la proyección debe reafirmar que el escalar estaba vacío dentro del propio WHERE',
    );
  });

  it('la única otra escritura sobre `contacts` es el enlace de borrado, y no toca teléfonos', () => {
    const updates = body.match(/UPDATE\s+public\.contacts[\s\S]*?;/gi) ?? [];
    assert.equal(updates.length, 2, 'exactamente dos UPDATE sobre contacts: escalar y enlace');
    const link = updates.find((u) => /merged_candidate_ids/.test(u));
    assert.ok(link, 'falta el UPDATE que registra el enlace de borrado');
    assert.equal(/\bphone\b\s*=/.test(link), false, 'el enlace no puede tocar el teléfono');
  });

  it('el bootstrap se rinde cuando el escalar cambió entre la lectura y el lock', () => {
    assert.match(body, /observed_phone/);
    assert.match(body, /'stale'/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Tombstones y procedencia
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — tombstones y procedencia', () => {
  it('TODA inserción canónica lleva `ON CONFLICT (contact_id, dedupe_key) DO NOTHING`', () => {
    const inserts = count(body, /INSERT\s+INTO\s+public\.contact_phones\s*\(/gi);
    const guards = count(body, /ON\s+CONFLICT\s*\(contact_id,\s*dedupe_key\)\s*DO\s+NOTHING/gi);
    assert.ok(inserts > 0, 'debe haber inserciones canónicas');
    assert.equal(guards, inserts, 'cada inserción canónica necesita su guarda');
  });

  it('TODA inserción de procedencia lleva su guarda por clave de evento', () => {
    const inserts = count(body, /INSERT\s+INTO\s+public\.contact_phone_sources\s*\(/gi);
    const guards = count(
      body,
      /ON\s+CONFLICT\s*\(contact_phone_id,\s*source_event_key\)\s*DO\s+NOTHING/gi,
    );
    assert.ok(inserts > 0);
    assert.equal(guards, inserts);
  });

  it('la procedencia sólo se une a filas canónicas VIVAS', () => {
    const join = body.slice(body.indexOf('JOIN public.contact_phones op'));
    assert.match(join.slice(0, 400), /op\.suppressed_at\s+IS\s+NULL/i);
  });

  it('un teléfono SUPRIMIDO del candidato nunca se promueve', () => {
    const promotion = body.slice(
      body.indexOf('WITH promoted AS'),
      body.indexOf('SELECT COUNT(*) INTO v_inserted FROM promoted'),
    );
    assert.match(promotion, /p\.suppressed_at\s+IS\s+NULL/i);
  });

  it('la clave oficial del incumbente lleva su propio espacio de nombres', () => {
    assert.match(body, /'v1:incumbent:'\s*\|\|/);
    assert.match(body, /'v1:promoted:'\s*\|\|/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Locks, guardias y no-divergencia
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — locks, guardias e invariantes compartidas', () => {
  it('bloquea el candidato ANTES que el contacto — el orden de 112/115/116', () => {
    const candidateLock = body.indexOf('FROM public.contact_enrichment_candidates c');
    const contactLock = body.indexOf('FROM public.contacts c');
    assert.ok(candidateLock > 0 && contactLock > 0);
    assert.ok(
      candidateLock < contactLock,
      'invertir el orden respecto a la 115 haría posible un deadlock con el borrado',
    );
    assert.equal(count(body, /FOR\s+UPDATE/gi), 2, 'exactamente los dos locks, ni uno más');
  });

  it('rechaza cualquier destino que no sea el `matched_contacts_id` registrado — IDOR', () => {
    assert.match(
      body,
      /v_candidate\.matched_contacts_id\s+IS\s+DISTINCT\s+FROM\s+p_contact_id/i,
    );
    assert.match(body, /'contact_mismatch'/);
  });

  it('sólo actúa sobre candidatos `duplicate`, y sólo escribe el veredicto `duplicate`', () => {
    assert.match(body, /c_mergeable\s+text\[\]\s*:=\s*ARRAY\['duplicate'\]/);
    assert.match(body, /p_review_patch\s*->>\s*'status'\s+IS\s+DISTINCT\s+FROM\s+'duplicate'/);
    assert.match(body, /AND\s+status\s*=\s*'duplicate'/);
  });

  it('vuelve a comprobar la supresión POR PERSONA con los helpers de la 113', () => {
    assert.match(body, /public\.phone_reveal_normalized_apollo_person_id\(/);
    assert.match(body, /public\.phone_reveal_person_suppression_exists\(/);
    assert.match(body, /'person_suppressed'/);
  });

  it('los DOS rankings son byte-idénticos a los de la 116', () => {
    const grab = (sql: string, name: string) => {
      const at = sql.indexOf(`${name}`);
      assert.ok(at > 0, `no se encontró ${name}`);
      return sql.slice(at, sql.indexOf('];', at) + 2).replace(/\s+/g, ' ');
    };
    assert.equal(grab(body, 'c_type_ranking'), grab(body116, 'c_type_ranking'));
    assert.equal(grab(body, 'c_source_ranking'), grab(body116, 'c_source_ranking'));
  });

  it('es SECURITY INVOKER con `search_path` fijado', () => {
    assert.match(migration, /SECURITY\s+INVOKER/);
    assert.match(migration, /SET\s+search_path\s*=\s*pg_catalog,\s*pg_temp/);
  });

  it('revoca PUBLIC/anon/authenticated y concede sólo a postgres y service_role', () => {
    assert.match(migration, /REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC;/);
    assert.match(migration, /REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+anon;/);
    assert.match(migration, /REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+authenticated;/);
    assert.match(migration, /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+postgres,\s*service_role;/);
  });

  it('declara honestamente que NO está aplicada en Producción', () => {
    assert.match(migration, /APPLIED IN PRODUCTION:\s*NO/);
  });

  it('la 116 NO se re-emite: la función viva de hoy no se toca', () => {
    assert.equal(/approve_contact_candidate_with_phones/.test(migration), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. El cableado
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — el cableado en TypeScript', () => {
  it('la persistencia no contiene ninguna escritura suelta por PostgREST', () => {
    const code = stripTs(persistence);
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.equal(code.includes(forbidden), false, `${forbidden} no puede existir aquí`);
    }
    assert.equal(count(code, /\.rpc\(/g), 1, 'exactamente UNA llamada RPC');
  });

  it('la acción exige usuario activo y no introduce un rol nuevo', () => {
    const code = stripTs(actions);
    const at = code.indexOf('export async function mergeContactCandidateIntoExistingContactAction');
    assert.ok(at > 0, 'falta la server action del merge');
    const fn = code.slice(at, at + 6000);
    assert.match(fn, /requireActiveUserForEnrichment\(\)/);
    // No aparece ninguna comprobación de rol propia: la autorización es la MISMA que aprobar.
    assert.equal(/roleKey|role_id|'admin'/.test(fn), false);
  });

  it('la acción no llama a ningún proveedor ni escribe contabilidad', () => {
    const code = stripTs(actions);
    const at = code.indexOf('export async function mergeContactCandidateIntoExistingContactAction');
    const fn = code.slice(at, at + 6000);
    for (const forbidden of [
      /apollo/i,
      /lusha/i,
      /hubspot/i,
      /reserv/i,
      /usage_log/i,
      /credit/i,
    ]) {
      assert.equal(forbidden.test(fn), false, `la acción no puede mencionar ${forbidden}`);
    }
  });

  it('la auditoría del merge no lleva PII', () => {
    const code = stripTs(actions);
    const at = code.indexOf("actionType: 'contact_updated'");
    assert.ok(at > 0, 'falta la auditoría del merge');
    const details = code.slice(at, code.indexOf('});', at));
    for (const forbidden of ['full_name', 'email', 'phone:', 'linkedin']) {
      assert.equal(details.includes(forbidden), false, `${forbidden} no puede viajar al audit`);
    }
  });

  it('la resolución de identidad no usa `.find()` sobre los contactos', () => {
    // `.find()` es literalmente el «primer match SQL» que este hito prohíbe. `findDuplicateContact`
    // lo conserva —sólo AVISA—, pero la resolución confiable debe contar.
    const code = stripTs(reviewCore);
    const at = code.indexOf('export function resolveTrustedExistingContactMatch');
    const fn = code.slice(at, code.indexOf('function uniqueContactIds', at));
    assert.equal(/\.find\(/.test(fn), false);
    assert.match(fn, /\.length\s*>\s*1/);
  });

  it('el nombre NUNCA participa en la resolución confiable', () => {
    const code = stripTs(reviewCore);
    const at = code.indexOf('export function resolveTrustedExistingContactMatch');
    const fn = code.slice(at, code.indexOf('function uniqueContactIds', at));
    assert.equal(/nameKey\(/.test(fn), false, 'nameKey no puede aparecer aquí');
  });

  it('el bootstrap del incumbente reutiliza LA tabla de inversión, no una copia', () => {
    const code = stripTs(mergeCore);
    assert.match(code, /LEGACY_SOURCE_TO_OFFICIAL_PAIR/);
    // Y no redeclara la suya: una segunda tabla es la misma tabla divergiendo.
    assert.equal(/apollo_search:\s*\{\s*provider/.test(code), false);
  });

  it('el borrado acepta el enlace de fusión con la MISMA fuerza que la creación', () => {
    const code = stripTs(suppressionCore);
    const at = code.indexOf('export function resolveContactErasureProvenance');
    const fn = code.slice(at, at + 900);
    assert.match(fn, /mergedCandidateIds/);
    assert.match(fn, /provenance_proven/);
  });
});
