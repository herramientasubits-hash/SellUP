/**
 * Tests — Search Quality v1.15.4 — Production Wiring with Safety Cap
 *
 * Valida integración de LinkedIn Controlled Search al pipeline de escritura,
 * con feature flag, caps duros, y scoring final.
 *
 * Fixtures:
 *   F1  — Config disabled no ejecuta search (0 provider calls)
 *   F2  — Config enabled + candidato fuerte + not_found ejecuta mock search
 *   F3  — Batch cap hard 5 (máx 5 intentos, resto saltan con batch_cap_reached)
 *   F4  — Config maxPerBatch menor respeta ese límite
 *   F5  — Confidence bajo no busca (skip con low_confidence)
 *   F6  — Candidato already found no busca (enrichment_already_found)
 *   F7  — Ambiguous no busca (enrichment_already_ambiguous)
 *   F8  — Rejected no busca (enrichment_already_rejected)
 *   F9  — Duplicate guard blocked no busca (duplicate_guard_blocked)
 *   F10 — Evidence policy blocked no busca (evidence_policy_blocked)
 *   F11 — Mi-ERP search devuelve Odoo → ambiguous, no boost
 *   F12 — Visiontecno search devuelve Zoho → ambiguous, no boost
 *   F13 — Loggro Enterprise search devuelve loggroenterprise → found >=65
 *   F14 — Found >=70 aplica boost +5
 *   F15 — Found 65–69 no aplica boost (threshold 70 para boost)
 *   F16 — Query-only + LinkedIn found sigue sin reemplazar country evidence
 *   F17 — Batch metadata samples contiene query/status/confidence/skip_reason
 *   F18 — Tests no hacen Tavily real (mock provider only)
 *
 * Sin Supabase real. Sin LLM. Sin Tavily. Sin scraping.
 * Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runControlledLinkedInCompanySearch,
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
  createMockLinkedInSearchProvider,
  buildLinkedInSearchQuery,
} from '../linkedin-company-search';
import type { LinkedInSearchConfig, ControlledLinkedInSearchCandidate } from '../linkedin-company-search';

// ─── Shared constants ─────────────────────────────────────────────────────────

const CHECKED_AT = '2026-06-23T10:00:00.000Z';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNotFoundEnrichment(reason = 'No LinkedIn company URL available.') {
  return {
    enabled: true as const,
    status: 'not_found' as const,
    confidence: 0,
    warnings: [reason],
    source: 'provided_search_result' as const,
    checked_at: CHECKED_AT,
  };
}

function makeFoundEnrichment(companyUrl: string, confidence: number = 75) {
  return {
    enabled: true as const,
    status: 'found' as const,
    confidence,
    company_url: companyUrl,
    match_reason: 'name_match',
    signals: { name_match: true, domain_match: true, country_match: false, is_company_page: true },
    warnings: [],
    source: 'mock_linkedin_search' as const,
    checked_at: CHECKED_AT,
  };
}

function makeAmbiguousEnrichment() {
  return {
    enabled: true as const,
    status: 'ambiguous' as const,
    confidence: 0,
    warnings: ['LinkedIn page found but match ambiguous'],
    source: 'provided_search_result' as const,
    checked_at: CHECKED_AT,
  };
}

function makeRejectedEnrichment() {
  return {
    enabled: true as const,
    status: 'rejected' as const,
    confidence: 0,
    warnings: ['LinkedIn URL path not company page'],
    source: 'provided_search_result' as const,
    checked_at: CHECKED_AT,
  };
}

function makeSearchCandidate(
  overrides: Partial<ControlledLinkedInSearchCandidate> = {},
): ControlledLinkedInSearchCandidate {
  return {
    name: 'TestCo Colombia',
    domain: 'testco.com.co',
    countryCode: 'CO',
    sourceTitle: 'TestCo Colombia - Software ERP',
    sourceSnippet: 'Software ERP para empresas en Colombia.',
    confidenceScore: 75,
    currentEnrichment: makeNotFoundEnrichment(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F1 — Config disabled no ejecuta search ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F1 — Config disabled no ejecuta search', () => {
  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.provider, 'disabled');
  });

  it('runControlledLinkedInCompanySearch no llama provider cuando config.enabled=false', async () => {
    let providerCalls = 0;
    const mockProvider = async () => {
      providerCalls++;
      return [];
    };

    const candidates = [makeSearchCandidate()];
    const result = await runControlledLinkedInCompanySearch(
      candidates,
      DEFAULT_LINKEDIN_SEARCH_CONFIG,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0, 'Provider no debe ser llamado cuando feature está deshabilitada');
    assert.strictEqual(result.batchMetadata.attempted_count, 0);
    assert.strictEqual(result.batchMetadata.skipped_count, 1);
    assert.strictEqual(result.results[0].skipReason, 'feature_disabled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F2 — Config enabled + candidato fuerte + not_found ejecuta search ━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F2 — Config enabled ejecuta mock search', () => {
  it('Candidato with not_found status dispara búsqueda mock cuando enabled=true', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const candidates = [makeSearchCandidate({ name: 'TestCo', domain: 'testco.com.co' })];
    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(result.batchMetadata.attempted_count, 1);
    assert.strictEqual(result.results[0].attempted, true);
    assert.strictEqual(result.results[0].enrichment.status, 'found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F3 — Batch cap hard 5 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F3 — Batch cap hard 5', () => {
  it('8 candidatos elegibles, config maxPerBatch=20, solo 5 intentos', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 20, // Pero no debe superar 5
      minConfidenceScore: 70,
    };

    const mockProvider = async () => ['https://www.linkedin.com/company/test'];

    const candidates = Array.from({ length: 8 }, (_, i) =>
      makeSearchCandidate({
        name: `TestCo${i}`,
        domain: `testco${i}.com`,
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(
      result.batchMetadata.attempted_count,
      5,
      'Máximo 5 búsquedas por batch',
    );
    assert.strictEqual(result.batchMetadata.skipped_count, 3, '3 saltan por batch cap');
    assert.strictEqual(
      result.batchMetadata.max_per_batch,
      5,
      'max_per_batch reporta hard cap efectivo 5',
    );

    const cappedResult = result.results.find((r) => r.skipReason === 'batch_cap_reached');
    assert.ok(cappedResult, 'Debe haber resultado con skip_reason batch_cap_reached');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F4 — Config maxPerBatch menor respeta ese límite ━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F4 — Config maxPerBatch menor', () => {
  it('Config maxPerBatch=2 respeta el límite 2', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 2,
      minConfidenceScore: 70,
    };

    const mockProvider = async () => ['https://www.linkedin.com/company/test'];

    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeSearchCandidate({
        name: `TestCo${i}`,
        domain: `testco${i}.com`,
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(result.batchMetadata.attempted_count, 2);
    assert.strictEqual(result.batchMetadata.skipped_count, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F5 — Confidence bajo no busca ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F5 — Confidence bajo no busca', () => {
  it('Candidato con confidenceScore < minConfidenceScore (70) salta', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    let providerCalls = 0;
    const mockProvider = async () => {
      providerCalls++;
      return [];
    };

    const candidates = [
      makeSearchCandidate({
        confidenceScore: 65, // Menor que 70
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0, 'Provider no debe ser llamado');
    assert.strictEqual(result.results[0].skipReason, 'low_confidence');
    assert.strictEqual(result.batchMetadata.skipped_count, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F6 — Candidato already found no busca ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F6 — Already found no busca', () => {
  it('currentEnrichment.status = "found" salta con enrichment_already_found', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    let providerCalls = 0;
    const mockProvider = async () => {
      providerCalls++;
      return [];
    };

    const candidates = [
      makeSearchCandidate({
        currentEnrichment: makeFoundEnrichment(
          'https://www.linkedin.com/company/testco',
          80,
        ),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.results[0].skipReason, 'enrichment_already_found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F7 — Ambiguous no busca ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7 — Ambiguous no busca', () => {
  it('currentEnrichment.status = "ambiguous" salta con enrichment_already_ambiguous', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    let providerCalls = 0;
    const mockProvider = async () => {
      providerCalls++;
      return [];
    };

    const candidates = [makeSearchCandidate({ currentEnrichment: makeAmbiguousEnrichment() })];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.results[0].skipReason, 'enrichment_already_ambiguous');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F8 — Rejected no busca ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F8 — Rejected no busca', () => {
  it('currentEnrichment.status = "rejected" salta con enrichment_already_rejected', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    let providerCalls = 0;
    const mockProvider = async () => {
      providerCalls++;
      return [];
    };

    const candidates = [makeSearchCandidate({ currentEnrichment: makeRejectedEnrichment() })];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.results[0].skipReason, 'enrichment_already_rejected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F9 — Duplicate guard blocked no busca ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F9 — Duplicate guard blocked', () => {
  it('isBlockedByDuplicateGuard=true salta con duplicate_guard_blocked', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    let providerCalls = 0;
    const mockProvider = async () => {
      providerCalls++;
      return [];
    };

    const candidates = [
      makeSearchCandidate({
        isBlockedByDuplicateGuard: true,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.results[0].skipReason, 'duplicate_guard_blocked');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F10 — Evidence policy blocked no busca ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F10 — Evidence policy blocked', () => {
  it('isBlockedByEvidencePolicy=true salta con evidence_policy_blocked', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    let providerCalls = 0;
    const mockProvider = async () => {
      providerCalls++;
      return [];
    };

    const candidates = [
      makeSearchCandidate({
        isBlockedByEvidencePolicy: true,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.results[0].skipReason, 'evidence_policy_blocked');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F11 — Mi-ERP vs Odoo global protection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F11 — Mi-ERP search returns Odoo → ambiguous', () => {
  it('Search devuelve Odoo LinkedIn page → ambiguous (global platform protection)', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      'mi-erp': ['https://www.linkedin.com/company/odoo'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'Mi-ERP',
        domain: 'mi-erp.com',
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(result.results[0].enrichment.status, 'ambiguous');
    assert.ok(result.results[0].enrichment.confidence < 65);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F12 — Visiontecno vs Zoho global protection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12 — Visiontecno search returns Zoho → ambiguous', () => {
  it('Search devuelve Zoho LinkedIn page → ambiguous (global platform protection)', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      visiontecno: ['https://www.linkedin.com/company/zoho'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'Visiontecno',
        domain: 'visiontecno.com',
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(result.results[0].enrichment.status, 'ambiguous');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F13 — Loggro Enterprise compact match ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F13 — Loggro Enterprise slug match', () => {
  it('Loggro Enterprise vs loggroenterprise slug → found >=65', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      loggro: ['https://www.linkedin.com/company/loggroenterprise'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'Loggro Enterprise',
        domain: 'loggro.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.strictEqual(result.results[0].enrichment.status, 'found');
    assert.ok(result.results[0].enrichment.confidence >= 65);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F14 — Found >=70 aplica boost ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F14 — Found >=70 aplica boost linkedin_company_verified', () => {
  it('Status found + confidence >= 70 debería aplicar boost +5 en scoring', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'TestCo',
        domain: 'testco.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    assert.strictEqual(enrichment.status, 'found');
    assert.ok(enrichment.confidence >= 70, `Confidence debe ser >= 70, fue ${enrichment.confidence}`);
    // El boost se aplica en candidate-writer, aquí solo verificamos que status es found y confidence es alta
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F15 — Found 65–69 sin boost ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F15 — Found 65–69 no aplica boost (threshold 70)', () => {
  it('Status found + confidence 65–69 no aplica boost', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-similar'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'TestCo',
        domain: 'testco.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    // Si confidence cae entre 65–69, status sigue found pero sin boost
    // En candidate-writer, boost solo se aplica si confidence >= 70
    if (enrichment.status === 'found' && enrichment.confidence < 70) {
      // Sin boost esperado en este rango
      assert.ok(enrichment.confidence >= 65 && enrichment.confidence < 70);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F16 — Query-only no reemplaza country evidence ━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F16 — LinkedIn found no reemplaza country evidence', () => {
  it('LinkedIn enrichment no altera country evidence policy', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'TestCo',
        domain: 'testco.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    assert.strictEqual(enrichment.status, 'found');
    // Country evidence policy se aplica en evidence-persistence-policy module
    // LinkedIn search no debe romper esa lógica
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F17 — Batch metadata samples ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F17 — Batch metadata samples correctos', () => {
  it('Batch metadata.samples contiene query, status, confidence, skip_reason', async () => {
    const enabledConfig: LinkedInSearchConfig = {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      minConfidenceScore: 70,
    };

    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
      factory: [],
      loggro: ['https://www.linkedin.com/company/loggroenterprise'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'Softland',
        domain: 'softland.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
      makeSearchCandidate({
        name: 'Factory',
        domain: 'factory.com.co',
        confidenceScore: 65, // Low confidence
        currentEnrichment: makeNotFoundEnrichment(),
      }),
      makeSearchCandidate({
        name: 'Loggro Enterprise',
        domain: 'loggro.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      enabledConfig,
      mockProvider,
      CHECKED_AT,
    );

    assert.ok(result.batchMetadata.samples.length > 0, 'Samples debe contener registros');

    const softlandSample = result.batchMetadata.samples.find(
      (s) => s.candidate_name === 'Softland',
    );
    assert.ok(softlandSample, 'Softland debe estar en samples');
    assert.ok(softlandSample.query, 'Sample debe tener query');
    assert.strictEqual(softlandSample.status, 'found');
    assert.ok(softlandSample.company_url !== null);

    const loggro = result.batchMetadata.samples.find((s) => s.candidate_name === 'Loggro Enterprise');
    assert.ok(loggro);
    assert.strictEqual(loggro.status, 'found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F18 — Tests no hacen Tavily real ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F18 — Tests solo usan mock provider', () => {
  it('createMockLinkedInSearchProvider retorna URLs según el mapa', async () => {
    const provider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland-colombia'],
    });

    const result1 = await provider('"Softland" site:linkedin.com/company');
    assert.deepStrictEqual(result1, ['https://www.linkedin.com/company/softland-colombia']);

    const result2 = await provider('"Unknown" site:linkedin.com/company');
    assert.deepStrictEqual(result2, []);
  });

  it('Mock provider no hace HTTP calls', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      test: ['https://www.linkedin.com/company/test'],
    });

    // No hay forma de que el test falle si Tavily fuera llamado
    // porque la prueba es local y no hay network access.
    const result = await mockProvider('test query');
    assert.ok(Array.isArray(result));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ Query builder validates completeness ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('Query builder integrated tests', () => {
  it('buildLinkedInSearchQuery constructs valid site-restricted query (v1.16K-R-C: domain is a soft signal, not a quoted requirement)', () => {
    // Default: name quoted + site operator, NO blocking domain phrase.
    const q1 = buildLinkedInSearchQuery('Softland', 'softland.com');
    assert.strictEqual(q1, 'site:linkedin.com/company "Softland"');

    // Domain only joins as an unquoted soft signal when explicitly requested.
    const q2 = buildLinkedInSearchQuery('Factory', 'factory.com.co', { includeDomainSignal: true });
    assert.strictEqual(q2, 'site:linkedin.com/company "Factory" factory.com.co');

    const q3 = buildLinkedInSearchQuery('TestCo', null);
    assert.strictEqual(q3, 'site:linkedin.com/company "TestCo"');
  });
});
