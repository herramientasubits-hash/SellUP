import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runHnSnapshotWriter, validateSnapshotRows } from '../hn-snapshot-writer';
import type { HnOcdsCandidate } from '../hn-ocds-types';

function makeCandidate(overrides: Partial<HnOcdsCandidate> = {}): HnOcdsCandidate {
  return {
    sourceKey: 'hn_contrataciones_abiertas',
    countryCode: 'HN',
    supplierName: 'Inversiones Honduras SA',
    rawRtn: '05019977123456',
    normalizedRtn: '05019977123456',
    rtnValid: true,
    roles: ['supplier'],
    ocids: ['ocds-yyy-001'],
    awardsCount: 2,
    tendersCount: 3,
    contractsCount: 0,
    totalAwardAmount: 80000,
    latestDate: '2024-03-15',
    legalEntityHint: 'likely_legal_entity',
    legalEntityReason: 'INVERSIONES',
    source: 'ocp_registry_jsonl',
    metadata: { rawIdentifierId: '05019977123456' },
    ...overrides,
  };
}

describe('runHnSnapshotWriter — dry-run', () => {
  it('dryRun es true por defecto', async () => {
    const result = await runHnSnapshotWriter([makeCandidate()], { sourceYear: 2024 });
    assert.equal(result.dryRun, true);
  });

  it('rowsWritten = 0 en dry-run', async () => {
    const result = await runHnSnapshotWriter([makeCandidate()], { sourceYear: 2024 });
    assert.equal(result.rowsWritten, 0);
  });

  it('coverageSummaryWritten = false en dry-run', async () => {
    const result = await runHnSnapshotWriter([makeCandidate()], { sourceYear: 2024 });
    assert.equal(result.coverageSummaryWritten, false);
  });

  it('rowsPrepared > 0 cuando hay candidatos válidos', async () => {
    const result = await runHnSnapshotWriter([makeCandidate(), makeCandidate({ normalizedRtn: '06019977654321' })], {
      sourceYear: 2024,
    });
    assert.equal(result.rowsPrepared, 2);
  });

  it('conflictsTarget correcto', async () => {
    const result = await runHnSnapshotWriter([makeCandidate()], { sourceYear: 2024 });
    assert.equal(result.conflictsTarget, 'source_key,country_code,source_year,normalized_tax_id');
  });

  it('excluidos contabilizados', async () => {
    const candidates = [
      makeCandidate(),
      makeCandidate({
        normalizedRtn: '09099999999999',
        legalEntityHint: 'unknown_or_person_natural_risk',
        legalEntityReason: null,
      }),
    ];
    const result = await runHnSnapshotWriter(candidates, { sourceYear: 2024 });
    assert.equal(result.excludedNaturalPersonRisk, 1);
    assert.equal(result.rowsPrepared, 1);
  });

  it('RTN duplicado en batch no genera múltiples rows', async () => {
    const candidates = [
      makeCandidate({ normalizedRtn: '08011977037644', supplierName: 'Empresa A SA' }),
      makeCandidate({ normalizedRtn: '08011977037644', supplierName: 'Empresa A SA dup' }),
    ];
    const result = await runHnSnapshotWriter(candidates, { sourceYear: 2024 });
    assert.equal(result.rowsPrepared, 1);
  });

  it('sourceKey y countryCode correctos en resultado', async () => {
    const result = await runHnSnapshotWriter([makeCandidate()], { sourceYear: 2024 });
    assert.equal(result.sourceKey, 'hn_contrataciones_abiertas');
    assert.equal(result.countryCode, 'HN');
  });

  it('candidatesInput refleja el input', async () => {
    const candidates = [makeCandidate(), makeCandidate({ normalizedRtn: '01234567890123' })];
    const result = await runHnSnapshotWriter(candidates, { sourceYear: 2024 });
    assert.equal(result.candidatesInput, 2);
  });
});

describe('runHnSnapshotWriter — apply bloqueado en 8C.4A', () => {
  it('dryRun=false lanza error apply_not_enabled_in_8c4a', async () => {
    await assert.rejects(
      () => runHnSnapshotWriter([makeCandidate()], { sourceYear: 2024, dryRun: false }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('apply_not_enabled_in_8c4a'));
        return true;
      },
    );
  });
});

describe('validateSnapshotRows', () => {
  it('filas válidas pasan todos los checks', () => {
    const candidates = [makeCandidate()];
    const { mapCandidatesToSnapshot } = require('../hn-snapshot-mapper');
    const { rows } = mapCandidatesToSnapshot(candidates, 2024) as { rows: unknown[] };
    const validation = validateSnapshotRows(rows as Parameters<typeof validateSnapshotRows>[0]);
    assert.equal(validation.allSourceKeyCorrect, true);
    assert.equal(validation.allCountryCodeCorrect, true);
    assert.equal(validation.allNormalizedTaxId14Digits, true);
    assert.equal(validation.allHumanReviewRequired, true);
    assert.equal(validation.allPostApprovalDisabled, true);
    assert.equal(validation.allMatchingDisabled, true);
  });
});
