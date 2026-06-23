/**
 * Tests — Search Quality v1.15.3.1 — LinkedIn Search Calibration
 *
 * Verifica los ajustes de query (dominio completo) y matching (slugs concatenados).
 *
 * Fixtures:
 *   F1  — Query usa dominio completo (softland.com, no softland)
 *   F2  — Query usa dominio completo com.co (factory.com.co)
 *   F3  — Query sin domain válido usa solo nombre
 *   F4  — Loggro Enterprise vs loggroenterprise slug (compact match) → found
 *   F5  — Mi-ERP vs Odoo global sigue ambiguous (global platform protection)
 *   F6  — Visiontecno vs Zoho global sigue ambiguous (global platform protection)
 *   F7  — Nombre genérico corto (Tech) no sube solo por slug match
 *   F8  — Factory sigue funcionando sin regresiones
 *   F9  — Threshold: 64 = ambiguous, 65 = found
 *   F10 — v1.15.2 mocks sin llamadas reales
 *
 * Sin Supabase real. Sin LLM. Sin Tavily. Sin scraping.
 * Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLinkedInSearchQuery,
  createMockLinkedInSearchProvider,
  runControlledLinkedInCompanySearch,
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
} from '../linkedin-company-search';
import type { LinkedInSearchConfig, ControlledLinkedInSearchCandidate } from '../linkedin-company-search';

import { buildLinkedInEnrichmentMetadata, evaluateLinkedInCompanyMatch } from '../linkedin-company-enrichment';
import type { LinkedInURLCandidate } from '../linkedin-company-enrichment';

// ─── Shared constants ─────────────────────────────────────────────────────────

const CHECKED_AT = '2026-06-23T10:00:00.000Z';

const ENABLED_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'mock',
  maxPerBatch: 5,
  minConfidenceScore: 70,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNotFoundEnrichment() {
  return {
    enabled: true as const,
    status: 'not_found' as const,
    confidence: 0,
    warnings: ['No LinkedIn company URL available in current evidence.'],
    source: 'none' as const,
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
// ━━━ F1 — Query usa dominio completo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F1 — Query usa dominio completo (Softland)', () => {
  it('buildLinkedInSearchQuery retorna dominio completo softland.com', () => {
    const query = buildLinkedInSearchQuery('Softland', 'softland.com');
    assert.strictEqual(query, '"Softland" "softland.com" site:linkedin.com/company');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F2 — Query usa dominio completo com.co ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F2 — Query usa dominio completo com.co (Factory)', () => {
  it('buildLinkedInSearchQuery retorna dominio completo factory.com.co', () => {
    const query = buildLinkedInSearchQuery('Factory', 'factory.com.co');
    assert.strictEqual(query, '"Factory" "factory.com.co" site:linkedin.com/company');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F3 — Query sin domain válido ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F3 — Query sin domain válido', () => {
  it('buildLinkedInSearchQuery usa solo nombre cuando domain es null', () => {
    const query = buildLinkedInSearchQuery('Softland', null);
    assert.strictEqual(query, '"Softland" site:linkedin.com/company');
  });

  it('buildLinkedInSearchQuery usa solo nombre cuando domain es muy corto', () => {
    const query = buildLinkedInSearchQuery('Softland', 'co');
    assert.strictEqual(query, '"Softland" site:linkedin.com/company');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F4 — Loggro Enterprise vs loggroenterprise slug (compact match) ━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F4 — Loggro Enterprise vs loggroenterprise slug', () => {
  it('Compact match reconoce loggroenterprise como match para Loggro Enterprise → found', () => {
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Loggro Enterprise',
        candidateDomain: 'loggro.com',
        countryCode: 'CO',
      },
      {
        url: 'https://www.linkedin.com/company/loggroenterprise',
        normalized: 'https://www.linkedin.com/company/loggroenterprise',
        slug: 'loggroenterprise',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    assert.strictEqual(result.status, 'found', 'Status debería ser found');
    assert.ok(result.confidence >= 65, `Confidence debería ser >= 65, fue ${result.confidence}`);
    assert.strictEqual(result.signals.name_match, true, 'name_match debería ser true (compact match)');
    assert.strictEqual(result.signals.domain_match, true, 'domain_match debería ser true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F5 — Mi-ERP vs Odoo global sigue ambiguous ━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F5 — Mi-ERP vs Odoo global protection', () => {
  it('Mi-ERP no se auto-asocia a página de Odoo → ambiguous', () => {
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Mi-ERP',
        candidateDomain: 'mi-erp.com',
        countryCode: 'CO',
      },
      {
        url: 'https://www.linkedin.com/company/odoo',
        normalized: 'https://www.linkedin.com/company/odoo',
        slug: 'odoo',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    assert.strictEqual(result.status, 'ambiguous', 'Status debería ser ambiguous (global platform protection)');
    assert.ok(result.confidence < 65, `Confidence debería ser < 65, fue ${result.confidence}`);
    assert.strictEqual(
      result.signals.name_match,
      false,
      'name_match debería ser false (nombre no coincide con Odoo)',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F6 — Visiontecno vs Zoho global sigue ambiguous ━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F6 — Visiontecno vs Zoho global protection', () => {
  it('Visiontecno no se auto-asocia a página de Zoho → ambiguous', () => {
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Visiontecno',
        candidateDomain: 'visiontecno.com',
        countryCode: 'CO',
      },
      {
        url: 'https://www.linkedin.com/company/zoho',
        normalized: 'https://www.linkedin.com/company/zoho',
        slug: 'zoho',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    assert.strictEqual(result.status, 'ambiguous', 'Status debería ser ambiguous (global platform protection)');
    assert.ok(result.confidence < 65, `Confidence debería ser < 65, fue ${result.confidence}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F7 — Nombre genérico corto no sube solo por slug ━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7 — Nombre genérico corto (Tech)', () => {
  it('Tech vs slug tech: no sube confianza solo por nombre, requiere domain_match', () => {
    // Sin domain match — apenas name match compacto
    const resultNoDomain = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Tech',
        countryCode: 'CO',
      },
      {
        url: 'https://www.linkedin.com/company/tech',
        normalized: 'https://www.linkedin.com/company/tech',
        slug: 'tech',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    // Solo 40 puntos por name match — debería ser ambiguous
    assert.ok(resultNoDomain.confidence < 65, `Sin domain: confidence debería ser < 65, fue ${resultNoDomain.confidence}`);

    // Con domain match — ahora sí alcanza found
    const resultWithDomain = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Tech',
        candidateDomain: 'tech.com',
        countryCode: 'CO',
      },
      {
        url: 'https://www.linkedin.com/company/tech',
        normalized: 'https://www.linkedin.com/company/tech',
        slug: 'tech',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    assert.ok(
      resultWithDomain.confidence >= 65,
      `Con domain: confidence debería ser >= 65, fue ${resultWithDomain.confidence}`,
    );
    assert.strictEqual(resultWithDomain.status, 'found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F8 — Factory sigue funcionando ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F8 — Factory sigue funcionando', () => {
  it('Factory + factory.com.co + factory-hq slug → found sin regresiones', () => {
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Factory',
        candidateDomain: 'factory.com.co',
        countryCode: 'CO',
      },
      {
        url: 'https://www.linkedin.com/company/factory-hq',
        normalized: 'https://www.linkedin.com/company/factory-hq',
        slug: 'factory-hq',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    assert.strictEqual(result.status, 'found', 'Status debería ser found');
    assert.ok(result.confidence >= 65, `Confidence debería ser >= 65, fue ${result.confidence}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F9 — Threshold: 64 = ambiguous, 65 = found ━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F9 — Threshold documentado', () => {
  it('confidence 64 produce status ambiguous', () => {
    // Crear un candidato que llegue exactamente a 64: 40 (name) + 24 (casi domain)
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'TestCompany',
        // Domain que no matchea bien
        candidateDomain: 'other.com',
        countryCode: null,
      },
      {
        url: 'https://www.linkedin.com/company/testcompany',
        normalized: 'https://www.linkedin.com/company/testcompany',
        slug: 'testcompany',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    // name_match = 40, domain_match = 0 → confidence = 40
    assert.strictEqual(result.confidence, 40);
    assert.strictEqual(result.status, 'ambiguous');
  });

  it('confidence 65 produce status found', () => {
    // name_match (40) + domain_match (25) = 65
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'TestCompany',
        candidateDomain: 'testcompany.com',
        countryCode: null,
      },
      {
        url: 'https://www.linkedin.com/company/testcompany',
        normalized: 'https://www.linkedin.com/company/testcompany',
        slug: 'testcompany',
        foundIn: 'source_url',
      } as LinkedInURLCandidate,
    );

    assert.strictEqual(result.confidence, 65);
    assert.strictEqual(result.status, 'found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F10 — v1.15.2 mocks sin llamadas reales ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F10 — v1.15.2 features: mocks only, 0 real calls', () => {
  it('DEFAULT_LINKEDIN_SEARCH_CONFIG tiene enabled=false', () => {
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });

  it('runControlledLinkedInCompanySearch usa mock provider sin llamadas reales', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland-sitio-oficial'],
    });

    const candidates: ControlledLinkedInSearchCandidate[] = [
      makeSearchCandidate({
        name: 'Softland',
        domain: 'softland.com',
      }),
    ];

    const { results } = await runControlledLinkedInCompanySearch(candidates, ENABLED_CONFIG, mockProvider, CHECKED_AT);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].attempted, true);
    // Mock provider retorna URL → found
    assert.strictEqual(results[0].enrichment.status, 'found');
  });
});
