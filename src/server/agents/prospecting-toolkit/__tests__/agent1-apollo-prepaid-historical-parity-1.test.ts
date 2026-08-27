/**
 * agent1-apollo-prepaid-historical-parity-1.test.ts
 *
 * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY — el evaluador PURO de historia
 * pre-pago, sus dos políticas separadas y la seguridad de identidad.
 *
 * Cero I/O, cero proveedores, cero créditos: todo son entradas literales.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePrepaidHistoricalDuplicate,
  isDeliveryOccupyingStatus,
  PREPAID_HISTORICAL_STATUS_POLICY,
  PROSPECT_CANDIDATE_DB_STATUSES,
  type HistoricalCandidateRow,
} from '../apollo-prepaid-historical-parity';
import { ACTIVE_CANDIDATE_STATUSES } from '../active-candidate-identity-guard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function row(overrides: Partial<HistoricalCandidateRow> = {}): HistoricalCandidateRow {
  return {
    id: 'cand-1',
    batch_id: 'batch-previa',
    name: 'Empresa X',
    domain: 'empresax.com',
    status: 'approved',
    duplicate_status: 'new_candidate',
    country_code: 'CO',
    ...overrides,
  };
}

const NEEDLE_X = {
  normalizedDomain: 'empresax.com',
  name: 'Empresa X',
  countryCode: 'CO',
};

// ─── § 5 · corrección del conjunto de estados ─────────────────────────────────

describe('§ 5 · los estados son los de la CHECK real, no los inventados', () => {
  test('los siete estados válidos son exactamente los de la migración 040', () => {
    assert.deepEqual([...PROSPECT_CANDIDATE_DB_STATUSES], [
      'generated',
      'normalized',
      'needs_review',
      'approved',
      'discarded',
      'duplicate',
      'converted_to_account',
    ]);
  });

  test('cada estado válido tiene política declarada para AMBAS preguntas', () => {
    for (const status of PROSPECT_CANDIDATE_DB_STATUSES) {
      const policy = PREPAID_HISTORICAL_STATUS_POLICY[status];
      assert.ok(policy, `falta política para ${status}`);
      assert.notEqual(policy.blocksHistoricalRedelivery, undefined);
      assert.notEqual(policy.blocksPrepaymentReenrichment, undefined);
      assert.ok(policy.rationale.length > 0);
    }
  });

  test('§ 6 · re-entrega y re-enriquecimiento NO son la misma política', () => {
    // `discarded` es el caso que lo demuestra: las dos preguntas se delegan al
    // cooldown y ninguna se resuelve con un booleano fijo.
    assert.equal(
      PREPAID_HISTORICAL_STATUS_POLICY.discarded.blocksHistoricalRedelivery,
      'cooldown_governed',
    );
    assert.equal(
      PREPAID_HISTORICAL_STATUS_POLICY.discarded.blocksPrepaymentReenrichment,
      'cooldown_governed',
    );
  });

  test('§ 14 · generated y normalized OCUPAN el lote (son entregas)', () => {
    assert.equal(isDeliveryOccupyingStatus('generated'), true);
    assert.equal(isDeliveryOccupyingStatus('normalized'), true);
  });

  test('§ 13 · converted_to_account ocupa; el inexistente `converted` NO', () => {
    assert.equal(isDeliveryOccupyingStatus('converted_to_account'), true);
    assert.equal(isDeliveryOccupyingStatus('converted'), false);
  });

  test('discarded y duplicate NO ocupan: los gobierna la novedad de entrega', () => {
    assert.equal(isDeliveryOccupyingStatus('discarded'), false);
    assert.equal(isDeliveryOccupyingStatus('duplicate'), false);
  });

  test('§ 5 / MUTACIÓN D · el guard activo usa converted_to_account, no `converted`', () => {
    assert.equal(ACTIVE_CANDIDATE_STATUSES.has('converted_to_account'), true);
    assert.equal(
      ACTIVE_CANDIDATE_STATUSES.has('converted'),
      false,
      '`converted` no existe en prospect_candidates_status_check',
    );
    assert.equal(ACTIVE_CANDIDATE_STATUSES.has('generated'), true);
    assert.equal(ACTIVE_CANDIDATE_STATUSES.has('normalized'), true);
  });

  test('el guard activo NO trata discarded ni duplicate como activos', () => {
    assert.equal(ACTIVE_CANDIDATE_STATUSES.has('discarded'), false);
    assert.equal(ACTIVE_CANDIDATE_STATUSES.has('duplicate'), false);
  });
});

// ─── § 12 / § 13 / § 14 · una entrega histórica bloquea sin importar la edad ──

describe('§ 12 · la edad no rehabilita el gasto', () => {
  test('approved a 45 días: ya conocida, eje dominio', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'approved' })],
      // La autoridad de ENTREGA no lo bloquea (Regla 7/default de novelty).
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.reason, 'historical_delivery_occupies_identity');
    assert.equal(verdict.matchedAxis, 'normalized_domain');
    assert.equal(verdict.matchedStatus, 'approved');
    assert.equal(verdict.matchedCandidateId, 'cand-1');
  });

  test('needs_review fuera de cooldown: ya conocida', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'needs_review' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
  });

  test('§ 13 · converted_to_account: ya conocida', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'converted_to_account' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.matchedStatus, 'converted_to_account');
  });

  test('§ 13 · el estado INEXISTENTE `converted` no bloquea por ocupación', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'converted' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
  });

  test('§ 14 · generated y normalized bloquean', () => {
    for (const status of ['generated', 'normalized']) {
      const verdict = evaluatePrepaidHistoricalDuplicate({
        needle: NEEDLE_X,
        rows: [row({ status })],
        deliveryNoveltyShouldSkip: false,
      });
      assert.equal(verdict.alreadyKnown, true, status);
    }
  });
});

// ─── § 6 / § 15 · discarded: la política de cooldown manda, intacta ───────────

describe('§ 15 · discarded delega íntegramente en la novedad de entrega', () => {
  test('descartado DENTRO de cooldown: la novedad de entrega lo bloquea', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'discarded' })],
      deliveryNoveltyShouldSkip: true,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.reason, 'delivery_novelty_blocks');
  });

  test('descartado FUERA de cooldown: NO se bloquea (política 30/90 d intacta)', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'discarded' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
    assert.equal(verdict.reason, null);
  });

  test('duplicate confirmado llega por la autoridad de novedad (Regla 3)', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'duplicate' })],
      deliveryNoveltyShouldSkip: true,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.reason, 'delivery_novelty_blocks');
  });
});

// ─── § 7 · seguridad de identidad: el nombre NUNCA basta ─────────────────────

describe('§ 7 · nombre solo = evidencia, jamás bloqueo duro', () => {
  // `buildIdentityKey` colapsa «Siesa Enterprise» y «Siesa» a la misma clave: es
  // exactamente el falso positivo que un bloqueo por nombre produciría.
  test('mismo nombre normalizado, dominio DISTINTO: NO se bloquea', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: 'siesa-mexico.com',
        name: 'Siesa Enterprise',
        countryCode: 'CO',
      },
      rows: [row({ domain: 'siesa.com.co', name: 'Siesa', status: 'approved' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false, 'falso positivo por nombre');
    assert.equal(verdict.nameOnlyEvidence, true, 'la coincidencia se DECLARA');
    assert.equal(verdict.matchedAxis, null);
  });

  test('mismo nombre y ambas con identidad fiscal DISTINTA: NO se bloquea', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: null,
        name: 'Siesa Enterprise',
        taxIdentifier: '900.111.111',
        countryCode: 'CO',
      },
      rows: [
        row({
          domain: null,
          name: 'Siesa',
          tax_identifier: '900.222.222',
          status: 'approved',
        }),
      ],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
    assert.equal(verdict.nameOnlyEvidence, true);
  });

  test('sin dominio y sin identidad fiscal: nada que bloquear', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: { normalizedDomain: null, name: 'Empresa X', countryCode: 'CO' },
      rows: [row({ status: 'approved' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
  });
});

// ─── § 8 · el eje FISCAL, reutilizando la autoridad canónica ─────────────────

describe('§ 8 · identidad fiscal canónica como eje fuerte', () => {
  test('misma NIT con representación distinta y sin dominio: ya conocida', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: null,
        name: 'Otro Nombre Comercial',
        taxIdentifier: 'NIT 900.123.456-7',
        countryCode: 'CO',
      },
      rows: [row({ domain: null, name: 'Empresa X', tax_identifier: '900123456' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.matchedAxis, 'fiscal_identity');
  });

  test('lee `tax_id` además de `tax_identifier` (compatibilidad de columnas)', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: null,
        name: 'Otro',
        taxIdentifier: '900123456',
        countryCode: 'CO',
      },
      rows: [row({ domain: null, tax_id: '900123456', tax_identifier: null })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.matchedAxis, 'fiscal_identity');
  });

  test('columnas fiscales en CONFLICTO: fail closed, no aporta eje', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: null,
        name: 'Otro',
        taxIdentifier: '900123456',
        countryCode: 'CO',
      },
      rows: [row({ domain: null, tax_id: '900123456', tax_identifier: '900999999' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
  });

  test('sin país NO hay igualdad fiscal (CUT-3B1 § 8)', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: null,
        name: 'Otro',
        taxIdentifier: '900123456',
        countryCode: null,
      },
      rows: [row({ domain: null, country_code: null, tax_identifier: '900123456' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
  });
});

// ─── § 11 / § 23 · ámbito GLOBAL: lote, request y fuente son irrelevantes ─────

describe('§ 11 / § 23 · ámbito GLOBAL SELLUP', () => {
  test('la fila histórica de OTRO lote y OTRA fuente sigue bloqueando', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [
        row({
          batch_id: 'batch-de-otro-usuario',
          status: 'needs_review',
        }),
      ],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
  });

  test('el dominio se normaliza en los DOS lados antes de comparar', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: { normalizedDomain: 'https://www.empresax.com', name: 'X', countryCode: 'CO' },
      rows: [row({ domain: 'WWW.EmpresaX.com'.toLowerCase(), status: 'approved' })],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, true);
  });
});

// ─── § 21 · evidencia indisponible = fail OPEN, declarado ─────────────────────

describe('§ 21 · una lectura degradada no puede afirmar nada', () => {
  test('evidenceUnavailable no bloquea y queda observable', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [row({ status: 'approved' })],
      deliveryNoveltyShouldSkip: true,
      evidenceUnavailable: true,
    });
    assert.equal(verdict.alreadyKnown, false);
    assert.equal(verdict.evidenceUnavailable, true);
  });

  test('sin filas históricas: candidata nueva', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: NEEDLE_X,
      rows: [],
      deliveryNoveltyShouldSkip: false,
    });
    assert.equal(verdict.alreadyKnown, false);
    assert.equal(verdict.nameOnlyEvidence, false);
  });
});
