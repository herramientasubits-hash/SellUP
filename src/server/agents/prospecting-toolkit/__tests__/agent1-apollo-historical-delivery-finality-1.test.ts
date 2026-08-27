/**
 * agent1-apollo-historical-delivery-finality-1.test.ts
 *
 * AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY — la autoridad PURA de permanencia,
 * su matriz de estados, la puerta de procedencia y las guardas estructurales
 * de ámbito.
 *
 * Cero I/O, cero proveedores, cero créditos: todo son entradas literales.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  evaluatePrepaidHistoricalDuplicate,
  isDeliveryOccupyingStatus,
  isHistoricalDeliveryStatus,
  isProductiveDeliveryRow,
  NON_DELIVERY_RECORD_ORIGINS,
  PREPAID_HISTORICAL_STATUS_POLICY,
  PROSPECT_CANDIDATE_DB_STATUSES,
  type HistoricalCandidateRow,
} from '../apollo-prepaid-historical-parity';
import { BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES } from '../batch-identity-registry';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function row(overrides: Partial<HistoricalCandidateRow> = {}): HistoricalCandidateRow {
  return {
    id: 'cand-1',
    batch_id: 'batch-previa',
    name: 'Empresa X',
    domain: 'empresax.com',
    status: 'discarded',
    duplicate_status: 'new_candidate',
    country_code: 'CO',
    source_primary: null,
    review_notes: null,
    metadata: null,
    ...overrides,
  };
}

const NEEDLE_X = {
  normalizedDomain: 'empresax.com',
  name: 'Empresa X',
  countryCode: 'CO',
};

const TOOLKIT_DIR = join(process.cwd(), 'src/server/agents/prospecting-toolkit');

// ─── § 8 · la tabla canónica por estado ──────────────────────────────────────

describe('§ 8 · política final por estado — ninguno puede volver a ser nuevo', () => {
  test('los SIETE estados de la CHECK prueban una entrega', () => {
    for (const status of PROSPECT_CANDIDATE_DB_STATUSES) {
      assert.equal(
        isHistoricalDeliveryStatus(status),
        true,
        `${status} debe probar una entrega histórica`,
      );
    }
  });

  test('§ 7 · los estados INEXISTENTES no prueban nada (fail-closed)', () => {
    for (const invented of ['rejected', 'archived', 'converted', 'ready', '', 'GENERATED']) {
      assert.equal(
        isHistoricalDeliveryStatus(invented),
        false,
        `${invented} no existe en prospect_candidates_status_check`,
      );
    }
    assert.equal(isHistoricalDeliveryStatus(null), false);
    assert.equal(isHistoricalDeliveryStatus(undefined), false);
  });

  test('CAN BE NEW AGAIN = NO para los siete, en AMBAS columnas', () => {
    for (const status of PROSPECT_CANDIDATE_DB_STATUSES) {
      const policy = PREPAID_HISTORICAL_STATUS_POLICY[status];
      assert.equal(
        policy.blocksHistoricalRedelivery,
        true,
        `${status}: la re-entrega histórica ya no depende del cooldown`,
      );
      assert.equal(
        policy.blocksPrepaymentReenrichment,
        true,
        `${status}: el re-enriquecimiento ya no depende del cooldown`,
      );
      assert.ok(policy.rationale.length > 0);
    }
  });

  test('🔴 ninguna columna de la política queda gobernada por cooldown', () => {
    const values = Object.values(PREPAID_HISTORICAL_STATUS_POLICY).flatMap((p) => [
      p.blocksHistoricalRedelivery,
      p.blocksPrepaymentReenrichment,
    ]);
    assert.equal(
      values.includes('cooldown_governed'),
      false,
      'la ventana de 30/90 d ya no es la autoridad de novedad de entrega',
    );
  });
});

// ─── § 14 · ocupación de lote ≠ historia de entrega ──────────────────────────

describe('§ 14 · las dos capas siguen SIENDO distintas', () => {
  test('discarded/duplicate NO ocupan el lote — CUT-3 intacto', () => {
    assert.equal(isDeliveryOccupyingStatus('discarded'), false);
    assert.equal(isDeliveryOccupyingStatus('duplicate'), false);
  });

  test('el conjunto canónico del registro de lote NO se amplió', () => {
    assert.deepEqual([...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES], [
      'generated',
      'normalized',
      'needs_review',
      'approved',
      'converted_to_account',
    ]);
  });

  test('...y sin embargo discarded/duplicate SÍ prueban una entrega', () => {
    assert.equal(isHistoricalDeliveryStatus('discarded'), true);
    assert.equal(isHistoricalDeliveryStatus('duplicate'), true);
  });
});

// ─── § 3 / § 16 · permanencia: cero ventana temporal ─────────────────────────

describe('§ 3 / § 16 · la memoria de entrega no expira', () => {
  test('discarded con la novedad de entrega PERMISIVA: bloqueado igual', () => {
    // `deliveryNoveltyShouldSkip: false` es exactamente lo que devuelve
    // `evaluateCandidateNovelty` para un descarte de 31 d / 91 d / 200 d.
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'discarded' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.reason, 'historical_delivery_duplicate');
    assert.equal(verdict.matchedAxis, 'normalized_domain');
    assert.equal(verdict.matchedStatus, 'discarded');
    assert.equal(verdict.matchedCandidateId, 'cand-1');
  });

  test('duplicate sin ayuda de la novedad: bloqueado por historia propia', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'duplicate' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.reason, 'historical_delivery_duplicate');
  });

  test('§ 23 · el motivo es UNO y provider-neutral, no uno por estado', () => {
    const reasons = new Set<string | null>();
    for (const status of PROSPECT_CANDIDATE_DB_STATUSES) {
      const verdict = evaluatePrepaidHistoricalDuplicate({
        needle: NEEDLE_X,
        rows: [row({ status })],
        deliveryNoveltyShouldSkip: false,
      });
      assert.equal(verdict.alreadyKnown, true, status);
      reasons.add(verdict.reason);
    }
    // Dos motivos para DOS hechos distintos («sigue ocupando» vs «se entregó y
    // se resolvió»), nunca uno por estado.
    assert.deepEqual(
      [...reasons].sort(),
      ['historical_delivery_duplicate', 'historical_delivery_occupies_identity'],
    );
  });
});

// ─── § 6 · identidad fiscal ──────────────────────────────────────────────────

describe('§ 6 · un descarte histórico también se reconoce por identidad fiscal', () => {
  test('sin dominio, misma identidad fiscal con país: bloqueado', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: null,
        name: 'Empresa X',
        // El NIT colombiano canonicaliza SIN dígito de verificación, así que las
        // dos escrituras del MISMO NIT resuelven a `CO:900123456`.
        taxIdentifier: '900.123.456-7',
        countryCode: 'CO',
      },
      rows: [
        row({ status: 'discarded', domain: null, tax_identifier: '900123456' }),
      ],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.matchedAxis, 'fiscal_identity');
    assert.equal(verdict.reason, 'historical_delivery_duplicate');
  });

  test('sin país no hay igualdad fiscal (CUT-3B1 § 8)', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: null,
        name: 'Empresa X',
        taxIdentifier: '900.123.456-7',
        countryCode: null,
      },
      rows: [
        row({
          status: 'discarded',
          domain: null,
          tax_identifier: '900123456',
          country_code: null,
        }),
      ],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
  });
});

// ─── § 5 / § 18 · el nombre NUNCA basta ──────────────────────────────────────

describe('§ 5 / § 18 · nombre solo = 0 bloqueo duro', () => {
  test('mismo nombre, dominio distinto: NO bloquea, y se declara la evidencia', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: 'siesa-enterprise.com',
        name: 'Siesa',
        countryCode: 'CO',
      },
      rows: [row({ status: 'discarded', name: 'Siesa', domain: 'siesa.com' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false, 'dos empresas distintas no se sacrifican');
    assert.equal(verdict.nameOnlyEvidence, true, 'la corroboración se DECLARA');
    assert.equal(verdict.matchedAxis, null);
  });

  test('sin dominio ni fiscal, sólo nombre idéntico: NO bloquea', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      // `buildIdentityKey('Empresa X')` es vacío —un nombre genérico de una sola
      // palabra útil no produce clave—, así que el fixture usa un nombre real.
      needle: { normalizedDomain: null, name: 'Siesa', countryCode: 'CO' },
      rows: [row({ status: 'discarded', name: 'Siesa', domain: null })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
    assert.equal(verdict.nameOnlyEvidence, true);
  });
});

// ─── § 19 · variantes de dominio ─────────────────────────────────────────────

describe('§ 19 · las variantes del mismo dominio son la misma identidad', () => {
  for (const variant of [
    'https://www.empresax.com',
    'www.empresax.com/',
    'EMPRESAX.COM',
    'http://empresax.com',
  ]) {
    test(`«${variant}» descartado bloquea a empresax.com`, () => {
      const verdict = evaluatePrepaidHistoricalDuplicate({
        needle: NEEDLE_X,
        rows: [row({ status: 'discarded', domain: variant })],
        deliveryNoveltyShouldSkip: false,
      });
      assert.equal(verdict.alreadyKnown, true, variant);
      assert.equal(verdict.matchedAxis, 'normalized_domain', variant);
    });
  }
});

// ─── § 2 · procedencia productiva ────────────────────────────────────────────

describe('§ 2 · «entregada» significa procedencia PRODUCTIVA', () => {
  test('el conjunto de procedencias no-entrega es exactamente el canónico', () => {
    assert.deepEqual([...NON_DELIVERY_RECORD_ORIGINS].sort(), [
      'historical_cleanup',
      'qa',
      'smoke_test',
      'synthetic',
    ]);
  });

  test('production / import / unknown quedan DENTRO del universo', () => {
    for (const origin of ['production', 'import', 'unknown'] as const) {
      assert.equal(
        NON_DELIVERY_RECORD_ORIGINS.has(origin),
        false,
        `${origin}: en protección de coste «no sé» no es «no existe»`,
      );
    }
  });

  const nonProductive: { label: string; overrides: Partial<HistoricalCandidateRow> }[] = [
    { label: 'metadata.smoke_test', overrides: { metadata: { smoke_test: true } } },
    { label: 'metadata.qa_only', overrides: { metadata: { qa_only: true } } },
    { label: 'source_primary smoke', overrides: { source_primary: 'smoke_script' } },
  ];

  for (const scenario of nonProductive) {
    test(`${scenario.label}: no es entrega y NO bloquea el gasto`, () => {
      const candidate = row({ status: 'discarded', ...scenario.overrides });
      assert.equal(isProductiveDeliveryRow(candidate), false, scenario.label);
      const verdict = evaluatePrepaidHistoricalDuplicate({
        needle: NEEDLE_X,
        rows: [candidate],
        deliveryNoveltyShouldSkip: false,
      });
      assert.equal(verdict.alreadyKnown, false, scenario.label);
    });
  }

  test('una fila productiva descartada SÍ es entrega', () => {
    const candidate = row({ status: 'discarded', source_primary: 'apollo_organizations' });
    assert.equal(isProductiveDeliveryRow(candidate), true);
  });

  test('🔴 la puerta de procedencia NO se aplica a los estados que OCUPAN el lote', () => {
    // Una fila que sigue en la cola está ahí con independencia de cómo se creó, y
    // no pagar es la dirección segura. Aplicarle la puerta reabriría gasto que el
    // corte anterior ya había cerrado.
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'approved', metadata: { smoke_test: true } })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.reason, 'historical_delivery_occupies_identity');
  });
});

// ─── § 14 · corrida actual vs historia permanente ────────────────────────────

describe('§ 14 · fail-open sigue siendo fail-open', () => {
  test('evidencia indisponible: no se afirma nada y no se bloquea gasto', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'discarded' })],
      deliveryNoveltyShouldSkip: false,
      evidenceUnavailable: true,
    });
    assert.equal(verdict.alreadyKnown, false);
    assert.equal(verdict.evidenceUnavailable, true);
  });

  test('sin filas históricas: empresa nueva', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
    assert.equal(verdict.reason, null);
  });
});

// ─── § 17 / § 25 / § 26 · guardas ESTRUCTURALES de ámbito ────────────────────

describe('§ 17 / § 25 / § 26 · el ámbito histórico es global y ACOTADO', () => {
  const noveltySource = readFileSync(join(TOOLKIT_DIR, 'novelty-checker.ts'), 'utf8');
  // Sólo el CUERPO de la función, sin la documentación del evaluador que la
  // sigue: una guarda que leyera prosa se rompería al reescribir un comentario.
  const indexBody = noveltySource.slice(
    noveltySource.indexOf('export async function buildNoveltyIndex'),
    noveltySource.indexOf('// ─── evaluateCandidateNovelty'),
  );

  test('MUTACIÓN C · la lectura histórica NO filtra por source', () => {
    assert.ok(indexBody.length > 0, 'buildNoveltyIndex debe ser localizable');
    assert.equal(
      /\.eq\(\s*['"]source['"]/.test(indexBody),
      false,
      'un filtro de source haría invisibles las entregas de las rutas gratuitas',
    );
    assert.equal(
      indexBody.includes('agent_1'),
      false,
      'la etiqueta del LOTE no es la autoridad de ámbito: la fila lo es',
    );
  });

  test('MUTACIÓN J · la consulta está ACOTADA por los dominios candidatos', () => {
    assert.ok(
      /\.in\(\s*['"]domain['"]\s*,\s*normalizedDomains\s*\)/.test(indexBody),
      'la permanencia se consulta por identidades fuertes, no escaneando el historial',
    );
    assert.equal(
      /\.limit\(/.test(indexBody),
      false,
      '§ 26 · un tope de filas no puede ser la autoridad de permanencia',
    );
    assert.ok(
      indexBody.includes('if (normalizedDomains.length === 0) return index;'),
      'sin dominios NO se consulta nada',
    );
  });

  test('MUTACIÓN B · la lectura histórica NO tiene ventana temporal', () => {
    // Filtros de rango y aritmética de fechas: cualquiera de los dos volvería a
    // convertir la memoria PERMANENTE en una ventana de N días.
    for (const timeFilter of ['.gte(', '.lte(', '.gt(', '.lt(', 'setDate(', 'Date.now(']) {
      assert.equal(
        indexBody.includes(timeFilter),
        false,
        `«${timeFilter}» convertiría la memoria permanente en una ventana`,
      );
    }
    assert.equal(
      /created_at|reviewed_at|updated_at/.test(
        indexBody.slice(indexBody.indexOf('.in('), indexBody.indexOf('const { data')),
      ),
      false,
      'ninguna fecha puede acotar la lectura histórica',
    );
  });

  test('las columnas de procedencia viajan en el MISMO select (0 consultas nuevas)', () => {
    assert.ok(indexBody.includes('source_primary'), 'source_primary debe estar en el select');
    assert.ok(indexBody.includes('review_notes'), 'review_notes debe estar en el select');
    assert.equal(
      (indexBody.match(/\.from\(/g) ?? []).length,
      1,
      'una sola consulta: la procedencia no abre una segunda lectura',
    );
  });

  test('el conjunto de procedencias no-entrega tiene UNA sola definición', () => {
    const dnm = readFileSync(join(TOOLKIT_DIR, 'discovery-negative-memory.ts'), 'utf8');
    assert.ok(
      dnm.includes("from './apollo-prepaid-historical-parity'"),
      'la memoria negativa importa la autoridad, no mantiene una copia',
    );
    assert.equal(
      /const\s+NON_DELIVERY_RECORD_ORIGINS/.test(dnm),
      false,
      'dos listas del mismo concepto habrían divergido',
    );
  });
});
