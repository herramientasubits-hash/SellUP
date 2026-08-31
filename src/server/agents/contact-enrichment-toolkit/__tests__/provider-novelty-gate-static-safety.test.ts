/**
 * Tests — Static safety fence del novelty gate pre-pago
 * AGENT2A-PROVIDER-NOVELTY-AND-REUSE-GATE-1
 *
 * Este hito solo puede EVITAR una llamada pagada. Estas pruebas defienden los
 * límites que no se observan desde una rama de ejecución: el punto de inserción
 * (antes de la pata pagada), la ausencia de migración, y que el gate no se
 * filtre a superficies fuera de alcance — Agente 1, revelado de teléfonos,
 * Search More, privacidad/supresión y el dedupe final.
 *
 * Matriz del hito cubierta aquí: 29, 30, 31, 32, 33, y la sección de datos
 * ("no se crea migración").
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const TOOLKIT = path.join(__dirname, '..');
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

function read(relativeToToolkit: string): string {
  return readFileSync(path.join(TOOLKIT, relativeToToolkit), 'utf8');
}

/** Quita comentarios para inspeccionar solo el CÓDIGO ejecutable. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const GATE_SOURCE = read('provider-native-novelty-gate.ts');
/**
 * Igual que GATE_SOURCE pero sin comentarios: la documentación del módulo
 * NOMBRA a propósito lo que evita y lo que no cambia (people/match,
 * privacidad/supresión, reutilización), y esas frases no deben hacer fallar
 * una valla pensada para el código.
 */
const GATE_CODE = stripComments(GATE_SOURCE);
const APOLLO_SOURCE = read('apollo-enrichment-runner.ts');
const LUSHA_SOURCE = read('lusha-enrichment-runner.ts');

// ── Insertion points ────────────────────────────────────────────

describe('punto de inserción — antes de la pata PAGADA', () => {
  it('Apollo: el gate corre antes de seleccionar candidatos para people/match', () => {
    const gateAt = APOLLO_SOURCE.indexOf('applyProviderNativeNoveltyGate({');
    const selectAt = APOLLO_SOURCE.indexOf('selectCandidatesForCompletion(');
    const completeAt = APOLLO_SOURCE.indexOf('await completeContact({');
    assert.ok(gateAt > 0, 'el gate debe estar cableado en el runner de Apollo');
    assert.ok(gateAt < selectAt, 'el gate va antes de la selección para completion');
    assert.ok(gateAt < completeAt, 'el gate va antes de cualquier people/match');
  });

  it('Apollo: solo las identidades novedosas entran a la clasificación', () => {
    assert.ok(
      /const classified: ClassifiedContact\[\] = novelNormalized\.map/.test(APOLLO_SOURCE),
      'la clasificación debe consumir el resultado del gate, no `normalized`',
    );
  });

  it('Lusha: el gate corre antes de cada /v3/contacts/enrich', () => {
    const gates = [...LUSHA_SOURCE.matchAll(/applyProviderNativeNoveltyGate\(\{/g)].map((m) => m.index ?? -1);
    const enrichCalls = [...LUSHA_SOURCE.matchAll(/await enrichLushaContactsV3\(\{/g)].map((m) => m.index ?? -1);
    assert.ok(gates.length >= 2, 'ambas ramas de descubrimiento deben tener gate');
    // Cada llamada de enrich del descubrimiento automático queda por detrás de
    // al menos un gate. La rama de enrich controlado (identidad explícita
    // provista por el operador) no es descubrimiento automático y no se cierra
    // en este hito — vive antes del primer gate del archivo.
    const firstGate = Math.min(...gates);
    const discoveryEnrichCalls = enrichCalls.filter((i) => i > firstGate);
    assert.equal(discoveryEnrichCalls.length, 2, 'prospecting + búsqueda por empresa');
    for (const call of discoveryEnrichCalls) {
      assert.ok(gates.some((g) => g < call), 'todo enrich de descubrimiento va después de un gate');
    }
  });

  it('Lusha: los conjuntos que van al enrich derivan del resultado del gate', () => {
    assert.ok(
      LUSHA_SOURCE.includes('const selectedForEnrich = novelForEnrich.slice(0, maxCandidates);'),
      'prospecting debe enriquecer solo identidades novedosas',
    );
    assert.ok(
      LUSHA_SOURCE.includes('const candidates = searchNoveltyGate.novel.slice(0, maxCandidates);'),
      'la búsqueda por empresa debe enriquecer solo identidades novedosas',
    );
  });
});

// ── Data model: no migration ────────────────────────────────────

describe('modelo de datos — sin migración nueva', () => {
  it('no se añade ninguna migración por encima de la 123', () => {
    const files = readdirSync(path.join(REPO_ROOT, 'supabase', 'migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    const numbers = files
      .map((f) => Number.parseInt(f.slice(0, 3), 10))
      .filter((n) => Number.isFinite(n));
    // El techo sube cuando un hito AUTORIZADO añade la suya, y lo que esta guarda
    // protege es que no lo mueva ESTE. La 124 la aporta
    // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 (identidad provider-native,
    // grano de reserva por operación, claim propio de la búsqueda) y trae su propia
    // guarda estática; el gate de novedad de este hito sigue sin SQL propio, que es lo
    // que se comprueba justo debajo leyendo su fuente.
    // BR-SOURCE-FUNCTIONAL-CUT-A tomó la 125, y luego la 126 (identidad MENSUAL del snapshot de
    // Receita: `source_period` + unicidad period-aware; AUTORADA y NO APLICADA).
    // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY reclamó el 126 de forma independiente mientras la
    // reconciliación de BR-SOURCE CUT A.1 seguía en revisión: el vallado optimista de la
    // admisión por identidad de LOTE (Agente 1). Añade `prospect_batches.identity_epoch` y dos
    // funciones sobre `prospect_batches` y `prospect_candidates`; NO es de teléfono en absoluto
    // y no nombra ninguna tabla, columna ni función de teléfono, que es lo que esta guarda
    // vigila. Trae su propia guarda estática y NO edita ninguna migración anterior. NO aplicada
    // en Producción.
    // BR-SOURCE CUT A.1 RENUMERÓ su propia migración una segunda vez, de 126 a 127, para no
    // colisionar con la de AGENT1-CUT3B4, y dejó sitio a una migración 125 genérica
    // (reconciliación de `record_identity_key` sobre `source_company_snapshots`, fuentes NO
    // brasileñas); ninguna de las tres toca el gate de novedad.
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 mueve el techo a la 128: la
    // proyección de la colección de teléfonos de un candidato ya APROBADO al contacto que su
    // aprobación creó. Es de teléfono, pero no de este hito y no toca lo que esta guarda vigila;
    // trae su propia guarda estática. AUTORADA y NO APLICADA.
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 mueve el techo a la 132: la cadena de
    // sincronización con HubSpot de Agente 2 (129 la completitud del estado durable `stale`, 130
    // su procedencia, 131 la 128 re-emitida, 132 la línea base de los contactos ya vinculados),
    // canonicalizada desde cuatro archivos que nacieron sin número. Es de teléfono y de HubSpot,
    // pero no de este hito: la aserción de abajo —que el gate de novedad no lee NINGUNA migración
    // suya— es la que de verdad protege este archivo, y no cambia. AUTORADAS y NO APLICADAS.
    // BR-PRODUCTION-RELEASE mueve el techo a la 133: `133_br_candidate_identity_promotion.sql`,
    // la promoción VALLADA de la identidad fiscal resuelta de una candidata brasileña
    // (BR-SOURCE CUT D), numerada al volver ese trabajo a GitHub después de haber vivido en local
    // sin número mientras el espacio de nombres estaba en disputa. Crea UNA función
    // (`promote_candidate_fiscal_identity_fenced`) y sus permisos: sin tabla, sin columna, sin
    // índice, sin constraint y sin backfill. NO es de teléfono y no nombra ninguna tabla, columna
    // ni función de teléfono, que es lo que esta guarda vigila. AUTORADA y NO APLICADA.
    // BR-COMPACT-SNAPSHOT-PRODUCTIZATION mueve el techo a la 134:
    // `134_br_receita_compact_snapshot.sql`, la tabla dedicada y particionada del snapshot
    // nacional de Brasil. Crea UNA tabla y sus funciones de ciclo de vida de partición. NO es de
    // teléfono y no nombra ninguna tabla, columna ni función de teléfono, que es lo que esta
    // guarda vigila. AUTORADA y NO APLICADA.
    assert.equal(Math.max(...numbers), 134, 'el techo conocido es la 134');
    assert.equal(
      GATE_SOURCE.includes('supabase/migrations'),
      false,
      'el gate de novedad no depende de ninguna migración propia',
    );
  });

  it('la identidad nativa se lee de source_contact_id, no de apollo_person_id', () => {
    // apollo_person_id (migración 098) es la columna del revelado de TELÉFONOS.
    // Reutilizarla como identidad de descubrimiento mezclaría dos dominios.
    assert.ok(GATE_SOURCE.includes('source_contact_id'));
    assert.equal(GATE_SOURCE.includes('apollo_person_id'), false);
  });

  it('el scope de empresa se resuelve solo con claves deterministas del run', () => {
    assert.ok(GATE_SOURCE.includes('account_id'));
    assert.ok(GATE_SOURCE.includes('hubspot_company_id'));
    assert.ok(GATE_SOURCE.includes('company_domain'));
    assert.equal(GATE_SOURCE.includes('company_name'), false, 'el nombre nunca es clave de scope');
  });
});

// ── Out-of-scope surfaces stay untouched ────────────────────────

describe('superficies fuera de alcance', () => {
  it('TEST 33 — el gate no toca ninguna superficie del Agente 1', () => {
    assert.equal(/prospect-batches/.test(GATE_SOURCE), false);
    assert.equal(/prospect_candidates/.test(GATE_SOURCE), false);
    assert.equal(/provider_seen_entities/.test(GATE_SOURCE), false);
  });

  it('TEST 31 — el gate no toca el revelado de teléfonos', () => {
    for (const forbidden of [
      'phone_reveal',
      'revealCandidatePhone',
      'candidate_phones',
      'phone_reveal_waterfall',
      'contact_phones',
    ]) {
      assert.equal(GATE_SOURCE.includes(forbidden), false, `no debe referenciar ${forbidden}`);
    }
  });

  it('TEST 32 — el gate no toca Search More', () => {
    assert.equal(/search[-_]?more/i.test(GATE_SOURCE), false);
  });

  it('TEST 30 — el gate no toca privacidad ni supresión', () => {
    for (const forbidden of ['suppression', 'suppress', 'erasure', 'dsar', 'privacy']) {
      assert.equal(
        GATE_CODE.toLowerCase().includes(forbidden),
        false,
        `no debe referenciar ${forbidden}`,
      );
    }
  });

  it('el gate no aprueba, revive ni copia candidatos históricos', () => {
    for (const forbidden of ['approveCandidate', 'official_contact', 'reuse', 'refresh']) {
      assert.equal(
        GATE_CODE.includes(forbidden),
        false,
        `un skip es ahorro de costo, no reutilización (${forbidden})`,
      );
    }
    // HubSpot solo aparece como CLAVE DE SCOPE de empresa. La valla dura es la
    // superficie de datos: el gate lee UNA tabla y no escribe en ninguna.
    const tables = [...GATE_CODE.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(tables)], ['contact_enrichment_candidates']);
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.equal(GATE_CODE.includes(write), false, `el gate no escribe (${write})`);
    }
  });
});

// ── Regression fences ───────────────────────────────────────────

describe('vallas de regresión', () => {
  it('TEST 29 — el dedupe final sigue cableado en Apollo', () => {
    assert.ok(APOLLO_SOURCE.includes('deduplicateContacts('));
    assert.ok(APOLLO_SOURCE.includes('writeCandidates('));
    const writer = read('contact-candidate-writer.ts');
    assert.ok(
      writer.includes('findMatchingPendingCandidate('),
      'la barrera tardía de duplicados pendientes sigue intacta',
    );
  });

  it('el dedupe exacto de Lusha sigue cableado en ambas ramas', () => {
    const checks = [...LUSHA_SOURCE.matchAll(/await checkExactDuplicate\(/g)];
    assert.ok(checks.length >= 3, 'el dedupe existente no se retira');
  });

  it('el routing automático sigue decidiendo con la verdad POST-novelty', () => {
    // candidatesCreated ya es el conteo posterior al gate: una identidad
    // omitida no crea candidato, así que el routing observa el estado real sin
    // necesidad de un contrato nuevo. Forzar Lusha por el mero hecho de haber
    // omitido identidades de Apollo sería un cambio de política — no ocurre.
    const orchestrator = read('contact-enrichment-routing-orchestrator.ts');
    assert.ok(orchestrator.includes('reviewableCandidateCount: attempt1Result.candidatesCreated'));
    assert.equal(
      orchestrator.includes('skippedKnownProviderIdentity'),
      false,
      'el orquestador no debe ramificar por el contador de skips',
    );
  });

  it('People Search sigue declarando 0 créditos y 0 USD', () => {
    const adapter = read('apollo-people-adapter.ts');
    assert.ok(adapter.includes('export const APOLLO_PEOPLE_SEARCH_CREDITS = 0;'));
    assert.ok(adapter.includes('export const APOLLO_PEOPLE_SEARCH_COST_USD = 0;'));
  });

  it('el gate declara explícitamente que el costo de Prospecting/Search de Lusha NO se resuelve', () => {
    assert.ok(
      /Prospecting\/Search/.test(GATE_SOURCE),
      'el módulo debe documentar el límite del ahorro en Lusha',
    );
    assert.ok(
      /NO RESUELTO POR ESTE HITO|no se resuelve|NOT solved/i.test(LUSHA_SOURCE),
      'el runner de Lusha debe dejar el límite por escrito en el punto de inserción',
    );
  });
});
