/**
 * Agente 2A — Contrato PURO de la propagación de la supresión a la colección
 * (AGENT2A-PHONE-REVEAL-4O-E2)
 *
 * Fija el payload y la interpretación del sobre SIN base de datos: qué se manda a
 * la migración 112, y —lo que más importa— que una respuesta que no se entiende
 * NUNCA se convierta en «la propagación se completó». Ese es el fallo que dejaría
 * un número vivo en la colección mientras la DSAR se reporta como éxito.
 *
 * Sin red, sin Supabase, sin proveedores, sin reloj, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidatePhoneCollectionSuppressionParams,
  parseCandidatePhoneCollectionSuppressionEnvelope,
  CANDIDATE_PHONE_SUPPRESSION_SCOPES,
  CANDIDATE_PHONE_SUPPRESSION_STATUSES,
  DSAR_CANDIDATE_PHONE_SUPPRESSION_SCOPE,
  SUPPRESS_CANDIDATE_PHONE_COLLECTION_FN,
  type CandidatePhoneCollectionSuppressionRequest,
} from '../candidate-phone-collection-suppression-core';

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '99999999-9999-4999-8999-999999999999';
const KEY = `e164:${'a'.repeat(64)}`;

const request = (
  overrides: Partial<CandidatePhoneCollectionSuppressionRequest> = {},
): CandidatePhoneCollectionSuppressionRequest => ({
  candidateId: CANDIDATE_ID,
  expectedEnrichmentRunId: RUN_ID,
  scope: 'all_candidate_phones',
  dedupeKey: null,
  reason: 'data_subject_request',
  suppressedBy: 'user-admin-1',
  suppressedAt: '2026-08-10T10:00:00.000Z',
  ...overrides,
});

const envelope = (overrides: Record<string, unknown> = {}) => ({
  status: 'suppressed',
  suppressed_count: 2,
  already_suppressed_count: 0,
  survivor_count: 0,
  primary_dedupe_key: null,
  primary_changed: true,
  candidate_phone_cleared: true,
  candidate_updated: true,
  candidate_settled: true,
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════
// § 11 — alcance
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 11 · alcance', () => {
  it('el flujo DSAR usa `all_candidate_phones`', () => {
    assert.equal(DSAR_CANDIDATE_PHONE_SUPPRESSION_SCOPE, 'all_candidate_phones');
  });

  it('el vocabulario de alcances es cerrado y tiene exactamente dos valores', () => {
    assert.deepEqual([...CANDIDATE_PHONE_SUPPRESSION_SCOPES], [
      'all_candidate_phones',
      'exact_phone',
    ]);
  });

  it('con el alcance amplio la clave viaja SIEMPRE como null', () => {
    // Ensanchar en silencio una petición que PARECE dirigida a un número es la
    // sobre-supresión que hay que hacer imposible. Se normaliza a null aquí y la
    // RPC además la rechaza si llega.
    const params = buildCandidatePhoneCollectionSuppressionParams(
      request({ scope: 'all_candidate_phones', dedupeKey: KEY }),
    );
    assert.equal(params.p_dedupe_key, null);
  });

  it('con `exact_phone` la clave viaja tal cual', () => {
    const params = buildCandidatePhoneCollectionSuppressionParams(
      request({ scope: 'exact_phone', dedupeKey: KEY }),
    );
    assert.equal(params.p_dedupe_key, KEY);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 6 — el payload
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 6 · payload de la RPC', () => {
  it('nombra la función de la migración 112', () => {
    assert.equal(
      SUPPRESS_CANDIDATE_PHONE_COLLECTION_FN,
      'suppress_candidate_phone_collection',
    );
  });

  it('lleva el run que resolvió la cuenta (FIX M2/M3 conservado)', () => {
    const params = buildCandidatePhoneCollectionSuppressionParams(request());
    assert.equal(params.p_expected_enrichment_run_id, RUN_ID);
  });

  it('un run no resoluble viaja como null y NO como una cadena vacía', () => {
    const params = buildCandidatePhoneCollectionSuppressionParams(
      request({ expectedEnrichmentRunId: null }),
    );
    assert.equal(params.p_expected_enrichment_run_id, null);
  });

  it('el payload no contiene NINGÚN número de teléfono', () => {
    const params = buildCandidatePhoneCollectionSuppressionParams(
      request({ scope: 'exact_phone', dedupeKey: KEY }),
    );
    const serialized = JSON.stringify(params);
    // Ni un dígito de teléfono: el payload es ids opacos, un vocabulario cerrado y
    // una fecha. La `dedupe_key` es un SHA-256 por diseño de la 109.
    assert.equal(/\+\d{7,}/.test(serialized), false);
    for (const banned of ['normalized_phone', 'display_phone', 'email', 'linkedin']) {
      assert.equal(serialized.includes(banned), false);
    }
  });

  it('el payload solo tiene las siete claves del contrato', () => {
    const params = buildCandidatePhoneCollectionSuppressionParams(request());
    assert.deepEqual(Object.keys(params).sort(), [
      'p_candidate_id',
      'p_dedupe_key',
      'p_expected_enrichment_run_id',
      'p_scope',
      'p_suppressed_at',
      'p_suppressed_by',
      'p_suppression_reason',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 14 — estados mecánicos e idempotencia
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 14 · estados mecánicos', () => {
  it('el vocabulario de estados es cerrado', () => {
    assert.deepEqual([...CANDIDATE_PHONE_SUPPRESSION_STATUSES], [
      'suppressed',
      'already_suppressed',
      'no_matching_phone_rows',
      'candidate_not_found',
      'invalid_input',
    ]);
  });

  it('`suppressed` se interpreta con sus conteos reales', () => {
    const result = parseCandidatePhoneCollectionSuppressionEnvelope(
      envelope({ suppressed_count: 3, already_suppressed_count: 1, survivor_count: 0 }),
    );
    assert.equal(result.status, 'suppressed');
    assert.equal(result.suppressedCount, 3);
    assert.equal(result.alreadySuppressedCount, 1);
    assert.equal(result.survivorCount, 0);
    assert.equal(result.candidatePhoneCleared, true);
    assert.equal(result.candidateSettled, true);
  });

  it('`already_suppressed` es un estado LIQUIDADO, no un fallo', () => {
    // La repetición de una DSAR no cambia nada y sigue dejando el candidato en el
    // estado pedido: si se tratara como fallo, cada reintento reportaría error.
    const result = parseCandidatePhoneCollectionSuppressionEnvelope(
      envelope({
        status: 'already_suppressed',
        suppressed_count: 0,
        already_suppressed_count: 2,
        candidate_updated: false,
      }),
    );
    assert.equal(result.status, 'already_suppressed');
    assert.equal(result.suppressedCount, 0);
    assert.equal(result.candidateUpdated, false);
    assert.equal(result.candidateSettled, true);
  });

  it('`no_matching_phone_rows` NO cuenta como candidato liquidado', () => {
    const result = parseCandidatePhoneCollectionSuppressionEnvelope(
      envelope({
        status: 'no_matching_phone_rows',
        suppressed_count: 0,
        candidate_updated: false,
        candidate_settled: false,
      }),
    );
    assert.equal(result.candidateSettled, false);
  });

  it('`candidate_not_found` no se puede afirmar como liquidado ni mintiendo', () => {
    // Coherencia forzada: aunque la base dijera `candidate_settled: true`, un
    // candidato no encontrado no quedó en ningún estado.
    const result = parseCandidatePhoneCollectionSuppressionEnvelope(
      envelope({ status: 'candidate_not_found', candidate_settled: true }),
    );
    assert.equal(result.status, 'candidate_not_found');
    assert.equal(result.candidateSettled, false);
  });

  it('`primary_changed` y `survivor_count` se propagan para la auditoría', () => {
    const result = parseCandidatePhoneCollectionSuppressionEnvelope(
      envelope({ survivor_count: 1, primary_changed: true, primary_dedupe_key: KEY }),
    );
    assert.equal(result.survivorCount, 1);
    assert.equal(result.primaryChanged, true);
    assert.equal(result.primaryDedupeKey, KEY);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 14 / § 13 — fail-closed: nada dudoso se cuenta como éxito
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 · fail-closed al interpretar el sobre', () => {
  it('`invalid_input` LANZA y nombra el campo, nunca su valor', () => {
    assert.throws(
      () =>
        parseCandidatePhoneCollectionSuppressionEnvelope({
          status: 'invalid_input',
          detail: 'suppression_reason_unknown',
        }),
      /rejected the payload: suppression_reason_unknown/,
    );
  });

  it('un estado desconocido LANZA en vez de degradarse a éxito', () => {
    assert.throws(
      () =>
        parseCandidatePhoneCollectionSuppressionEnvelope({ status: 'partially_done' }),
      /unknown status/,
    );
  });

  it('un sobre que no es objeto LANZA', () => {
    for (const bad of [null, undefined, 42, 'suppressed', [envelope()]]) {
      assert.throws(
        () => parseCandidatePhoneCollectionSuppressionEnvelope(bad),
        /non-object envelope/,
      );
    }
  });

  it('un sobre sin status LANZA', () => {
    assert.throws(
      () => parseCandidatePhoneCollectionSuppressionEnvelope({ suppressed_count: 2 }),
      /returned no status/,
    );
  });

  it('los conteos ausentes o absurdos se leen como 0, nunca como NaN', () => {
    const result = parseCandidatePhoneCollectionSuppressionEnvelope({
      status: 'suppressed',
      suppressed_count: -3,
      survivor_count: 'many',
    });
    assert.equal(result.suppressedCount, 0);
    assert.equal(result.alreadySuppressedCount, 0);
    assert.equal(result.survivorCount, 0);
  });

  it('las banderas ausentes se leen como false, nunca como truthy', () => {
    const result = parseCandidatePhoneCollectionSuppressionEnvelope({
      status: 'suppressed',
    });
    assert.equal(result.primaryChanged, false);
    assert.equal(result.candidatePhoneCleared, false);
    assert.equal(result.candidateUpdated, false);
    assert.equal(result.candidateSettled, false);
  });

  it('una `primary_dedupe_key` que no es string se lee como null', () => {
    const result = parseCandidatePhoneCollectionSuppressionEnvelope(
      envelope({ primary_dedupe_key: 12345 }),
    );
    assert.equal(result.primaryDedupeKey, null);
  });
});
