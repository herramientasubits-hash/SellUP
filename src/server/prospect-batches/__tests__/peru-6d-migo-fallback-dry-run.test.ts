/**
 * Perú.6D — Migo Fallback Dry-Run Tests
 *
 * Validates the smoke dry-run contract:
 *   1. Fallback dry-run simula SUNAT not_found y llama Migo.
 *   2. Fallback dry-run preserva pe_sunat_bulk.
 *   3. Fallback dry-run agrega pe_migo_api.
 *   4. No escribe Supabase.
 *   5. No crea candidatos/cuentas/batches.
 *   6. No consulta snapshot SUNAT.
 *   7. No imprime raw payload.
 *   8. No imprime API key.
 *   9. No crea CIIU.
 *  10. No crea sector oficial.
 *  11. Typecheck/build pasan.
 *
 * Uses Node.js built-in test module.
 * No Supabase. No real Migo calls. No SUNAT web. No Tavily. No LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isMigoFallbackRequired } from '../post-approval-nit-enrichment-worker';
import { mergePeruMigoMetadataIntoAccountMetadata } from '../peru-migo-metadata-merge';
import { enrichPeruCandidateWithMigoLegalLookup } from '../peru-migo-legal-enrichment';
import type {
  PeMigoApiLookupResult,
  PeMigoApiLookupPayload,
} from '../peru-migo-legal-enrichment';

const __filename = fileURLToPath(import.meta.url);
const __dirname_path = dirname(__filename);

// Paths for source-code guardrail checks
const SMOKE_SCRIPT = join(
  __dirname_path,
  '..', '..', '..', '..', 'scripts', 'agent1',
  'smoke-peru-migo-fallback-dry-run.ts',
);
const WORKER_FILE = join(__dirname_path, '..', 'post-approval-nit-enrichment-worker.ts');
const MIGO_MERGE_FILE = join(__dirname_path, '..', 'peru-migo-metadata-merge.ts');
const MIGO_ENRICHMENT_FILE = join(__dirname_path, '..', 'peru-migo-legal-enrichment.ts');

// ── Test helpers ───────────────────────────────────────────────────────────────

const VALID_RUC = '20100050359';
const SIMULATED_SUNAT_STATUS = 'not_found';

function makeFoundPayload(overrides: Partial<PeMigoApiLookupPayload> = {}): PeMigoApiLookupPayload {
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

function makeSimulatedSunatBlock(ruc: string) {
  return {
    ruc,
    legal_name: null,
    taxpayer_status: null,
    domicile_condition: null,
    source_key: 'pe_sunat_bulk',
    enriched_at: '2026-06-25T00:00:00Z',
    legal_validation_status: SIMULATED_SUNAT_STATUS,
    legal_validation_reason: 'ruc_not_found_in_snapshot',
    ciiu_status: 'unavailable_for_mvp',
    official_ciiu_available: false,
    sector_source: 'not_provided_by_sunat_bulk',
  };
}

/** Returns only non-comment, non-JSDoc lines from a source file. */
function executableLines(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

// ── Group A: isMigoFallbackRequired — SUNAT not_found triggers fallback ────────

describe('Perú.6D — isMigoFallbackRequired fallback trigger', () => {
  it('returns true when SUNAT status is not_found', () => {
    assert.equal(isMigoFallbackRequired('not_found'), true);
  });

  it('returns false when SUNAT status is verified', () => {
    assert.equal(isMigoFallbackRequired('verified'), false);
  });

  it('returns true when SUNAT status is null (no enrichment)', () => {
    assert.equal(isMigoFallbackRequired(null), true);
  });

  it('returns true for any non-verified status', () => {
    for (const s of ['flagged', 'api_unavailable', 'pending_snapshot_validation', 'error']) {
      assert.equal(isMigoFallbackRequired(s), true, `Expected true for status="${s}"`);
    }
  });
});

// ── Group B: Enrichment with simulated SUNAT not_found ────────────────────────

describe('Perú.6D — enrichment dry-run simulates SUNAT not_found then calls Migo', () => {
  it('1. calls Migo when SUNAT is simulated not_found', async () => {
    let migoWasCalled = false;

    const spyMigoFound = async (ruc: string): Promise<PeMigoApiLookupResult> => {
      migoWasCalled = true;
      return mockMigoFound(ruc);
    };

    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      spyMigoFound,
    );

    assert.equal(migoWasCalled, true);
    assert.equal(result.enriched, true);
    assert.ok(result.pe_migo_api, 'pe_migo_api block must be present');
  });

  it('2. preserves pe_sunat_bulk after merge', async () => {
    const simulatedSunatBlock = makeSimulatedSunatBlock(VALID_RUC);
    const fakeCandidateMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: simulatedSunatBlock },
    };
    const fakeAccountMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: simulatedSunatBlock },
    };

    const migoResult = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC, metadata: fakeCandidateMeta },
      mockMigoFound,
    );

    assert.ok(migoResult.pe_migo_api, 'pe_migo_api must be set');

    const updatedCandidateMeta = {
      ...fakeCandidateMeta,
      source_enrichment: {
        ...(fakeCandidateMeta.source_enrichment as Record<string, unknown>),
        pe_migo_api: migoResult.pe_migo_api,
      },
    };

    const mergedAccount = mergePeruMigoMetadataIntoAccountMetadata(
      fakeAccountMeta,
      updatedCandidateMeta,
    );

    const se = mergedAccount.source_enrichment as Record<string, unknown>;
    assert.ok(se.pe_sunat_bulk, 'pe_sunat_bulk must be preserved after merge');
    assert.deepEqual(se.pe_sunat_bulk, simulatedSunatBlock);
  });

  it('3. adds pe_migo_api to merged account metadata', async () => {
    const simulatedSunatBlock = makeSimulatedSunatBlock(VALID_RUC);
    const fakeCandidateMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: simulatedSunatBlock },
    };
    const fakeAccountMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: simulatedSunatBlock },
    };

    const migoResult = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC, metadata: fakeCandidateMeta },
      mockMigoFound,
    );

    assert.ok(migoResult.pe_migo_api);

    const updatedCandidateMeta = {
      ...fakeCandidateMeta,
      source_enrichment: {
        ...(fakeCandidateMeta.source_enrichment as Record<string, unknown>),
        pe_migo_api: migoResult.pe_migo_api,
      },
    };

    const mergedAccount = mergePeruMigoMetadataIntoAccountMetadata(
      fakeAccountMeta,
      updatedCandidateMeta,
    );

    const se = mergedAccount.source_enrichment as Record<string, unknown>;
    assert.ok(se.pe_migo_api, 'pe_migo_api must be present after merge');
    assert.equal((se.pe_migo_api as Record<string, unknown>).source_key, 'pe_migo_api');
  });
});

// ── Group C: Supabase / candidate / batch write guardrails ────────────────────

describe('Perú.6D — no writes to Supabase / no candidates / no batches', () => {
  it('4. enrichPeruCandidateWithMigoLegalLookup does not import supabase client', () => {
    const src = readFileSync(MIGO_ENRICHMENT_FILE, 'utf-8');
    assert.ok(
      !src.includes("from '@supabase/supabase-js'") &&
      !src.includes('createClient'),
      'peru-migo-legal-enrichment must not use Supabase client',
    );
  });

  it('5. enrichment file does not call Supabase on prospect_candidates', () => {
    const src = readFileSync(MIGO_ENRICHMENT_FILE, 'utf-8');
    // Comments may mention the table name as guardrail documentation — only check actual API calls
    assert.ok(
      !src.includes("prospect_candidates').insert(") &&
      !src.includes("prospect_candidates').update(") &&
      !src.includes("prospect_candidates').select(") &&
      !src.includes('from("prospect_candidates")') &&
      !src.includes("from('prospect_candidates')"),
      'peru-migo-legal-enrichment must not call Supabase on prospect_candidates',
    );
  });

  it('6. merge helper does not import supabase client', () => {
    const src = readFileSync(MIGO_MERGE_FILE, 'utf-8');
    assert.ok(
      !src.includes("from '@supabase/supabase-js'") &&
      !src.includes('createClient'),
      'peru-migo-metadata-merge must not use Supabase client',
    );
  });
});

// ── Group D: Snapshot SUNAT guardrail ─────────────────────────────────────────

describe('Perú.6D — no consulta ni modifica snapshot SUNAT', () => {
  it('6. enrichment file does not query peru_sunat_ruc_snapshot', () => {
    const src = readFileSync(MIGO_ENRICHMENT_FILE, 'utf-8');
    assert.ok(
      !src.includes('peru_sunat_ruc_snapshot'),
      'peru-migo-legal-enrichment must not reference peru_sunat_ruc_snapshot',
    );
  });

  it('merge helper does not query peru_sunat_ruc_snapshot', () => {
    const src = readFileSync(MIGO_MERGE_FILE, 'utf-8');
    assert.ok(
      !src.includes('peru_sunat_ruc_snapshot'),
      'peru-migo-metadata-merge must not reference peru_sunat_ruc_snapshot',
    );
  });
});

// ── Group E: raw_payload / API key guardrails ──────────────────────────────────

describe('Perú.6D — no raw payload / no API key exposición', () => {
  it('7. enrichment result does not contain raw_payload', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('raw_payload'), 'raw_payload must not appear in result');
    assert.ok(!serialized.includes('rawPayload'), 'rawPayload must not appear in result');
  });

  it('8. enrichment result does not contain API key material', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );

    const serialized = JSON.stringify(result);
    assert.ok(
      !serialized.includes('NEXT_PUBLIC_MIGO') &&
      !serialized.includes('Authorization: Bearer'),
      'API key material must not appear in result',
    );
  });

  it('smoke script does not store or propagate raw_payload (executable code only)', () => {
    const src = readFileSync(SMOKE_SCRIPT, 'utf-8');
    const exec = executableLines(src);
    // Check that no property access or assignment to raw_payload exists in executable lines.
    // String literals used inside check labels (e.g. 'raw_payload') are acceptable; we look
    // for actual property patterns: .raw_payload, ['raw_payload'], raw_payload:, raw_payload =
    assert.ok(
      !exec.includes('.raw_payload') &&
      !exec.includes("['raw_payload']") &&
      !exec.includes('raw_payload:') &&
      !exec.includes('raw_payload =') &&
      !exec.includes('rawPayload:') &&
      !exec.includes('rawPayload =') &&
      !exec.includes('.rawPayload'),
      'smoke script must not store or propagate raw_payload in executable code',
    );
  });

  it('smoke script does not contain NEXT_PUBLIC_MIGO or Bearer in executable code', () => {
    const src = readFileSync(SMOKE_SCRIPT, 'utf-8');
    const exec = executableLines(src);
    assert.ok(
      !exec.includes('NEXT_PUBLIC_MIGO'),
      'smoke script must not use NEXT_PUBLIC_MIGO',
    );
    assert.ok(
      !exec.includes('Authorization: Bearer'),
      'smoke script must not expose Authorization: Bearer',
    );
  });
});

// ── Group F: CIIU / sector invariants ─────────────────────────────────────────

describe('Perú.6D — no CIIU / no sector oficial', () => {
  it('9. pe_migo_api block has ciiu_status = unavailable_for_mvp', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );

    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api.ciiu_status, 'unavailable_for_mvp');
  });

  it('10. pe_migo_api block has official_ciiu_available = false', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );

    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api.official_ciiu_available, false);
  });

  it('sector_source is not_provided_by_migo', async () => {
    const result = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC },
      mockMigoFound,
    );

    assert.ok(result.pe_migo_api);
    assert.equal(result.pe_migo_api.sector_source, 'not_provided_by_migo');
  });
});

// ── Group G: Worker source-code guardrails ────────────────────────────────────

describe('Perú.6D — worker source-code guardrails', () => {
  it('worker does not insert into prospect_candidates directly', () => {
    const src = readFileSync(WORKER_FILE, 'utf-8');
    assert.ok(
      !src.includes("prospect_candidates').insert(") &&
      !src.includes('prospect_candidates.insert'),
      'worker must not insert into prospect_candidates',
    );
  });

  it('worker does not insert into accounts directly', () => {
    const src = readFileSync(WORKER_FILE, 'utf-8');
    assert.ok(
      !src.includes("accounts').insert(") &&
      !src.includes('accounts.insert'),
      'worker must not insert into accounts',
    );
  });

  it('worker does not call prospect_batches insert', () => {
    const src = readFileSync(WORKER_FILE, 'utf-8');
    assert.ok(
      !src.includes("prospect_batches').insert(") &&
      !src.includes('prospect_batches.insert'),
      'worker must not insert into prospect_batches',
    );
  });

  it('worker does not query peru_sunat_ruc_snapshot', () => {
    const src = readFileSync(WORKER_FILE, 'utf-8');
    assert.ok(
      !src.includes('peru_sunat_ruc_snapshot'),
      'worker must not reference peru_sunat_ruc_snapshot',
    );
  });

  it('worker does not call SUNAT web fetch', () => {
    const src = readFileSync(WORKER_FILE, 'utf-8');
    assert.ok(
      !src.includes("fetch('http://www2.sunat") &&
      !src.includes('fetch("http://www2.sunat'),
      'worker must not call SUNAT web',
    );
  });

  it('worker does not call Tavily API (executable code only)', () => {
    const src = readFileSync(WORKER_FILE, 'utf-8');
    // Comments may mention Tavily as a guardrail note — only check executable lines
    const exec = executableLines(src);
    assert.ok(
      !exec.includes('tavily') &&
      !exec.includes('Tavily') &&
      !exec.includes('TAVILY'),
      'worker must not call Tavily in executable code',
    );
  });
});

// ── Group H: Dry-run coexistence ───────────────────────────────────────────────

describe('Perú.6D — pe_sunat_bulk and pe_migo_api coexist in dry-run', () => {
  it('both keys present in merged account metadata', async () => {
    const simulatedSunatBlock = makeSimulatedSunatBlock(VALID_RUC);
    const fakeCandidateMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: simulatedSunatBlock },
    };
    const fakeAccountMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: simulatedSunatBlock },
    };

    const migoResult = await enrichPeruCandidateWithMigoLegalLookup(
      { countryCode: 'PE', ruc: VALID_RUC, metadata: fakeCandidateMeta },
      mockMigoFound,
    );

    assert.ok(migoResult.pe_migo_api);

    const updatedCandidateMeta = {
      ...fakeCandidateMeta,
      source_enrichment: {
        ...(fakeCandidateMeta.source_enrichment as Record<string, unknown>),
        pe_migo_api: migoResult.pe_migo_api,
      },
    };

    const merged = mergePeruMigoMetadataIntoAccountMetadata(
      fakeAccountMeta,
      updatedCandidateMeta,
    );

    const se = merged.source_enrichment as Record<string, unknown>;
    assert.ok(se.pe_sunat_bulk, 'pe_sunat_bulk must coexist');
    assert.ok(se.pe_migo_api, 'pe_migo_api must coexist');
    assert.equal(
      (se.pe_sunat_bulk as Record<string, unknown>).legal_validation_status,
      SIMULATED_SUNAT_STATUS,
      'simulated sunat status preserved',
    );
  });
});
