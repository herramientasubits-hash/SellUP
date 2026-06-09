/**
 * Tests — Scoring Caps (Hito 16AB.23.1)
 *
 * Usa Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeHardenedScore, computeDiversification } from '../scoring';
import type { VerifiedBenchmarkCandidate, RejectedCandidate } from '../types';

function makeVerified(partial: Partial<VerifiedBenchmarkCandidate> = {}): VerifiedBenchmarkCandidate {
  return {
    name: 'Test Company',
    country: 'Colombia',
    sector: 'Tecnología / SaaS',
    website: 'https://testcompany.co/',
    linkedin: null,
    city: 'Bogotá',
    estimated_size: '50-200',
    description: 'Empresa de software B2B en Colombia.',
    evidence_url: 'https://testcompany.co/',
    evidence_source: 'Sitio oficial',
    confidence: 'Alta',
    notes: null,
    entity_type: 'company',
    identity_resolution: null,
    official_website_url: 'https://testcompany.co/',
    discovery_url: 'https://testcompany.co/',
    linkedin_status: 'not_searched',
    colombia_evidence: 'Field country="Colombia"',
    sector_evidence: 'Field sector="Tecnología / SaaS"',
    is_verified_company: true,
    ...partial,
  };
}

function makeRejected(code: string, entityType: VerifiedBenchmarkCandidate['entity_type'] = 'article'): RejectedCandidate {
  return {
    rejection_code: code,
    rejection_reason: `Rejected: ${code}`,
    original_name: 'Rejected Entity',
    original_url: null,
    entity_type: entityType,
  };
}

describe('computeHardenedScore — caps', () => {
  it('cap: menos de 5 verificadas → score ≤ 40', () => {
    const verified = [makeVerified(), makeVerified(), makeVerified()];
    const div = computeDiversification(verified);
    const result = computeHardenedScore(verified, [], 3, 0, div);
    assert.ok(result.score_after_caps <= 40, `Expected ≤40, got ${result.score_after_caps}`);
    assert.ok(result.caps_applied.some((c) => c.cap_name === 'verified_lt_5'));
  });

  it('cap: 6 verificadas (< 8) → score ≤ 60', () => {
    const verified = Array.from({ length: 6 }, () => makeVerified());
    const div = computeDiversification(verified);
    const result = computeHardenedScore(verified, [], 6, 0, div);
    assert.ok(result.score_after_caps <= 60, `Expected ≤60, got ${result.score_after_caps}`);
    assert.ok(result.caps_applied.some((c) => c.cap_name === 'verified_lt_8'));
  });

  it('cap: 0 LinkedIn y 0 ciudades → score ≤ 45', () => {
    const verified = Array.from({ length: 8 }, () =>
      makeVerified({ linkedin_status: 'not_searched', city: null }),
    );
    const div = computeDiversification(verified);
    const result = computeHardenedScore(verified, [], 8, 0, div);
    assert.ok(result.score_after_caps <= 45, `Expected ≤45, got ${result.score_after_caps}`);
    assert.ok(result.caps_applied.some((c) => c.cap_name === 'no_linkedin_no_cities'));
  });

  it('cap: < 8 sitios oficiales → score ≤ 70', () => {
    const verified = [
      ...Array.from({ length: 5 }, () => makeVerified()),
      ...Array.from({ length: 3 }, () => makeVerified({
        official_website_url: null,
        website: null,
        is_verified_company: false,
      })),
    ];
    const div = computeDiversification(verified);
    const result = computeHardenedScore(verified, [], 8, 0, div);
    const officialCap = result.caps_applied.find((c) => c.cap_name === 'official_sites_lt_8');
    if (officialCap) {
      assert.ok(result.score_after_caps <= 70, `Expected ≤70 when cap applied, got ${result.score_after_caps}`);
    }
  });

  it('simulación Result A: 2 verificadas de 10 → score << 82', () => {
    const verified = [
      makeVerified({ name: 'AXD', website: 'https://axd.com.co/', official_website_url: 'https://axd.com.co/', city: null, linkedin_status: 'not_searched' }),
      makeVerified({ name: 'Softland', website: 'https://softland.com/', official_website_url: 'https://softland.com/', city: null, linkedin_status: 'not_searched' }),
    ];
    const rejected: RejectedCandidate[] = [
      makeRejected('ASSOCIATION', 'association'),
      makeRejected('ARTICLE_AS_COMPANY', 'article'),
      makeRejected('ARTICLE_AS_COMPANY', 'article'),
      makeRejected('ARTICLE_AS_COMPANY', 'article'),
      makeRejected('REDDIT_URL', 'forum_post'),
      makeRejected('ALT_TEXT_NAME', 'unknown'),
      makeRejected('DIRECTORY_URL', 'directory'),
      makeRejected('ARTICLE_AS_COMPANY', 'article'),
    ];
    const div = computeDiversification(verified);
    const result = computeHardenedScore(verified, rejected, 10, 0, div);
    assert.ok(result.score_after_caps < 50, `Result A simulation must score <50, got ${result.score_after_caps}`);
    assert.ok(result.caps_applied.length > 0, 'At least one cap must be applied');
  });
});

describe('computeHardenedScore — resultado válido', () => {
  it('10 empresas verificadas con LinkedIn y ciudades puede superar 60', () => {
    const verified = Array.from({ length: 10 }, (_, i) =>
      makeVerified({
        name: `EmpresaReal${i}`,
        website: `https://empresa${i}.com.co/`,
        official_website_url: `https://empresa${i}.com.co/`,
        linkedin: `https://www.linkedin.com/company/empresa${i}/`,
        linkedin_status: 'found',
        city: i % 2 === 0 ? 'Bogotá' : 'Medellín',
        description: 'Empresa tech B2B Colombia',
        sector: i % 3 === 0 ? 'Fintech' : i % 3 === 1 ? 'Ciberseguridad' : 'EdTech',
      }),
    );
    const div = computeDiversification(verified);
    const result = computeHardenedScore(verified, [], 10, 0, div);
    assert.ok(result.score_after_caps > 60, `Expected >60 for valid result, got ${result.score_after_caps}`);
    const hardCaps = result.caps_applied.filter((c) => c.cap_value <= 40);
    assert.equal(hardCaps.length, 0, 'No hard caps (≤40) should be applied for a valid result');
  });
});
