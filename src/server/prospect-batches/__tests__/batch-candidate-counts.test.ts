/**
 * AGENT1-CUT4-A1 — BATCH COUNT TRUTHFULNESS.
 *
 * Lo que se prueba aquí es una sola frase:
 *
 *   EXISTENCIA DURABLE != CLASIFICACIÓN DE CALIDAD DE UI.
 *
 * Gate 0 midió en Producción 100 candidatos durables repartidos en 24 lotes que
 * la capa de lotes contaba como CERO, porque el conteo pasaba por
 * `isUsefulReviewCandidate` —un clasificador de calidad que devuelve `false`
 * para un candidato colombiano sin `tax_identifier` que no venga de
 * `external_import`—. Apollo, Lusha y web_ai persisten esos candidatos de forma
 * legítima y son aprobables desde Prospectos.
 *
 * ALCANCE, explícito: este PR NO redefine el clasificador. El mismo candidato
 * puede seguir siendo «no útil» y a la vez contar. Lo que cambia es DÓNDE se usa
 * el clasificador, no lo que significa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  computeBatchCandidateCounts,
  computeCountsByBatch,
  EMPTY_BATCH_CANDIDATE_COUNTS,
  BATCH_PENDING_REVIEW_STATUSES,
} from '../batch-candidate-counts';
import { DURABLE_PROSPECT_CANDIDATE_STATUSES } from '../batch-durable-candidates';
import { isUsefulReviewCandidate } from '@/modules/prospect-batches/types';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── Fixtures: la fila exacta que el lote borraba ──────────────────────────────
//
// Colombiana, `record_origin = production`, `needs_review`, SIN NIT. Se repite
// con la forma de los tres proveedores que la producen porque el defecto no era
// de un proveedor: era del conteo.

function coNoNit(sourcePrimary: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Instituto Nacional de Ejemplo',
    legal_name: 'INSTITUTO NACIONAL DE EJEMPLO S.A.S.',
    country_code: 'CO',
    tax_identifier: null,
    duplicate_status: 'unchecked',
    status: 'needs_review',
    review_flags: [] as string[],
    legal_status: null,
    source_primary: sourcePrimary,
    record_origin: 'production',
    ...overrides,
  };
}

const APOLLO_ROW = coNoNit('apollo');
const LUSHA_ROW = coNoNit('lusha');
const WEB_AI_ROW = coNoNit('web_ai');

describe('CUT4-A1 § 1 — el candidato CO sin NIT existe para el lote', () => {
  it('CO + sin NIT + production + needs_review cuenta 1 y acredita existencia', () => {
    const counts = computeBatchCandidateCounts([APOLLO_ROW]);
    assert.equal(counts.total, 1);
    assert.equal(counts.needsReview, 1);
    assert.ok(counts.total > 0, 'el lote NO está vacío');
  });

  it('el mismo candidato SIGUE clasificado como no útil (semántica intacta)', () => {
    assert.equal(isUsefulReviewCandidate(APOLLO_ROW), false);
  });

  it('EL DEFECTO, medido: el conteo por clasificador da 0 donde el durable da 3', () => {
    const rows = [APOLLO_ROW, LUSHA_ROW, WEB_AI_ROW];
    // Así contaba la capa de lotes antes de CUT4-A1.
    const legacyTotal = rows.filter(isUsefulReviewCandidate).length;
    assert.equal(legacyTotal, 0, 'reproducción del cero falso');
    assert.equal(computeBatchCandidateCounts(rows).total, 3);
  });
});

describe('CUT4-A1 §§ 2-4 — los tres proveedores que producen la fila', () => {
  for (const [label, row] of [
    ['Apollo', APOLLO_ROW],
    ['Lusha', LUSHA_ROW],
    ['web_ai', WEB_AI_ROW],
  ] as const) {
    it(`${label}: candidato CO sin NIT cuenta`, () => {
      assert.equal(computeBatchCandidateCounts([row]).total, 1);
      assert.equal(isUsefulReviewCandidate(row), false, 'y sigue siendo «no útil»');
    });
  }
});

describe('CUT4-A1 §§ 5-7 — resultados de revisión siguen siendo contenido del lote', () => {
  it('discarded: cuenta en el total persistido y en su métrica propia', () => {
    const counts = computeBatchCandidateCounts([coNoNit('apollo', { status: 'discarded' })]);
    assert.equal(counts.total, 1);
    assert.equal(counts.discarded, 1);
    assert.equal(counts.needsReview, 0);
    assert.equal(counts.approved, 0);
  });

  it('duplicate: mismo principio, y el cubo de duplicados es honesto', () => {
    const counts = computeBatchCandidateCounts([
      coNoNit('lusha', { status: 'duplicate', duplicate_status: 'exact_duplicate' }),
    ]);
    assert.equal(counts.total, 1);
    assert.equal(counts.duplicates, 1);
  });

  it('un exact_duplicate en needs_review también se declara duplicado', () => {
    const counts = computeBatchCandidateCounts([
      coNoNit('apollo', { duplicate_status: 'exact_duplicate' }),
    ]);
    assert.equal(counts.total, 1);
    assert.equal(counts.duplicates, 1);
    assert.equal(counts.needsReview, 1);
  });

  it('converted_to_account: contado como convertido y como fila del lote', () => {
    const counts = computeBatchCandidateCounts([
      coNoNit('web_ai', { status: 'converted_to_account' }),
    ]);
    assert.equal(counts.total, 1);
    assert.equal(counts.converted, 1);
  });
});

describe('CUT4-A1 § 8 — fail-closed ante un estado desconocido', () => {
  it('un status fuera del contrato durable no cuenta para NADA', () => {
    const counts = computeBatchCandidateCounts([
      coNoNit('apollo', { status: 'erased_by_future_migration' }),
    ]);
    assert.deepEqual(counts, EMPTY_BATCH_CANDIDATE_COUNTS);
  });

  it('null, undefined y no-string tampoco fabrican existencia', () => {
    for (const status of [null, undefined, 42, {}, []]) {
      const counts = computeBatchCandidateCounts([{ status } as { status?: string | null }]);
      assert.equal(counts.total, 0, `status=${JSON.stringify(status)}`);
    }
  });

  it('una lista vacía / nula devuelve ceros, no lanza', () => {
    assert.deepEqual(computeBatchCandidateCounts([]), EMPTY_BATCH_CANDIDATE_COUNTS);
    assert.deepEqual(computeBatchCandidateCounts(null), EMPTY_BATCH_CANDIDATE_COUNTS);
    assert.deepEqual(computeBatchCandidateCounts(undefined), EMPTY_BATCH_CANDIDATE_COUNTS);
  });

  it('los siete estados durables cuentan, uno por uno', () => {
    for (const status of DURABLE_PROSPECT_CANDIDATE_STATUSES) {
      assert.equal(
        computeBatchCandidateCounts([coNoNit('apollo', { status })]).total,
        1,
        status,
      );
    }
  });

  it('no se inventa una segunda lista durable: pendiente ⊂ durable', () => {
    for (const status of BATCH_PENDING_REVIEW_STATUSES) {
      assert.ok(
        (DURABLE_PROSPECT_CANDIDATE_STATUSES as readonly string[]).includes(status),
        status,
      );
    }
  });
});

describe('CUT4-A1 — reparto por lote', () => {
  it('agrupa por batch_id sin mezclar y sin perder filas', () => {
    const byBatch = computeCountsByBatch([
      { ...APOLLO_ROW, batch_id: 'b1' },
      { ...LUSHA_ROW, batch_id: 'b1' },
      { ...WEB_AI_ROW, batch_id: 'b2' },
      { ...coNoNit('apollo', { status: 'approved' }), batch_id: 'b2' },
    ]);
    assert.equal(byBatch.get('b1')?.total, 2);
    assert.equal(byBatch.get('b2')?.total, 2);
    assert.equal(byBatch.get('b2')?.approved, 1);
    assert.equal(byBatch.get('b3'), undefined);
  });

  it('una fila sin batch_id no se cuela en ningún lote', () => {
    const byBatch = computeCountsByBatch([{ ...APOLLO_ROW, batch_id: null }]);
    assert.equal(byBatch.size, 0);
  });
});

// ── Trinquetes de callsite: fallan en `main` a propósito ──────────────────────

const COUNT_FUNCTIONS = [
  'getProspectBatchesSummary',
  'getProspectBatchesList',
  'getProspectBatchById',
  'getBatchDetailSummary',
];

function sliceFunction(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `no se encontró ${name}`);
  const rest = src.slice(start + 1);
  const next = rest.indexOf('\nexport async function ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('CUT4-A1 § 12.A — ningún conteo de lote pasa ya por el clasificador', () => {
  const actions = stripComments(read('src/modules/prospect-batches/actions.ts'));

  for (const fn of COUNT_FUNCTIONS) {
    it(`${fn} no menciona isUsefulReviewCandidate`, () => {
      // MUTACIÓN NEGATIVA: volver a cablear el conteo por el clasificador —
      // p. ej. `list.filter(isUsefulReviewCandidate)`— rompe esta guarda. En
      // `main` estas cuatro funciones SÍ lo mencionan, así que este test falla
      // sobre `main` y pasa sobre el parche.
      assert.ok(
        !sliceFunction(actions, fn).includes('isUsefulReviewCandidate'),
        `${fn} volvió a contar por calidad de UI`,
      );
    });
  }

  it('el módulo de conteo no puede siquiera ver el clasificador', () => {
    const src = stripComments(read('src/server/prospect-batches/batch-candidate-counts.ts'));
    for (const forbidden of [
      'isUsefulReviewCandidate',
      'tax_identifier',
      'country_code',
      'source_primary',
    ]) {
      assert.ok(!src.includes(forbidden), `${forbidden} no pertenece al conteo`);
    }
  });

  it('el conteo reutiliza el contrato durable de CUT-1, no uno nuevo', () => {
    const src = read('src/server/prospect-batches/batch-candidate-counts.ts');
    assert.ok(src.includes("from './batch-durable-candidates'"));
    assert.ok(!/DURABLE_[A-Z_]*STATUSES\s*=/.test(src), 'segunda lista durable prohibida');
  });

  it('el conteo es PURO: sin Supabase, sin env, sin reloj, sin React', () => {
    const src = stripComments(read('src/server/prospect-batches/batch-candidate-counts.ts'));
    for (const forbidden of ['createClient', 'process.env', 'Date.now', 'new Date(', 'react']) {
      assert.ok(!src.includes(forbidden), forbidden);
    }
  });
});

describe('CUT4-A1 § 12.D/E — el clasificador y la generación quedan intactos', () => {
  it('la regla CO-sin-NIT del clasificador sigue en pie', () => {
    assert.equal(isUsefulReviewCandidate(APOLLO_ROW), false);
    assert.equal(isUsefulReviewCandidate({ ...APOLLO_ROW, tax_identifier: '900123456' }), true);
    assert.equal(
      isUsefulReviewCandidate({ ...APOLLO_ROW, source_primary: 'external_import' }),
      true,
    );
  });

  it('usefulCount de la generación sigue calculándose con el clasificador', () => {
    const src = read('src/server/agents/prospect-generation.ts');
    const occurrences = src.split('isUsefulReviewCandidate').length - 1;
    // 1 import + 9 usos. Pinchado exacto: CUT4-A1 no toca este fichero, y
    // cualquier cambio de la aritmética de objetivo tiene que declararse aquí.
    assert.equal(occurrences, 10, 'la generación cambió de aritmética');
    assert.ok(src.includes('usefulCount = candidates.filter(isUsefulReviewCandidate).length;'));
  });

  it('la admisión post-enriquecimiento tampoco cambia de criterio', () => {
    const src = read('src/server/agents/prospecting-toolkit/official-candidate-enricher.ts');
    assert.ok(src.includes('return isUsefulReviewCandidate(candidate);'));
  });

  it('el contrato durable de CUT-1 no se reescribe', () => {
    assert.deepEqual([...DURABLE_PROSPECT_CANDIDATE_STATUSES], [
      'generated',
      'normalized',
      'needs_review',
      'approved',
      'discarded',
      'duplicate',
      'converted_to_account',
    ]);
  });
});

describe('CUT4-A1 § 12.I — la ficha del lote no cablea acciones heredadas', () => {
  const page = read('src/app/(sellup)/prospect-batches/[batchId]/page.tsx');

  it('la ficha del lote no monta ni importa CandidateRowActions', () => {
    // Se despoja de comentarios: nombrar el componente para explicar POR QUÉ no
    // se toca no es lo mismo que montarlo.
    const code = stripComments(page).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    assert.ok(!code.includes('CandidateRowActions'));
  });

  it('la ficha no cablea aprobar/descartar/duplicar a más filas', () => {
    for (const action of [
      'approveAndConvertCandidateAction',
      'discardCandidate',
      'markCandidateDuplicate',
    ]) {
      assert.ok(!page.includes(action), `${action} no debe aparecer en la ficha`);
    }
  });

  // AGENT1-CUT4-C SUPERSEDE — las dos guardas que aquí fijaban
  // `candidates={usefulCandidates}` y «exactamente UN <CandidateRowActions»
  // describían el estado INTERMEDIO de A1 (contar la verdad sin ampliar la
  // superficie heredada). Mantenerlas ahora BLOQUEARÍA la corrección: CUT4-C
  // monta el universo durable y sustituye esa superficie por una segura. Su
  // sucesión vive en `cut4c-batch-visibility-safe-actions.test.ts`, que exige
  // lo contrario y además que la superficie heredada NO vuelva.
});
