/**
 * Tests — evaluateApolloSectorRelevanceForPaidOperation
 * (apollo-sector-relevance-gate.ts, A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The DISPLAY gate lets an unmapped sector pass everything through, so a missing
 * mapping never silently empties a batch. That passthrough is correct there and
 * must NOT hold before a PAID call: "we have no mapping, enrich everything"
 * turns a configuration gap into real spend.
 *
 * A. The display gate keeps its passthrough (regression guard)
 * B. The paid evaluation fails closed on an unmapped sector
 * C. Evidence that contradicts vs no evidence at all
 * D. New mappings: Retail y Consumo (broad) and Supermercados (strict)
 * E. Subindustry precedence
 * F. Evidence-field reporting
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyApolloSectorRelevanceGate,
  evaluateApolloSectorRelevanceForPaidOperation,
} from '../apollo-sector-relevance-gate';
import type { WebSearchResult } from '../types';

function candidate(overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  return {
    title: 'Acme SAS',
    url: 'https://acme.com',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {},
    ...overrides,
  };
}

// ── A. Display gate regression ────────────────────────────────────────────────

describe('A — the display gate still passes an unmapped sector through', () => {
  it('A1: an unmapped sector does not empty the batch', () => {
    const results = [candidate(), candidate({ title: 'Beta SAS' })];
    const gate = applyApolloSectorRelevanceGate(
      results,
      'Sector Sin Mapping',
      'apollo_organizations',
    );
    assert.equal(gate.passed.length, 2);
    assert.equal(gate.metadata.sector_mapped, false);
  });

  it('A2: the two gates deliberately disagree on an unmapped sector', () => {
    const result = candidate();
    const display = applyApolloSectorRelevanceGate(
      [result],
      'Sector Sin Mapping',
      'apollo_organizations',
    );
    const paid = evaluateApolloSectorRelevanceForPaidOperation(
      result,
      'Sector Sin Mapping',
    );
    assert.equal(display.passed.length, 1, 'display: shown');
    assert.equal(paid.decision, 'sector_not_mapped', 'paid: never charged');
  });
});

// ── B. Fail-closed on unmapped ────────────────────────────────────────────────

describe('B — unmapped sectors never authorise spend', () => {
  it('B1: an unknown sector is sector_not_mapped', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(candidate(), 'Minería');
    assert.equal(result.decision, 'sector_not_mapped');
    assert.deepEqual(result.matchedTerms, []);
  });

  it('B2: null, undefined and blank sectors are all unmapped', () => {
    for (const sector of [null, undefined, '', '   ']) {
      assert.equal(
        evaluateApolloSectorRelevanceForPaidOperation(candidate(), sector).decision,
        'sector_not_mapped',
        `sector=${JSON.stringify(sector)}`,
      );
    }
  });

  it('B3: an unmapped sector reports no matched term even if the text is rich', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: 'supermercados', keywords: ['grocery'] } }),
      'Sector Inexistente',
    );
    assert.equal(result.decision, 'sector_not_mapped');
    assert.deepEqual(result.matchedTerms, []);
  });
});

// ── C. Contradiction vs absence ───────────────────────────────────────────────

describe('C — contradicting evidence rejects; absent evidence does not', () => {
  it('C1: a company Apollo describes as banking is unverified for supermarkets', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ title: 'Citigroup', metadata: { industry: 'banking' } }),
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'sector_relevance_unverified');
    assert.deepEqual(result.sectorEvidenceFields, ['industry']);
  });

  it('C2: a company with no sector fields at all is indeterminate, not rejected', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ title: 'Comercial Andina SAS' }),
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'sector_relevance_indeterminate');
    assert.deepEqual(result.sectorEvidenceFields, []);
  });

  it('C3: a name alone is not sector evidence', () => {
    // Reading a company name as a sector claim would reject every candidate
    // whose name is not self-describing.
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ title: 'Inversiones Delta', snippet: 'Empresa colombiana' }),
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'sector_relevance_indeterminate');
  });

  it('C4: enriched profile fields count as evidence', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({
        metadata: { apollo_profile: { industry: 'investment banking' } },
      }),
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'sector_relevance_unverified');
    assert.deepEqual(result.sectorEvidenceFields, ['apollo_profile.industry']);
  });

  it('C5: an empty string or empty array is not evidence', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: '   ', keywords: [], short_description: '' } }),
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'sector_relevance_indeterminate');
    assert.deepEqual(result.sectorEvidenceFields, []);
  });
});

// ── D. New mappings ───────────────────────────────────────────────────────────

describe('D — Retail y Consumo (broad) and Supermercados (strict)', () => {
  it('D1: Retail y Consumo matches broad retail signals', () => {
    for (const industry of ['retail', 'comercio minorista', 'consumer goods', 'grocery']) {
      const result = evaluateApolloSectorRelevanceForPaidOperation(
        candidate({ metadata: { industry } }),
        'Retail y Consumo',
      );
      assert.equal(result.decision, 'relevant', industry);
      assert.ok(result.matchedTerms.length > 0, industry);
    }
  });

  it('D2: Supermercados matches supermarket and grocery operators', () => {
    for (const industry of [
      'supermercados',
      'hipermercado',
      'supermarket',
      'grocery retail',
      'autoservicio',
      'tienda de descuento',
    ]) {
      const result = evaluateApolloSectorRelevanceForPaidOperation(
        candidate({ metadata: { industry } }),
        'Supermercados e Hipermercados',
      );
      assert.equal(result.decision, 'relevant', industry);
    }
  });

  it('D3: Supermercados excludes generic retail — the Citigroup failure mode', () => {
    // A diversified conglomerate with "a retail line" must not qualify as a
    // supermarket operator; that is how a bank ended up in an Educación search.
    for (const industry of ['retail', 'comercio', 'consumer goods', 'e-commerce']) {
      const strict = evaluateApolloSectorRelevanceForPaidOperation(
        candidate({ metadata: { industry } }),
        'Supermercados e Hipermercados',
      );
      assert.notEqual(strict.decision, 'relevant', industry);
    }
  });

  it('D4: the broad sector accepts what the strict subindustry rejects', () => {
    const result = candidate({ metadata: { industry: 'comercio minorista' } });
    assert.equal(
      evaluateApolloSectorRelevanceForPaidOperation(result, 'Retail y Consumo').decision,
      'relevant',
    );
    assert.equal(
      evaluateApolloSectorRelevanceForPaidOperation(
        result,
        'Supermercados e Hipermercados',
      ).decision,
      'sector_relevance_unverified',
    );
  });

  it('D5: sector names match regardless of accents and casing', () => {
    const result = candidate({ metadata: { industry: 'supermercados' } });
    for (const sector of ['Supermercados e Hipermercados', 'supermercados e hipermercados']) {
      assert.equal(
        evaluateApolloSectorRelevanceForPaidOperation(result, sector).decision,
        'relevant',
        sector,
      );
    }
  });
});

// ── E. Subindustry precedence ─────────────────────────────────────────────────

describe('E — subindustry signals take precedence over the parent sector', () => {
  it('E1: a mapped subindustry is used and reported', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: 'supermercados' } }),
      'Retail y Consumo',
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'relevant');
    assert.equal(result.subindustrySignalUsed, true);
  });

  it('E2: the strict subindustry overrides a permissive parent', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: 'retail' } }),
      'Retail y Consumo',
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'sector_relevance_unverified');
    assert.equal(result.subindustrySignalUsed, true);
  });

  it('E3: an unmapped subindustry falls back to the parent sector', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: 'retail' } }),
      'Retail y Consumo',
      'Subindustria Sin Mapping',
    );
    assert.equal(result.decision, 'relevant');
    assert.equal(result.subindustrySignalUsed, false);
  });

  it('E4: a null subindustry uses the parent sector', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: 'retail' } }),
      'Retail y Consumo',
      null,
    );
    assert.equal(result.decision, 'relevant');
    assert.equal(result.subindustrySignalUsed, false);
  });

  it('E5: an unmapped parent with an unmapped subindustry stays unmapped', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: 'retail' } }),
      'Sector X',
      'Subindustria Y',
    );
    assert.equal(result.decision, 'sector_not_mapped');
  });
});

// ── F. Evidence-field reporting ───────────────────────────────────────────────

describe('F — evidence-field reporting', () => {
  it('F1: reports each sector-bearing field the provider supplied', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({
        metadata: {
          industry: 'banking',
          keywords: ['finance'],
          short_description: 'A bank',
          apollo_profile: { industries: ['banking'], keywords: ['loans'] },
        },
      }),
      'Supermercados e Hipermercados',
    );
    assert.deepEqual(result.sectorEvidenceFields, [
      'industry',
      'keywords',
      'short_description',
      'apollo_profile.industries',
      'apollo_profile.keywords',
    ]);
  });

  it('F2: title, snippet and domain are never counted as sector evidence', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({
        title: 'Banco Nacional',
        snippet: 'Servicios financieros',
        metadata: { domain: 'banco.com.co' },
      }),
      'Supermercados e Hipermercados',
    );
    assert.deepEqual(result.sectorEvidenceFields, []);
    assert.equal(result.decision, 'sector_relevance_indeterminate');
  });

  it('F3: evidence fields are reported for every decision, including relevant', () => {
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      candidate({ metadata: { industry: 'supermercados' } }),
      'Supermercados e Hipermercados',
    );
    assert.equal(result.decision, 'relevant');
    assert.deepEqual(result.sectorEvidenceFields, ['industry']);
  });

  it('F4: metadata absent entirely yields no evidence fields', () => {
    const bare: WebSearchResult = {
      title: 'X',
      url: 'https://x.com',
      rank: 1,
      provider: 'apollo_organizations',
    };
    const result = evaluateApolloSectorRelevanceForPaidOperation(
      bare,
      'Supermercados e Hipermercados',
    );
    assert.deepEqual(result.sectorEvidenceFields, []);
    assert.equal(result.decision, 'sector_relevance_indeterminate');
  });

  it('F5: the evaluation does not mutate its input', () => {
    const input = candidate({ metadata: { industry: 'supermercados' } });
    const snapshot = JSON.stringify(input);
    evaluateApolloSectorRelevanceForPaidOperation(input, 'Supermercados e Hipermercados');
    assert.equal(JSON.stringify(input), snapshot);
  });
});
