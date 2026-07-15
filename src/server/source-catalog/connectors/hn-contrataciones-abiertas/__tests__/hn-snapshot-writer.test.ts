import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runHnSnapshotWriter,
  validateSnapshotRows,
  findInvariantViolations,
  buildHnCoverageSummaryPayload,
} from '../hn-snapshot-writer';
import type { HnOcdsCandidate } from '../hn-ocds-types';
import { mapCandidateToSnapshot } from '../hn-snapshot-mapper';
import type { HnSnapshotRow } from '../hn-snapshot-mapper';
import type { HnSupabaseAdminLike } from '../hn-snapshot-writer';
import { deriveTaxRecordIdentity, validateRecordIdentityKey } from '../../../record-identity';

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

function makeMockAdmin(opts: {
  upsertError?: { message: string };
  coverageError?: { message: string };
} = {}): { admin: HnSupabaseAdminLike; calls: string[] } {
  const calls: string[] = [];
  const admin: HnSupabaseAdminLike = {
    from: (table: string) => ({
      upsert: (_rows: unknown, _opts: unknown) => {
        calls.push(`upsert:${table}`);
        if (table === 'source_company_snapshots' && opts.upsertError) {
          return Promise.resolve({ error: opts.upsertError });
        }
        if (table === 'source_coverage_summaries' && opts.coverageError) {
          return Promise.resolve({ error: opts.coverageError });
        }
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { admin, calls };
}

// ─── Dry-run (comportamiento invariante) ──────────────────────────────────────

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

  it('no crea Supabase admin client en dry-run (sin supabaseAdmin inyectado)', async () => {
    // Si intentara crear el client de env vars, fallaría con error de env missing.
    // El hecho de que no lanza confirma que nunca se intenta crear.
    const result = await runHnSnapshotWriter([makeCandidate()], {
      sourceYear: 2024,
      dryRun: true,
    });
    assert.equal(result.rowsWritten, 0);
  });

  it('rowsPrepared > 0 cuando hay candidatos válidos', async () => {
    const result = await runHnSnapshotWriter(
      [makeCandidate(), makeCandidate({ normalizedRtn: '06019977654321' })],
      { sourceYear: 2024 },
    );
    assert.equal(result.rowsPrepared, 2);
  });

  it('conflictsTarget correcto', async () => {
    const result = await runHnSnapshotWriter([makeCandidate()], { sourceYear: 2024 });
    assert.equal(result.conflictsTarget, 'source_key,country_code,source_year,record_identity_key');
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

  it('unknown_or_person_natural_risk nunca llega como row preparada', async () => {
    const candidates = [
      makeCandidate({ legalEntityHint: 'unknown_or_person_natural_risk', legalEntityReason: null }),
      makeCandidate({ legalEntityHint: 'unknown_or_person_natural_risk', legalEntityReason: null, normalizedRtn: '09099999999998' }),
    ];
    const result = await runHnSnapshotWriter(candidates, { sourceYear: 2024 });
    assert.equal(result.rowsPrepared, 0);
    assert.equal(result.excludedNaturalPersonRisk, 2);
  });
});

// ─── Apply branch ─────────────────────────────────────────────────────────────

describe('runHnSnapshotWriter — apply branch', () => {
  it('apply usa source_company_snapshots (tabla correcta)', async () => {
    const { admin, calls } = makeMockAdmin();
    await runHnSnapshotWriter([makeCandidate()], {
      sourceYear: 2024,
      dryRun: false,
      supabaseAdmin: admin,
    });
    assert.ok(calls.includes('upsert:source_company_snapshots'));
  });

  it('apply con 0 candidatos no llama upsert', async () => {
    const { admin, calls } = makeMockAdmin();
    const result = await runHnSnapshotWriter([], {
      sourceYear: 2024,
      dryRun: false,
      supabaseAdmin: admin,
    });
    assert.equal(calls.length, 0);
    assert.equal(result.rowsWritten, 0);
    assert.equal(result.coverageSummaryWritten, false);
  });

  it('apply retorna rowsWritten = rowsPrepared (mock sin error)', async () => {
    const { admin } = makeMockAdmin();
    const result = await runHnSnapshotWriter(
      [makeCandidate(), makeCandidate({ normalizedRtn: '08011977037644' })],
      { sourceYear: 2024, dryRun: false, supabaseAdmin: admin },
    );
    assert.equal(result.rowsWritten, 2);
  });

  it('apply escribe coverage summary cuando rowsWritten > 0', async () => {
    const { admin, calls } = makeMockAdmin();
    const result = await runHnSnapshotWriter([makeCandidate()], {
      sourceYear: 2024,
      dryRun: false,
      supabaseAdmin: admin,
    });
    assert.ok(calls.includes('upsert:source_coverage_summaries'));
    assert.equal(result.coverageSummaryWritten, true);
  });

  it('apply NO escribe coverage summary si upsert snapshots falla', async () => {
    const { admin, calls } = makeMockAdmin({ upsertError: { message: 'db_error' } });
    await assert.rejects(
      () => runHnSnapshotWriter([makeCandidate()], {
        sourceYear: 2024,
        dryRun: false,
        supabaseAdmin: admin,
      }),
    );
    assert.ok(!calls.includes('upsert:source_coverage_summaries'));
  });

  it('invariant violation (RTN 13 dígitos) lanza error y bloquea upsert', async () => {
    // El mapper no valida formato de 14 dígitos — solo rtnValid + normalizedRtn !== null.
    // findInvariantViolations detecta la violación y el writer lanza antes de llamar upsert.
    const { admin, calls } = makeMockAdmin();
    const badCandidate = makeCandidate({ normalizedRtn: '0501997712345' }); // 13 dígitos
    await assert.rejects(
      () => runHnSnapshotWriter([badCandidate], {
        sourceYear: 2024,
        dryRun: false,
        supabaseAdmin: admin,
      }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('invariant_violation'));
        return true;
      },
    );
    // No se llamó upsert
    assert.equal(calls.length, 0);
  });

  it('findInvariantViolations lanza error que bloquea write', async () => {
    // Simulamos fila con source_key incorrecto via findInvariantViolations directo
    const badRow: HnSnapshotRow = {
      source_key: 'cr_sicop' as unknown as typeof import('../hn-snapshot-mapper').HN_SNAPSHOT_SOURCE_KEY,
      country_code: 'HN',
      source_year: 2024,
      tax_id: '05019977123456',
      normalized_tax_id: '05019977123456',
      legal_name: 'Test',
      normalized_legal_name: 'TEST',
      sector: null,
      city: null,
      department: null,
      region: null,
      priority_score: 30,
      signals: { awards_count: 1, tenders_count: 0, contracts_count: 0, total_award_amount: null, latest_date: null },
      financials: {},
      raw_data: {
        source_type: 'procurement_signal',
        tax_identifier_type: 'RTN',
        legal_validation_status: 'not_applicable',
        human_review_required: true,
        post_approval_enabled: false,
        matching_automatic_enabled: false,
        legal_entity_hint: 'likely_legal_entity',
        source: 'ocp_registry_jsonl',
      },
    };
    const violations = findInvariantViolations([badRow]);
    assert.ok(violations.length > 0);
    assert.ok(violations.some((v) => v.includes('source_key')));
  });

  it('conflict target exacto en opciones del writer', async () => {
    const { admin } = makeMockAdmin();
    const result = await runHnSnapshotWriter([makeCandidate()], {
      sourceYear: 2024,
      dryRun: false,
      supabaseAdmin: admin,
    });
    assert.equal(result.conflictsTarget, 'source_key,country_code,source_year,record_identity_key');
  });

  it('coverage summary refleja rowsWritten (no rowsPrepared)', async () => {
    // El mock retorna sin error → rowsWritten = rowsPrepared
    const { admin } = makeMockAdmin();
    const result = await runHnSnapshotWriter(
      [makeCandidate(), makeCandidate({ normalizedRtn: '08011977037644' })],
      { sourceYear: 2024, dryRun: false, supabaseAdmin: admin, linesRead: 1000, uniqueValidRtn: 103 },
    );
    assert.equal(result.rowsWritten, 2);
    assert.equal(result.coverageSummaryWritten, true);
  });

  it('no escribe coverage summary si rowsWritten = 0 (sin candidatos elegibles)', async () => {
    const { admin, calls } = makeMockAdmin();
    const personRiskOnly = [
      makeCandidate({ legalEntityHint: 'unknown_or_person_natural_risk', legalEntityReason: null }),
    ];
    const result = await runHnSnapshotWriter(personRiskOnly, {
      sourceYear: 2024,
      dryRun: false,
      supabaseAdmin: admin,
    });
    assert.equal(result.rowsWritten, 0);
    assert.equal(result.coverageSummaryWritten, false);
    assert.ok(!calls.includes('upsert:source_coverage_summaries'));
  });

  it('no escribe coverage summary en dry-run aunque haya candidatos', async () => {
    const { admin, calls } = makeMockAdmin();
    const result = await runHnSnapshotWriter([makeCandidate()], {
      sourceYear: 2024,
      dryRun: true,
      supabaseAdmin: admin,
    });
    assert.equal(result.coverageSummaryWritten, false);
    assert.equal(calls.length, 0);
  });
});

// ─── Idempotencia ─────────────────────────────────────────────────────────────

describe('runHnSnapshotWriter — idempotencia', () => {
  it('mismo RTN en mismo año usa mismo conflict key (idempotente intra-batch)', async () => {
    const candidates = [
      makeCandidate({ normalizedRtn: '05019977123456' }),
      makeCandidate({ normalizedRtn: '05019977123456', supplierName: 'Empresa Dup' }),
    ];
    const result = await runHnSnapshotWriter(candidates, { sourceYear: 2024 });
    // Solo 1 fila preparada (dedup intra-batch)
    assert.equal(result.rowsPrepared, 1);
  });

  it('mismo conflict key con año diferente genera filas distintas', async () => {
    const { admin } = makeMockAdmin();
    const result2024 = await runHnSnapshotWriter([makeCandidate()], {
      sourceYear: 2024, dryRun: false, supabaseAdmin: admin,
    });
    const result2023 = await runHnSnapshotWriter([makeCandidate()], {
      sourceYear: 2023, dryRun: false, supabaseAdmin: admin,
    });
    // Ambos preparan 1 fila con distinto source_year
    assert.equal(result2024.rowsPrepared, 1);
    assert.equal(result2023.rowsPrepared, 1);
    assert.equal(result2024.sourceYear, 2024);
    assert.equal(result2023.sourceYear, 2023);
  });

  it('unknown_or_person_natural_risk nunca llega al conflict key', async () => {
    const candidates = [
      makeCandidate({ legalEntityHint: 'unknown_or_person_natural_risk', legalEntityReason: null }),
      makeCandidate({ normalizedRtn: '09099999999999', legalEntityHint: 'unknown_or_person_natural_risk', legalEntityReason: null }),
    ];
    const { admin, calls } = makeMockAdmin();
    await runHnSnapshotWriter(candidates, {
      sourceYear: 2024, dryRun: false, supabaseAdmin: admin,
    });
    // 0 filas válidas → no llama upsert
    assert.equal(calls.length, 0);
  });
});

// ─── findInvariantViolations ──────────────────────────────────────────────────

describe('findInvariantViolations', () => {
  function makeValidRow(): HnSnapshotRow {
    return {
      source_key: 'hn_contrataciones_abiertas',
      country_code: 'HN',
      source_year: 2024,
      tax_id: '05019977123456',
      normalized_tax_id: '05019977123456',
      legal_name: 'Test SA',
      normalized_legal_name: 'TEST SA',
      sector: null,
      city: null,
      department: null,
      region: null,
      priority_score: 30,
      signals: { awards_count: 1, tenders_count: 0, contracts_count: 0, total_award_amount: null, latest_date: null },
      financials: {},
      raw_data: {
        source_type: 'procurement_signal',
        tax_identifier_type: 'RTN',
        legal_validation_status: 'not_applicable',
        human_review_required: true,
        post_approval_enabled: false,
        matching_automatic_enabled: false,
        legal_entity_hint: 'likely_legal_entity',
        source: 'ocp_registry_jsonl',
      },
    };
  }

  it('fila válida no tiene violaciones', () => {
    assert.deepEqual(findInvariantViolations([makeValidRow()]), []);
  });

  it('source_key incorrecto detectado', () => {
    const row = { ...makeValidRow(), source_key: 'cr_sicop' as unknown as 'hn_contrataciones_abiertas' };
    const v = findInvariantViolations([row]);
    assert.ok(v.some((s) => s.includes('source_key')));
  });

  it('country_code incorrecto detectado', () => {
    const row = { ...makeValidRow(), country_code: 'CR' as unknown as 'HN' };
    const v = findInvariantViolations([row]);
    assert.ok(v.some((s) => s.includes('country_code')));
  });

  it('normalized_tax_id de 13 dígitos detectado', () => {
    const row = { ...makeValidRow(), normalized_tax_id: '0501997712345' }; // 13 dígitos
    const v = findInvariantViolations([row]);
    assert.ok(v.some((s) => s.includes('normalized_tax_id')));
  });

  it('post_approval_enabled=true detectado', () => {
    const row = { ...makeValidRow(), raw_data: { ...makeValidRow().raw_data, post_approval_enabled: true as unknown as false } };
    const v = findInvariantViolations([row]);
    assert.ok(v.some((s) => s.includes('post_approval_enabled')));
  });

  it('human_review_required=false detectado', () => {
    const row = { ...makeValidRow(), raw_data: { ...makeValidRow().raw_data, human_review_required: false as unknown as true } };
    const v = findInvariantViolations([row]);
    assert.ok(v.some((s) => s.includes('human_review_required')));
  });

  it('legal_entity_hint incorrecto detectado', () => {
    const row = {
      ...makeValidRow(),
      raw_data: { ...makeValidRow().raw_data, legal_entity_hint: 'unknown_or_person_natural_risk' as unknown as 'likely_legal_entity' },
    };
    const v = findInvariantViolations([row]);
    assert.ok(v.some((s) => s.includes('legal_entity_hint')));
  });

  it('array vacío retorna sin violaciones', () => {
    assert.deepEqual(findInvariantViolations([]), []);
  });
});

// ─── buildHnCoverageSummaryPayload ────────────────────────────────────────────

describe('buildHnCoverageSummaryPayload', () => {
  const baseOpts = {
    sourceYear: 2024,
    rowsWritten: 72,
    linesRead: 1000,
    uniqueValidRtn: 103,
    eligibleLegalEntities: 72,
    excludedNaturalPersonRisk: 31,
  };

  it('source_key correcto', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.source_key, 'hn_contrataciones_abiertas');
  });

  it('country_code HN', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.country_code, 'HN');
  });

  it('coverage_status = partial_snapshot', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.coverage_status, 'partial_snapshot');
  });

  it('loaded_rows = rowsWritten (no rowsPrepared)', () => {
    const p = buildHnCoverageSummaryPayload({ ...baseOpts, rowsWritten: 50 });
    assert.equal(p.loaded_rows, 50);
  });

  it('pilot_scope = true', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.coverage_breakdown.pilot_scope, true);
    assert.equal(p.coverage_notes.pilot_scope, true);
  });

  it('post_approval_enabled = false', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.coverage_breakdown.post_approval_enabled, false);
    assert.equal(p.coverage_notes.post_approval_enabled, false);
  });

  it('human_review_required = true', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.coverage_breakdown.human_review_required, true);
    assert.equal(p.coverage_notes.human_review_required, true);
  });

  it('complete_snapshot = false', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.coverage_notes.complete_snapshot, false);
  });

  it('max_apply_lines = 1000', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.coverage_breakdown.max_apply_lines, 1000);
  });

  it('refresh_source correcto', () => {
    const p = buildHnCoverageSummaryPayload(baseOpts);
    assert.equal(p.refresh_source, 'hn_8c4b_pilot_snapshot');
  });
});

// ─── record_identity_key boundary (APP-B P2B) ────────────────────────────────

describe('record_identity_key boundary (APP-B P2B)', () => {
  it('a row with a resolved tax:<normalizedRtn> identity passes validateRecordIdentityKey', () => {
    const result = mapCandidateToSnapshot(makeCandidate(), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const validation = validateRecordIdentityKey(result.row.record_identity_key);
    assert.equal(validation.valid, true);
  });

  it('a row with an unavailable identity (null record_identity_key) fails validateRecordIdentityKey', () => {
    // normalizedRtn no vacío (pasa el filtro rtnValid/normalizedRtn del mapper)
    // pero solo espacios en blanco, por lo que deriveTaxRecordIdentity lo trata
    // como ausente (missing_tax_id) sin excluir la fila.
    const result = mapCandidateToSnapshot(makeCandidate({ normalizedRtn: '   ' }), 2024);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const identity = deriveTaxRecordIdentity('   ');
    assert.equal(identity.status, 'unavailable');

    assert.equal(result.row.record_identity_key, null);
    const validation = validateRecordIdentityKey(result.row.record_identity_key);
    assert.equal(validation.valid, false);
    if (validation.valid) return;
    assert.equal(validation.reason, 'missing_value');
  });

  it('apply reports recordIdentityBoundary with allowedCount = rowsWritten and blockedCount = 0 when every row resolves', async () => {
    // Todo candidato válido para el mapper (rtnValid + normalizedRtn no vacío +
    // likely_legal_entity) también resuelve record_identity_key, porque
    // deriveTaxRecordIdentity solo falla ante un valor vacío/blanco, lo cual
    // findInvariantViolations ya rechaza como normalized_tax_id inválido (no
    // 14 dígitos) antes de llegar a la partición P2B. Este test documenta el
    // caso feliz: la frontera está conectada y no bloquea nada cuando todo
    // el upstream ya es válido.
    const { admin, calls } = makeMockAdmin();
    const candidates = [
      makeCandidate(),
      makeCandidate({ normalizedRtn: '08011977037644' }),
    ];
    const result = await runHnSnapshotWriter(candidates, {
      sourceYear: 2024,
      dryRun: false,
      supabaseAdmin: admin,
    });

    assert.ok(calls.includes('upsert:source_company_snapshots'));
    assert.equal(result.rowsWritten, 2);
    assert.ok(result.recordIdentityBoundary);
    if (!result.recordIdentityBoundary) return;
    assert.equal(result.recordIdentityBoundary.allowedCount, 2);
    assert.equal(result.recordIdentityBoundary.blockedCount, 0);
  });

  it('a whitespace-only normalizedRtn is rejected upstream by findInvariantViolations (normalized_tax_id format), never reaching the P2B boundary', async () => {
    // Documents that this connector's existing 14-digit invariant already
    // guards against the one shape that would make deriveTaxRecordIdentity
    // resolve to "unavailable" for a candidate that otherwise passes the
    // mapper's rtnValid/normalizedRtn/legalEntityHint filter. The P2B
    // boundary is additional, not a replacement for this pre-existing check.
    const { admin, calls } = makeMockAdmin();
    const candidates = [makeCandidate({ normalizedRtn: '   ' })];

    await assert.rejects(
      () => runHnSnapshotWriter(candidates, {
        sourceYear: 2024,
        dryRun: false,
        supabaseAdmin: admin,
      }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('invariant_violation'));
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });

  it('the P2B boundary source is cut over to RECORD_IDENTITY_ON_CONFLICT (APP-D1) and drops the legacy literal', () => {
    const source = readFileSync(
      new URL('../hn-snapshot-writer.ts', import.meta.url),
      'utf-8',
    );
    assert.ok(
      !source.includes(
        "'source_key,country_code,source_year,normalized_tax_id' as const",
      ),
    );
    assert.ok(source.includes('RECORD_IDENTITY_ON_CONFLICT'));
    assert.ok(source.includes('validateRecordIdentityKey'));
  });
});

// ─── validateSnapshotRows (compatibilidad backward) ──────────────────────────

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
