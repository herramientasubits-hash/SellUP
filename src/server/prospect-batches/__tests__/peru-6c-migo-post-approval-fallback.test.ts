/**
 * Perú.6C — Migo Post-Approval Legal Fallback Tests
 *
 * Tests for:
 *   - isMigoFallbackRequired() policy function
 *   - mergePeruMigoMetadataIntoAccountMetadata() pure helper
 *   - enrichPeruCandidateWithMigoLegalLookup() for country/RUC guards
 *   - Source code guardrails (no raw_payload, no API key, no real calls)
 *
 * Uses Node.js built-in test module.
 * No Supabase connection. No real Migo calls. No real SUNAT calls. No Tavily.
 * lookupFn is always injected — no external calls made.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isMigoFallbackRequired,
} from '../post-approval-nit-enrichment-worker';
import { mergePeruMigoMetadataIntoAccountMetadata } from '../peru-migo-metadata-merge';
import {
  enrichPeruCandidateWithMigoLegalLookup,
} from '../peru-migo-legal-enrichment';
import type {
  PeMigoApiLookupResult,
  PeMigoApiLookupPayload,
} from '../peru-migo-legal-enrichment';

const __filename = fileURLToPath(import.meta.url);
const __dirname_path = dirname(__filename);

// Paths for source-code guardrail checks
const WORKER_FILE = join(__dirname_path, '..', 'post-approval-nit-enrichment-worker.ts');
const MIGO_MERGE_FILE = join(__dirname_path, '..', 'peru-migo-metadata-merge.ts');
const MIGO_ENRICHMENT_FILE = join(
  __dirname_path,
  '..',
  'peru-migo-legal-enrichment.ts',
);

// ── Test helpers ───────────────────────────────────────────────────────────────

const VALID_RUC = '20100050359';

function makeFoundPayload(
  overrides: Partial<PeMigoApiLookupPayload> = {},
): PeMigoApiLookupPayload {
  return {
    ruc: VALID_RUC,
    legal_name: 'A W FABER CASTELL PERUANA S A',
    taxpayer_status: 'ACTIVO',
    domicile_condition: 'HABIDO',
    ubigeo: '150103',
    address: 'AV. PRÓCERES DE LA INDEPENDENCIA 1267',
    updated_at_source: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

const mockMigoFound = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve({ status: 'found', payload: makeFoundPayload() });

const mockMigoNotFound = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve({ status: 'not_found' });

const mockMigoUnavailable = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve({ status: 'api_unavailable', error: 'connection_timeout' });

const spyThrows = (_ruc: string): Promise<PeMigoApiLookupResult> => {
  throw new Error('lookupFn must NOT be called in this scenario');
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PE_MIGO_BLOCK = {
  ruc: VALID_RUC,
  legal_name: 'A W FABER CASTELL PERUANA S A',
  taxpayer_status: 'ACTIVO',
  domicile_condition: 'HABIDO',
  ubigeo: '150103',
  address: 'AV. PRÓCERES DE LA INDEPENDENCIA 1267',
  updated_at_source: '2026-06-01T00:00:00Z',
  source_key: 'pe_migo_api',
  enriched_at: '2026-06-25T00:00:00.000Z',
  legal_validation_status: 'verified',
  legal_validation_reason: 'migo_ruc_found_active',
  ciiu_status: 'unavailable_for_mvp',
  official_ciiu_available: false,
  sector_source: 'not_provided_by_migo',
};

const PE_SUNAT_BLOCK = {
  ruc: VALID_RUC,
  legal_name: 'A W FABER CASTELL PERUANA S A',
  taxpayer_status: 'ACTIVO',
  domicile_condition: 'HABIDO',
  legal_validation_status: 'verified',
  legal_validation_reason: 'ruc_found_active_habido',
  source_key: 'pe_sunat_bulk',
  sector_source: 'inferred_web_ai',
  confidence_label: 'sector_inferred',
  ciiu_status: 'unavailable_for_mvp',
  official_ciiu_available: false,
  human_review_required: true,
  enriched_at: '2026-06-25T00:00:00.000Z',
  ubigeo: '150103',
  is_active: true,
  is_habido: true,
};

// ── Group A: isMigoFallbackRequired policy tests ───────────────────────────────

describe('Perú.6C — isMigoFallbackRequired policy', () => {

  // Test 1: SUNAT verified → no llama Migo
  it('1. SUNAT verified → Migo fallback NOT required', () => {
    assert.equal(
      isMigoFallbackRequired('verified'),
      false,
      'Cuando SUNAT está verified, Migo no debe ser llamado',
    );
  });

  // Test 2: SUNAT not_found + RUC válido → llama Migo
  it('2. SUNAT not_found → Migo fallback required', () => {
    assert.equal(
      isMigoFallbackRequired('not_found'),
      true,
      'Cuando SUNAT retorna not_found, Migo debe ser llamado como fallback',
    );
  });

  // Test 3: SUNAT snapshot_unavailable → llama Migo
  it('3. SUNAT snapshot_unavailable → Migo fallback required', () => {
    assert.equal(
      isMigoFallbackRequired('snapshot_unavailable'),
      true,
      'Cuando SUNAT retorna snapshot_unavailable, Migo debe ser llamado',
    );
  });

  it('3b. SUNAT pending_snapshot_validation → Migo fallback required', () => {
    assert.equal(
      isMigoFallbackRequired('pending_snapshot_validation'),
      true,
    );
  });

  it('3c. SUNAT flagged → Migo fallback required', () => {
    assert.equal(
      isMigoFallbackRequired('flagged'),
      true,
      'flagged = SUNAT encontró pero la empresa tiene problemas — Migo puede complementar',
    );
  });

  it('3d. SUNAT null (no corrió o error) → Migo fallback required', () => {
    assert.equal(
      isMigoFallbackRequired(null),
      true,
      'null indica que SUNAT no corrió — Migo debe intentar',
    );
  });
});

// ── Group B: Country/RUC guard tests via enrichment function ──────────────────

describe('Perú.6C — Country and RUC guards', () => {

  // Test 4: PE + sin RUC → no llama Migo real
  it('4. PE sin RUC → pending_validation, lookupFn NO es llamada', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE' },
      spyThrows,
    );
    assert.equal(result.enriched, true);
    assert.equal(result.reason, 'no_ruc');
    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api!.legal_validation_status, 'pending_validation');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'missing_ruc');
  });

  // Test 5: PE + RUC inválido → invalid_ruc_format, no API call
  it('5. PE con RUC inválido → invalid_ruc_format, lookupFn NO es llamada', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: '99999' },
      spyThrows,
    );
    assert.equal(result.enriched, true);
    assert.equal(result.reason, 'invalid_ruc_format');
    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api!.legal_validation_status, 'invalid_ruc_format');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'invalid_ruc_format');
  });

  // Test 6: CO → no llama Migo
  it('6. CO → enriched=false, pe_migo_api=null, lookupFn NO es llamada', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'CO', ruc: VALID_RUC },
      spyThrows,
    );
    assert.equal(result.enriched, false);
    assert.equal(result.pe_migo_api, null);
    assert.equal(result.reason, 'not_pe_country');
  });

  // Test 7: MX → no llama Migo
  it('7. MX → enriched=false, pe_migo_api=null, lookupFn NO es llamada', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'MX', ruc: VALID_RUC },
      spyThrows,
    );
    assert.equal(result.enriched, false);
    assert.equal(result.pe_migo_api, null);
    assert.equal(result.reason, 'not_pe_country');
  });

  // Test 8: CL → no llama Migo
  it('8. CL → enriched=false, pe_migo_api=null, lookupFn NO es llamada', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'CL', ruc: VALID_RUC },
      spyThrows,
    );
    assert.equal(result.enriched, false);
    assert.equal(result.pe_migo_api, null);
    assert.equal(result.reason, 'not_pe_country');
  });
});

// ── Group C: mergePeruMigoMetadataIntoAccountMetadata helper tests ─────────────

describe('Perú.6C — mergePeruMigoMetadataIntoAccountMetadata', () => {

  // Test 9: pe_migo_api convive con pe_sunat_bulk
  it('9. pe_migo_api convive con pe_sunat_bulk — ambas claves coexisten', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-1',
      source_enrichment: {
        pe_sunat_bulk: PE_SUNAT_BLOCK,
      },
    };
    const candidateMeta: Record<string, unknown> = {
      source_enrichment: {
        pe_migo_api: PE_MIGO_BLOCK,
      },
    };

    const result = mergePeruMigoMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    const se = result.source_enrichment as Record<string, unknown>;
    assert.ok(se.pe_migo_api, 'pe_migo_api debe estar presente');
    assert.ok(se.pe_sunat_bulk, 'pe_sunat_bulk debe seguir presente');
    assert.equal(se.pe_migo_api, PE_MIGO_BLOCK);
    assert.equal(se.pe_sunat_bulk, PE_SUNAT_BLOCK);
  });

  // Test 10: No sobrescribe pe_sunat_bulk
  it('10. No sobrescribe pe_sunat_bulk — merge es aditivo', () => {
    const originalSunatBlock = { ...PE_SUNAT_BLOCK, legal_validation_status: 'verified' };
    const accountMeta: Record<string, unknown> = {
      source_enrichment: {
        pe_sunat_bulk: originalSunatBlock,
      },
    };
    const candidateMeta: Record<string, unknown> = {
      source_enrichment: {
        pe_migo_api: PE_MIGO_BLOCK,
      },
    };

    const result = mergePeruMigoMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    const se = result.source_enrichment as Record<string, unknown>;
    assert.deepEqual(
      se.pe_sunat_bulk,
      originalSunatBlock,
      'pe_sunat_bulk debe estar intacto — merge no lo modifica',
    );
  });

  // Test 11: Si hay converted_account_id, propaga pe_migo_api a cuenta (helper puro)
  it('11. Propaga pe_migo_api a cuenta — helper puro retorna metadata actualizada', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-99',
      hubspot_company_id: 'hs-123',
    };
    const candidateMeta: Record<string, unknown> = {
      source_enrichment: {
        pe_migo_api: PE_MIGO_BLOCK,
      },
    };

    const result = mergePeruMigoMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    const se = result.source_enrichment as Record<string, unknown>;
    assert.equal(se.pe_migo_api, PE_MIGO_BLOCK, 'pe_migo_api debe estar en cuenta');
    assert.equal(
      result.converted_from_candidate_id,
      'cand-99',
      'campo existente preservado',
    );
    assert.equal(
      result.hubspot_company_id,
      'hs-123',
      'hubspot_company_id preservado',
    );
  });

  // Test 12: Preserva metadata existente de cuenta
  it('12. Preserva toda la metadata existente de cuenta — sin pérdida de datos', () => {
    const existingCoBlock = { status: 'matched', source: 'co_personas_juridicas_cc' };
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-2',
      batch_id: 'batch-7',
      approval: { status: 'approved', approved_at: '2026-06-01' },
      source_enrichment: {
        co_personas_juridicas_cc: existingCoBlock,
        co_siis: { status: 'no_match' },
        pe_sunat_bulk: PE_SUNAT_BLOCK,
      },
    };
    const candidateMeta: Record<string, unknown> = {
      source_enrichment: {
        pe_migo_api: PE_MIGO_BLOCK,
      },
    };

    const result = mergePeruMigoMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    // All original fields preserved
    assert.equal(result.converted_from_candidate_id, 'cand-2');
    assert.equal(result.batch_id, 'batch-7');
    assert.deepEqual(result.approval, { status: 'approved', approved_at: '2026-06-01' });

    const se = result.source_enrichment as Record<string, unknown>;
    assert.deepEqual(se.co_personas_juridicas_cc, existingCoBlock);
    assert.deepEqual(se.co_siis, { status: 'no_match' });
    assert.equal(se.pe_sunat_bulk, PE_SUNAT_BLOCK);
    assert.equal(se.pe_migo_api, PE_MIGO_BLOCK);
  });

  it('12b. No-op cuando candidateMetadata no tiene pe_migo_api', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-3',
      source_enrichment: { pe_sunat_bulk: PE_SUNAT_BLOCK },
    };
    const candidateMetaWithoutMigo: Record<string, unknown> = {
      source_enrichment: {},
    };

    const result = mergePeruMigoMetadataIntoAccountMetadata(
      accountMeta,
      candidateMetaWithoutMigo,
    );

    assert.deepEqual(
      result,
      accountMeta,
      'Cuando candidato no tiene pe_migo_api, accountMeta no cambia',
    );
  });

  it('12c. Función es pura — no muta el objeto original', () => {
    const accountMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: PE_SUNAT_BLOCK },
    };
    const candidateMeta: Record<string, unknown> = {
      source_enrichment: { pe_migo_api: PE_MIGO_BLOCK },
    };

    const before = JSON.stringify(accountMeta);
    mergePeruMigoMetadataIntoAccountMetadata(accountMeta, candidateMeta);
    const after = JSON.stringify(accountMeta);

    assert.equal(after, before, 'accountMeta no debe ser mutado');
  });
});

// ── Group D: CIIU / Sector invariants ─────────────────────────────────────────

describe('Perú.6C — CIIU y sector invariants', () => {

  // Test 13: No crea CIIU
  it('13. No crea CIIU — ciiu_status siempre unavailable_for_mvp', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );
    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api!.ciiu_status, 'unavailable_for_mvp');
    assert.equal(result.pe_migo_api!.official_ciiu_available, false);
  });

  // Test 14: No crea sector oficial
  it('14. No crea sector oficial — sector_source siempre not_provided_by_migo', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );
    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api!.sector_source, 'not_provided_by_migo');
  });

  it('14b. Invariants presentes en resultado not_found', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoNotFound,
    );
    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api!.ciiu_status, 'unavailable_for_mvp');
    assert.equal(result.pe_migo_api!.official_ciiu_available, false);
    assert.equal(result.pe_migo_api!.sector_source, 'not_provided_by_migo');
  });

  it('14c. Invariants presentes en resultado api_unavailable', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoUnavailable,
    );
    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api!.ciiu_status, 'unavailable_for_mvp');
    assert.equal(result.pe_migo_api!.official_ciiu_available, false);
    assert.equal(result.pe_migo_api!.sector_source, 'not_provided_by_migo');
  });
});

// ── Group E: Source code guardrails ───────────────────────────────────────────

describe('Perú.6C — Source code guardrails', () => {

  // Test 15: No guarda raw payload
  it('15. No guarda raw_payload — worker y merge no asignan raw_payload como clave', () => {
    const workerSource = readFileSync(WORKER_FILE, 'utf-8');
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');

    const workerRaw = workerSource.match(/raw_payload\s*:/g) ?? [];
    const workerRawUpper = workerSource.match(/rawPayload\s*:/g) ?? [];
    const mergeRaw = mergeSource.match(/raw_payload\s*:/g) ?? [];

    assert.equal(workerRaw.length, 0, 'Worker no debe asignar raw_payload como clave');
    assert.equal(workerRawUpper.length, 0, 'Worker no debe asignar rawPayload como clave');
    assert.equal(mergeRaw.length, 0, 'Merge helper no debe asignar raw_payload como clave');
  });

  // Test 16: No expone API key
  it('16. No expone API key — no hay NEXT_PUBLIC_MIGO ni MIGO_API_KEY= en worker', () => {
    const workerSource = readFileSync(WORKER_FILE, 'utf-8');
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');

    assert.ok(
      !workerSource.includes('NEXT_PUBLIC_MIGO'),
      'Worker no debe referenciar NEXT_PUBLIC_MIGO',
    );
    assert.ok(
      !workerSource.includes('MIGO_API_KEY='),
      'Worker no debe hardcodear MIGO_API_KEY=',
    );
    assert.ok(
      !mergeSource.includes('NEXT_PUBLIC_MIGO'),
      'Merge helper no debe referenciar NEXT_PUBLIC_MIGO',
    );
    assert.ok(
      !mergeSource.includes('MIGO_API_KEY='),
      'Merge helper no debe hardcodear MIGO_API_KEY=',
    );
  });

  // Test 17: No llama Migo real en merge helper (guardrail de archivo)
  it('17. Merge helper no llama Migo real — no contiene fetch()', () => {
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');
    const fetchCalls = mergeSource.match(/\bfetch\s*\(/g) ?? [];
    assert.equal(
      fetchCalls.length,
      0,
      'Merge helper no debe llamar fetch() — es función pura',
    );
  });

  // Test 18: No llama Tavily
  it('18. No llama Tavily — worker y merge no referencian Tavily API', () => {
    const workerSource = readFileSync(WORKER_FILE, 'utf-8');
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');

    const files = [
      { name: 'worker', src: workerSource },
      { name: 'merge', src: mergeSource },
    ];
    for (const { name, src } of files) {
      assert.ok(!src.includes('TAVILY_API'), `${name} no debe usar TAVILY_API`);
      assert.ok(!src.includes('tavilySearch'), `${name} no debe llamar tavilySearch`);
      assert.ok(!src.includes('tavilyClient'), `${name} no debe instanciar tavilyClient`);
    }
  });

  // Test 19: No llama SUNAT web API
  it('19. No llama SUNAT web — no hay fetch www2.sunat ni padron_reducido_ruc', () => {
    const workerSource = readFileSync(WORKER_FILE, 'utf-8');
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');

    for (const src of [workerSource, mergeSource]) {
      assert.ok(!src.includes('www2.sunat'), 'No debe llamar al endpoint SUNAT web');
      assert.ok(
        !src.includes('padron_reducido_ruc.zip'),
        'No debe referenciar padron_reducido_ruc.zip',
      );
    }
  });

  // Test 20: No ejecuta importer
  it('20. No ejecuta importer — no llama import-peru-sunat-snapshot', () => {
    const workerSource = readFileSync(WORKER_FILE, 'utf-8');
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');

    for (const src of [workerSource, mergeSource]) {
      assert.ok(
        !src.includes('import-peru-sunat-snapshot'),
        'No debe importar el importer SUNAT',
      );
      assert.ok(
        !src.includes('importPeruSunatSnapshot'),
        'No debe llamar importPeruSunatSnapshot',
      );
    }
  });

  // Test 21: No crea candidatos/cuentas/batches reales
  it('21. No crea candidatos/cuentas/batches — merge helper no inserta en tablas', () => {
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');
    const enrichSource = readFileSync(MIGO_ENRICHMENT_FILE, 'utf-8');

    for (const [name, src] of [['merge', mergeSource], ['enrichment', enrichSource]]) {
      assert.ok(
        !src.includes("from('prospect_candidates').insert"),
        `${name} no debe insertar en prospect_candidates`,
      );
      assert.ok(
        !src.includes("from('prospect_batches').insert"),
        `${name} no debe insertar en prospect_batches`,
      );
      assert.ok(
        !src.includes("from('accounts').insert"),
        `${name} no debe insertar en accounts`,
      );
    }
  });

  // Test 22: official_ciiu no está en true en ningún archivo
  it('22. No hay official_ciiu: true ni confidence_label: official_ciiu en archivos', () => {
    const workerSource = readFileSync(WORKER_FILE, 'utf-8');
    const mergeSource = readFileSync(MIGO_MERGE_FILE, 'utf-8');
    const enrichSource = readFileSync(MIGO_ENRICHMENT_FILE, 'utf-8');

    for (const [name, src] of [
      ['worker', workerSource],
      ['merge', mergeSource],
      ['enrichment', enrichSource],
    ]) {
      assert.ok(
        !src.includes('official_ciiu: true'),
        `${name} no debe tener official_ciiu: true`,
      );
      assert.ok(
        !src.includes('official_ciiu_available: true'),
        `${name} no debe tener official_ciiu_available: true`,
      );
      assert.ok(
        !src.includes("confidence_label: 'official_ciiu'"),
        `${name} no debe tener confidence_label: 'official_ciiu'`,
      );
    }
  });
});

// ── Group F: Integration — metadata structure ──────────────────────────────────

describe('Perú.6C — Integration: estructura de metadata', () => {

  it('F1. Bloque pe_migo_api contiene campos esperados cuando found', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );

    assert.ok(result.pe_migo_api);
    const block = result.pe_migo_api!;

    assert.equal(block.source_key, 'pe_migo_api');
    assert.ok(typeof block.enriched_at === 'string', 'enriched_at debe ser string');
    assert.equal(block.ruc, VALID_RUC);
    assert.equal(block.legal_name, 'A W FABER CASTELL PERUANA S A');
    assert.equal(block.taxpayer_status, 'ACTIVO');
    assert.equal(block.domicile_condition, 'HABIDO');
    assert.equal(block.ubigeo, '150103');
    assert.ok(block.address, 'address debe estar presente');
    assert.ok(block.updated_at_source, 'updated_at_source debe estar presente');
    assert.equal(block.legal_validation_status, 'verified');
    assert.equal(block.legal_validation_reason, 'migo_ruc_found_active');
    assert.equal(block.ciiu_status, 'unavailable_for_mvp');
    assert.equal(block.official_ciiu_available, false);
    assert.equal(block.sector_source, 'not_provided_by_migo');
  });

  it('F2. SUNAT sigue siendo fuente oficial — pe_sunat_bulk no es modificado por Migo', () => {
    // Simula coexistencia: account ya tiene pe_sunat_bulk verified
    // Migo trae pe_migo_api
    const accountWithSunat: Record<string, unknown> = {
      source_enrichment: {
        pe_sunat_bulk: { ...PE_SUNAT_BLOCK, legal_validation_status: 'verified' },
      },
    };
    const candidateWithMigo: Record<string, unknown> = {
      source_enrichment: {
        pe_migo_api: { ...PE_MIGO_BLOCK, legal_validation_status: 'flagged' },
      },
    };

    const result = mergePeruMigoMetadataIntoAccountMetadata(accountWithSunat, candidateWithMigo);
    const se = result.source_enrichment as Record<string, unknown>;

    // SUNAT status no fue modificado por Migo
    const sunatBlock = se.pe_sunat_bulk as Record<string, unknown>;
    assert.equal(
      sunatBlock.legal_validation_status,
      'verified',
      'SUNAT sigue siendo verified — Migo no altera su estado',
    );

    // Migo está presente como bloque separado
    const migoBlock = se.pe_migo_api as Record<string, unknown>;
    assert.equal(migoBlock.legal_validation_status, 'flagged');
    assert.equal(migoBlock.source_key, 'pe_migo_api');
    assert.equal(sunatBlock.source_key, 'pe_sunat_bulk');
  });
});
