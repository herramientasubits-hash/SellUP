import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapCandidateToSnapshot,
  mapCandidatesToSnapshot,
  HN_SNAPSHOT_SOURCE_KEY,
  HN_SNAPSHOT_COUNTRY_CODE,
} from '../hn-snapshot-mapper';
import type { HnOcdsCandidate } from '../hn-ocds-types';
import { deriveTaxRecordIdentity } from '../../../record-identity';

function makeCandidate(overrides: Partial<HnOcdsCandidate> = {}): HnOcdsCandidate {
  return {
    sourceKey: 'hn_contrataciones_abiertas',
    countryCode: 'HN',
    supplierName: 'Constructora Honduras SA',
    rawRtn: '08011977037644',
    normalizedRtn: '08011977037644',
    rtnValid: true,
    roles: ['supplier'],
    ocids: ['ocds-xxx-001'],
    awardsCount: 3,
    tendersCount: 5,
    contractsCount: 0,
    totalAwardAmount: 150000,
    latestDate: '2024-06-01',
    legalEntityHint: 'likely_legal_entity',
    legalEntityReason: 'CONSTRUCTORA',
    source: 'ocp_registry_jsonl',
    metadata: { rawIdentifierId: '08011977037644' },
    ...overrides,
  };
}

describe('mapCandidateToSnapshot', () => {
  it('RTN válido + likely_legal_entity → prepara snapshot', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = result.row;
    assert.equal(row.source_key, HN_SNAPSHOT_SOURCE_KEY);
    assert.equal(row.country_code, HN_SNAPSHOT_COUNTRY_CODE);
    assert.equal(row.source_year, 2024);
    assert.equal(row.tax_id, '08011977037644');
    assert.equal(row.normalized_tax_id, '08011977037644');
    assert.equal(row.legal_name, 'Constructora Honduras SA');
    assert.ok(row.normalized_legal_name !== null);
  });

  it('unknown_or_person_natural_risk → excluido', () => {
    const result = mapCandidateToSnapshot(
      makeCandidate({ legalEntityHint: 'unknown_or_person_natural_risk', legalEntityReason: null }),
      2024,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'unknown_or_person_natural_risk');
  });

  it('rtnValid false → excluido (invalid_rtn)', () => {
    const candidate = {
      ...makeCandidate(),
      rtnValid: false as const,
      normalizedRtn: null as unknown as string,
    };
    const result = mapCandidateToSnapshot(candidate as unknown as HnOcdsCandidate, 2024);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'invalid_rtn');
  });

  it('normalizedRtn null → excluido (invalid_rtn)', () => {
    const candidate = makeCandidate({ normalizedRtn: null as unknown as string });
    const result = mapCandidateToSnapshot(candidate, 2024);
    assert.equal(result.ok, false);
  });

  it('source_key es hn_contrataciones_abiertas', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.source_key, 'hn_contrataciones_abiertas');
  });

  it('country_code es HN', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.country_code, 'HN');
  });

  it('source_year correcto', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2023);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.source_year, 2023);
  });

  it('normalized_tax_id tiene 14 dígitos', () => {
    const result = mapCandidateToSnapshot(makeCandidate({ normalizedRtn: '01019999123456' }), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.row.normalized_tax_id, /^\d{14}$/);
  });

  it('legal_name preservado', () => {
    const result = mapCandidateToSnapshot(makeCandidate({ supplierName: 'Grupo Industrial HN SA' }), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.legal_name, 'Grupo Industrial HN SA');
  });

  it('raw_data.source_type = procurement_signal', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.raw_data.source_type, 'procurement_signal');
  });

  it('legal_validation_status = not_applicable', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.raw_data.legal_validation_status, 'not_applicable');
  });

  it('human_review_required = true', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.raw_data.human_review_required, true);
  });

  it('post_approval_enabled = false', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.raw_data.post_approval_enabled, false);
  });

  it('matching_automatic_enabled = false', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.raw_data.matching_automatic_enabled, false);
  });

  it('no contiene phone ni email', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const rowStr = JSON.stringify(result.row);
    assert.ok(!rowStr.includes('"phone"'), 'no debe incluir phone');
    assert.ok(!rowStr.includes('"email"'), 'no debe incluir email');
  });

  it('tax_identifier_type = RTN en raw_data', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.raw_data.tax_identifier_type, 'RTN');
  });

  it('legal_entity_hint = likely_legal_entity en raw_data', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.raw_data.legal_entity_hint, 'likely_legal_entity');
  });
});

describe('mapCandidatesToSnapshot', () => {
  it('deduplica RTN duplicado en el batch', () => {
    const candidates = [
      makeCandidate({ normalizedRtn: '08011977037644', supplierName: 'Empresa A SA' }),
      makeCandidate({ normalizedRtn: '08011977037644', supplierName: 'Empresa A SA (dup)' }),
    ];
    const result = mapCandidatesToSnapshot(candidates, 2024);
    assert.equal(result.rows.length, 1);
    assert.equal(result.eligibleLegalEntities, 2);
  });

  it('contabiliza excluded natural person risk', () => {
    const candidates = [
      makeCandidate(),
      makeCandidate({
        normalizedRtn: '09099999999999',
        legalEntityHint: 'unknown_or_person_natural_risk',
        legalEntityReason: null,
      }),
    ];
    const result = mapCandidatesToSnapshot(candidates, 2024);
    assert.equal(result.excludedNaturalPersonRisk, 1);
    assert.equal(result.rows.length, 1);
  });

  it('batch vacío produce resultado vacío', () => {
    const result = mapCandidatesToSnapshot([], 2024);
    assert.equal(result.rows.length, 0);
    assert.equal(result.eligibleLegalEntities, 0);
    assert.equal(result.excludedNaturalPersonRisk, 0);
    assert.equal(result.invalidRtn, 0);
  });
});

// ─── record_identity_key shadow write (APP-A P2A) ─────────────────────────────
//
// hn-snapshot-writer.ts NO se toca en este hito: en Honduras la construcción
// del payload ocurre en el mapper (mapCandidateToSnapshot), por lo que el
// shadow dual-write vive aquí.

describe('record_identity_key shadow write (APP-A P2A)', () => {
  it('mapCandidateToSnapshot derives record_identity_key = tax:<normalizedRtn>', () => {
    const result = mapCandidateToSnapshot(makeCandidate({ normalizedRtn: '08011977037644' }), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const identity = deriveTaxRecordIdentity('08011977037644');
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;

    assert.equal(result.row.record_identity_key, identity.recordIdentityKey);
    assert.equal(result.row.record_identity_key, 'tax:08011977037644');
  });

  it('record_identity_key tracks the RTN, not the legal name (no name fallback)', () => {
    const result = mapCandidateToSnapshot(
      makeCandidate({ normalizedRtn: '01019999123456', supplierName: 'Grupo Industrial HN SA' }),
      2024,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.record_identity_key, 'tax:01019999123456');
  });

  it('two candidates with the same normalizedRtn produce the same record_identity_key (no row exclusion, no multiplicity change)', () => {
    const resultA = mapCandidateToSnapshot(makeCandidate({ normalizedRtn: '08011977037644' }), 2024);
    const resultB = mapCandidateToSnapshot(
      makeCandidate({ normalizedRtn: '08011977037644', supplierName: 'Otro nombre SA' }),
      2024,
    );
    assert.equal(resultA.ok, true);
    assert.equal(resultB.ok, true);
    if (!resultA.ok || !resultB.ok) return;
    assert.equal(resultA.row.record_identity_key, resultB.row.record_identity_key);
  });

  it('excluded candidates (invalid_rtn / unknown_or_person_natural_risk) never reach record_identity_key derivation — exclusion behavior unchanged', () => {
    const invalidRtn = mapCandidateToSnapshot(
      { ...makeCandidate(), rtnValid: false as const, normalizedRtn: null as unknown as string } as unknown as HnOcdsCandidate,
      2024,
    );
    assert.equal(invalidRtn.ok, false);
    if (invalidRtn.ok) return;
    assert.equal(invalidRtn.reason, 'invalid_rtn');

    const naturalPersonRisk = mapCandidateToSnapshot(
      makeCandidate({ legalEntityHint: 'unknown_or_person_natural_risk', legalEntityReason: null }),
      2024,
    );
    assert.equal(naturalPersonRisk.ok, false);
    if (naturalPersonRisk.ok) return;
    assert.equal(naturalPersonRisk.reason, 'unknown_or_person_natural_risk');
  });

  it('deriveTaxRecordIdentity defensive path: unavailable (null) for a missing/blank tax id — the structural upstream guard is what actually prevents this from reaching mapCandidateToSnapshot in production', () => {
    // mapCandidateToSnapshot itself rejects null/missing normalizedRtn via the invalid_rtn
    // branch before deriveTaxRecordIdentity is ever called, so an "unavailable" identity
    // is not practically fixturable through the mapper's success path. This test verifies
    // the shared helper's defensive behavior directly instead.
    const identity = deriveTaxRecordIdentity(null);
    assert.equal(identity.status, 'unavailable');
    if (identity.status !== 'unavailable') return;
    assert.equal(identity.reason, 'missing_tax_id');
  });
});
