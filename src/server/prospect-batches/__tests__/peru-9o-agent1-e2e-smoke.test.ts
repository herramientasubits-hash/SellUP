/**
 * Perú.9O — Smoke E2E Agente 1 enrichment Perú
 *
 * Validates that the Agent 1 enrichment pipeline for Peru is wired end-to-end:
 *
 *   candidate (PE, RUC known) → enrichPeruCandidateWithSunatLegalLookup
 *   → pe_sunat_bulk block → mergePeruSunatMetadataIntoAccountMetadata
 *   → account metadata propagation
 *
 * Migo path: SUNAT not_found → isMigoFallbackRequired → enrichPeruCandidateWithMigoLegalLookup
 * → pe_migo_api block coexists alongside pe_sunat_bulk
 *
 * GUARDRAILS — this test NEVER:
 * - Calls SUNAT web API (www2.sunat — no fetch at runtime)
 * - Reads .tmp/sunat-peru/ filesystem
 * - Calls Migo real API (lookupPeruMigoByRuc real call)
 * - Calls Tavily or any LLM
 * - Calls lookupPeruSunatByRuc real Supabase query
 * - Inserts into any Supabase table
 * - Performs discovery
 *
 * All Supabase lookups are replaced by in-memory stubs.
 * RUCs used are real RUCs observed in the SUNAT snapshot during import runs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { enrichPeruCandidateWithSunatLegalLookup } from '../peru-sunat-post-approval-enrichment';
import { mergePeruSunatMetadataIntoAccountMetadata } from '../peru-sunat-metadata-merge';
import { enrichPeruCandidateWithMigoLegalLookup } from '../peru-migo-legal-enrichment';
import { mergePeruMigoMetadataIntoAccountMetadata } from '../peru-migo-metadata-merge';
import { isMigoFallbackRequired } from '../post-approval-nit-enrichment-worker';
import type { PeruSunatLegalLookupResult } from '../../services/peru-sunat-legal-lookup';
import type { PeMigoApiLookupResult } from '../peru-migo-legal-enrichment';

// ── Known RUCs from SUNAT snapshot (observed during import runs) ───────────────

const KNOWN_RUCS = [
  { ruc: '20615264335', legalName: 'ELECTRO INTEC S.A.C.' },
  { ruc: '20612323641', legalName: 'DINOSUR J & M EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA' },
  { ruc: '20605438416', legalName: 'DICOM SOLU S.A.C.' },
] as const;

// ── Stubs ─────────────────────────────────────────────────────────────────────

const STUB_CHECKED_AT = '2026-07-02T00:00:00.000Z';

function makeVerifiedLookupStub(ruc: string, legalName: string) {
  return async (_ruc: string): Promise<PeruSunatLegalLookupResult> => ({
    status: 'verified',
    reason: 'ruc_found_active_habido',
    ruc,
    legalName,
    taxpayerStatus: 'ACTIVO',
    domicileCondition: 'HABIDO',
    ubigeo: '150101',
    department: 'LIMA',
    province: 'LIMA',
    district: 'LIMA',
    isActive: true,
    isHabido: true,
    snapshotPeriod: '2026-06',
    snapshotLoadedAt: STUB_CHECKED_AT,
    checkedAt: STUB_CHECKED_AT,
  });
}

function makeNotFoundLookupStub() {
  return async (ruc: string): Promise<PeruSunatLegalLookupResult> => ({
    status: 'not_found',
    reason: 'ruc_not_found_in_snapshot',
    ruc,
    legalName: null,
    taxpayerStatus: null,
    domicileCondition: null,
    ubigeo: null,
    department: null,
    province: null,
    district: null,
    isActive: null,
    isHabido: null,
    snapshotPeriod: null,
    snapshotLoadedAt: null,
    checkedAt: STUB_CHECKED_AT,
  });
}

function makeMigoFoundStub(ruc: string) {
  return async (_ruc: string): Promise<PeMigoApiLookupResult> => ({
    status: 'found',
    payload: {
      ruc,
      legal_name: 'MIGO FOUND NAME',
      taxpayer_status: 'ACTIVO',
      domicile_condition: 'HABIDO',
      ubigeo: null,
      address: null,
      updated_at_source: null,
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Perú.9O — SUNAT snapshot enrichment with known RUC', () => {
  for (const { ruc, legalName } of KNOWN_RUCS) {
    it(`RUC ${ruc} → pe_sunat_bulk block with verified status`, async () => {
      const result = await enrichPeruCandidateWithSunatLegalLookup(
        {
          candidateId: `smoke-candidate-${ruc}`,
          accountId: `smoke-account-${ruc}`,
          countryCode: 'PE',
          ruc,
          legalName,
        },
        makeVerifiedLookupStub(ruc, legalName),
      );

      assert.strictEqual(result.enriched, true, 'enriched must be true for PE with RUC');
      assert.ok(result.pe_sunat_bulk, 'pe_sunat_bulk block must be present');

      const block = result.pe_sunat_bulk!;
      assert.strictEqual(block.source_key, 'pe_sunat_bulk');
      assert.strictEqual(block.ruc, ruc);
      assert.strictEqual(block.legal_name, legalName);
      assert.strictEqual(block.taxpayer_status, 'ACTIVO');
      assert.strictEqual(block.domicile_condition, 'HABIDO');
      assert.strictEqual(block.is_active, true);
      assert.strictEqual(block.is_habido, true);
      assert.strictEqual(block.legal_validation_status, 'verified');
      assert.strictEqual(block.legal_validation_reason, 'ruc_found_active_habido');

      // Sector invariants — CIIU must NOT be official
      assert.strictEqual(block.sector_source, 'inferred_web_ai', 'sector_source must be inferred_web_ai');
      assert.strictEqual(block.ciiu_status, 'unavailable_for_mvp', 'ciiu_status must be unavailable_for_mvp');
      assert.strictEqual(block.official_ciiu_available, false, 'official_ciiu_available must be false');
      assert.strictEqual(block.human_review_required, true, 'human_review_required must be true');
      assert.strictEqual(block.confidence_label, 'sector_inferred', 'confidence_label must be sector_inferred');
    });
  }
});

describe('Perú.9O — Non-PE candidates are skipped', () => {
  it('CO candidate → enriched=false, pe_sunat_bulk=null', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      { candidateId: 'c1', countryCode: 'CO', ruc: '900123456' },
      makeVerifiedLookupStub('900123456', 'ANY'),
    );
    assert.strictEqual(result.enriched, false);
    assert.strictEqual(result.pe_sunat_bulk, null);
    assert.strictEqual(result.reason, 'not_pe_country');
  });

  it('MX candidate → enriched=false', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      { candidateId: 'c2', countryCode: 'MX', taxId: 'RFC123456XYZ' },
      makeVerifiedLookupStub('RFC123456XYZ', 'ANY'),
    );
    assert.strictEqual(result.enriched, false);
    assert.strictEqual(result.pe_sunat_bulk, null);
  });
});

describe('Perú.9O — Missing RUC case', () => {
  it('PE candidate without RUC → pe_sunat_bulk with missing_ruc', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      { candidateId: 'c3', countryCode: 'PE' },
      makeVerifiedLookupStub('', ''),
    );
    assert.strictEqual(result.enriched, true, 'enriched=true even for missing_ruc (block still created)');
    assert.ok(result.pe_sunat_bulk);
    assert.strictEqual(result.pe_sunat_bulk!.legal_validation_status, 'pending_snapshot_validation');
    assert.strictEqual(result.pe_sunat_bulk!.legal_validation_reason, 'missing_ruc');
    // Sector invariants still enforced
    assert.strictEqual(result.pe_sunat_bulk!.sector_source, 'inferred_web_ai');
    assert.strictEqual(result.pe_sunat_bulk!.official_ciiu_available, false);
  });
});

describe('Perú.9O — candidate → account metadata propagation', () => {
  it('approved PE candidate propagates pe_sunat_bulk to account', async () => {
    const ruc = KNOWN_RUCS[0].ruc;
    const legalName = KNOWN_RUCS[0].legalName;

    const enrichResult = await enrichPeruCandidateWithSunatLegalLookup(
      { candidateId: 'cand-1', accountId: 'acc-1', countryCode: 'PE', ruc, legalName },
      makeVerifiedLookupStub(ruc, legalName),
    );

    assert.ok(enrichResult.pe_sunat_bulk);

    const candidateMeta = { source_enrichment: { pe_sunat_bulk: enrichResult.pe_sunat_bulk } };
    const accountMetaBefore = { name: 'Existing account', some_other_key: 'preserved' };

    // mergePeruSunatMetadataIntoAccountMetadata(accountMetadata, candidateMetadata)
    const mergedAccountMeta = mergePeruSunatMetadataIntoAccountMetadata(
      accountMetaBefore,
      candidateMeta,
    );

    // pe_sunat_bulk propagated
    const enrichment = mergedAccountMeta.source_enrichment as Record<string, unknown>;
    assert.ok(enrichment?.pe_sunat_bulk, 'account must have pe_sunat_bulk after merge');

    const peSunatBlock = enrichment.pe_sunat_bulk as Record<string, unknown>;
    assert.strictEqual(peSunatBlock.ruc, ruc);
    assert.strictEqual(peSunatBlock.legal_validation_status, 'verified');

    // Existing keys preserved — no overwrite
    assert.strictEqual(mergedAccountMeta.name, 'Existing account');
    assert.strictEqual((mergedAccountMeta as Record<string, unknown>).some_other_key, 'preserved');

    // Sector invariants preserved through propagation
    assert.strictEqual(peSunatBlock.sector_source, 'inferred_web_ai');
    assert.strictEqual(peSunatBlock.official_ciiu_available, false);
  });

  it('non-PE candidate metadata does not inject pe_sunat_bulk', () => {
    const candidateMeta = { source_enrichment: { co_rues: { ruc: '900123456' } } };
    const accountMeta = { name: 'CO account' };

    const merged = mergePeruSunatMetadataIntoAccountMetadata(candidateMeta, accountMeta);
    const enrichment = (merged as Record<string, unknown>).source_enrichment as Record<string, unknown> | undefined;
    assert.ok(!enrichment?.pe_sunat_bulk, 'no pe_sunat_bulk should be injected from CO candidate');
  });
});

describe('Perú.9O — Migo fallback/complement (mocked)', () => {
  it('isMigoFallbackRequired: verified → false', () => {
    assert.strictEqual(isMigoFallbackRequired('verified'), false);
  });

  it('isMigoFallbackRequired: not_found → true', () => {
    assert.strictEqual(isMigoFallbackRequired('not_found'), true);
  });

  it('isMigoFallbackRequired: null → true', () => {
    assert.strictEqual(isMigoFallbackRequired(null), true);
  });

  it('SUNAT not_found → Migo fallback adds pe_migo_api without overwriting pe_sunat_bulk', async () => {
    const ruc = KNOWN_RUCS[1].ruc;

    // SUNAT: not found
    const sunatResult = await enrichPeruCandidateWithSunatLegalLookup(
      { candidateId: 'cand-2', accountId: 'acc-2', countryCode: 'PE', ruc },
      makeNotFoundLookupStub(),
    );

    assert.ok(sunatResult.pe_sunat_bulk);
    const sunatStatus = sunatResult.pe_sunat_bulk!.legal_validation_status;

    // Migo fallback triggered
    assert.ok(isMigoFallbackRequired(sunatStatus), 'Migo must be required when SUNAT not found');

    const migoResult = await enrichPeruCandidateWithMigoLegalLookup(
      { candidateId: 'cand-2', accountId: 'acc-2', countryCode: 'PE', ruc },
      makeMigoFoundStub(ruc),
    );

    assert.ok(migoResult.pe_migo_api, 'pe_migo_api block must be produced');
    assert.strictEqual(migoResult.pe_migo_api!.source_key, 'pe_migo_api');

    // Migo must not deliver official CIIU
    assert.strictEqual(
      migoResult.pe_migo_api!.official_ciiu_available,
      false,
      'Migo must not deliver official CIIU',
    );
    // Migo sector_source is 'not_provided_by_migo' — Migo is not an inferred sector source
    assert.strictEqual(
      migoResult.pe_migo_api!.sector_source,
      'not_provided_by_migo',
      'Migo sector_source must be not_provided_by_migo',
    );

    // Merge both into account — coexistence
    const candidateMeta = {
      source_enrichment: {
        pe_sunat_bulk: sunatResult.pe_sunat_bulk,
        pe_migo_api: migoResult.pe_migo_api,
      },
    };
    const accountMeta = {};

    const mergedWithSunat = mergePeruSunatMetadataIntoAccountMetadata(candidateMeta, accountMeta);
    const mergedWithMigo = mergePeruMigoMetadataIntoAccountMetadata(candidateMeta, mergedWithSunat);

    const enrichment = (mergedWithMigo as Record<string, unknown>).source_enrichment as Record<string, unknown>;
    assert.ok(enrichment.pe_sunat_bulk, 'pe_sunat_bulk must remain after Migo merge');
    assert.ok(enrichment.pe_migo_api, 'pe_migo_api must be present alongside pe_sunat_bulk');

    // Neither replaces the other
    const sunatBlock = enrichment.pe_sunat_bulk as Record<string, unknown>;
    const migoBlock = enrichment.pe_migo_api as Record<string, unknown>;
    assert.strictEqual(sunatBlock.source_key, 'pe_sunat_bulk');
    assert.strictEqual(migoBlock.source_key, 'pe_migo_api');
  });

  it('Migo non-PE candidate → pe_migo_api=null', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { candidateId: 'c9', countryCode: 'CO', ruc: '900123456' },
      makeMigoFoundStub('900123456'),
    );
    assert.strictEqual(result.pe_migo_api, null);
    assert.strictEqual(result.enriched, false);
  });
});

describe('Perú.9O — Guardrails: no forbidden runtime calls in enrichment modules', () => {
  it('enrichment source does not contain live fetch calls to SUNAT web', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../peru-sunat-post-approval-enrichment.ts', import.meta.url),
      'utf8',
    );
    // Filter out comment lines (JSDoc/inline) — they may reference the URL as a negative example.
    // We only care that no executable code calls fetch() with the SUNAT URL.
    const executableLines = src
      .split('\n')
      .filter((l) => {
        const trimmed = l.trim();
        return !trimmed.startsWith('*') && !trimmed.startsWith('//');
      })
      .join('\n');
    assert.ok(
      !executableLines.includes("fetch('http://www2.sunat") &&
        !executableLines.includes('fetch("http://www2.sunat'),
      'must not contain live fetch() call to www2.sunat in executable code',
    );
    // Apply same comment filter for the remaining checks
    assert.ok(!executableLines.includes('MIGO_API_KEY'), 'must not reference MIGO_API_KEY in executable code');
    assert.ok(!executableLines.includes('Tavily'), 'must not reference Tavily in executable code');
    assert.ok(!executableLines.includes('padron_reducido_ruc.zip'), 'must not reference ZIP download in executable code');
  });

  it('worker source does not contain live fetch calls to SUNAT web or Tavily', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../post-approval-nit-enrichment-worker.ts', import.meta.url),
      'utf8',
    );
    assert.ok(!src.includes("fetch('http://www2.sunat"), 'no direct SUNAT fetch in worker');
    assert.ok(!src.includes('fetch("http://www2.sunat'), 'no direct SUNAT fetch in worker');
    assert.ok(!src.includes('TavilySearchAPIRetriever'), 'no Tavily in worker');
  });

  it('CIIU official never true in pe_sunat_bulk blocks', async () => {
    for (const { ruc, legalName } of KNOWN_RUCS) {
      const result = await enrichPeruCandidateWithSunatLegalLookup(
        { countryCode: 'PE', ruc, legalName },
        makeVerifiedLookupStub(ruc, legalName),
      );
      assert.strictEqual(
        result.pe_sunat_bulk?.official_ciiu_available,
        false,
        `${ruc}: official_ciiu_available must always be false`,
      );
    }
  });

  it('sector is always inferred_web_ai in pe_sunat_bulk, never official CIIU', async () => {
    for (const { ruc, legalName } of KNOWN_RUCS) {
      const result = await enrichPeruCandidateWithSunatLegalLookup(
        { countryCode: 'PE', ruc, legalName },
        makeVerifiedLookupStub(ruc, legalName),
      );
      assert.strictEqual(
        result.pe_sunat_bulk?.sector_source,
        'inferred_web_ai',
        `${ruc}: sector_source must be inferred_web_ai`,
      );
      assert.notStrictEqual(
        result.pe_sunat_bulk?.confidence_label,
        'official_ciiu',
        `${ruc}: confidence_label must not be official_ciiu`,
      );
    }
  });
});
