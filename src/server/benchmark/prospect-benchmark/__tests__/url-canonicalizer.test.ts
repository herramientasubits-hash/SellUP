/**
 * Tests — URL Canonicalizer for Evidence Provenance (Hotfix 16AB.23.6)
 *
 * 13 test cases covering all normalization rules.
 * No real API calls. Pure functions only.
 *
 * Cases:
 *   1   Trailing slash — equivalent
 *   2   www prefix — equivalent
 *   3   HTTP/HTTPS — equivalent for provenance
 *   4   Tracking parameters stripped — equivalent
 *   5   Functional parameter preserved — not equivalent
 *   6   Fragment stripped — equivalent
 *   7   Different path — not equivalent
 *   8   LinkedIn regional subdomain — equivalent
 *   9   LinkedIn different slug — not equivalent
 *  10   Different domain — not equivalent
 *  11   Unsafe scheme — returns null (invalid)
 *  12   Provenance: tool_result_and_citation with trailing-slash mismatch
 *  13   Repeated evidence: variants with tracking/slash count as one URL
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeEvidenceUrl,
  areEvidenceUrlsEquivalent,
  EVIDENCE_PROVENANCE_VERSION,
} from '../url-canonicalizer';
import {
  classifyUrlOrigin,
  deriveCandidateAuditStatus,
} from '../multistage/web-search-audit';
import type { AnthropicWebSearchAudit } from '../multistage/web-search-audit';
import { classifyPoolEvidence } from '../evidence-classifier';

// ─── Case 1 — Trailing slash ──────────────────────────────────────────────────

describe('Case 1 — Trailing slash equivalence', () => {
  it('https://www.b-secure.co and https://www.b-secure.co/ are equivalent', () => {
    assert.ok(areEvidenceUrlsEquivalent('https://www.b-secure.co', 'https://www.b-secure.co/'));
  });

  it('canonical forms are identical', () => {
    assert.equal(
      canonicalizeEvidenceUrl('https://www.b-secure.co'),
      canonicalizeEvidenceUrl('https://www.b-secure.co/')
    );
  });
});

// ─── Case 2 — www prefix ─────────────────────────────────────────────────────

describe('Case 2 — www prefix equivalence', () => {
  it('https://example.com and https://www.example.com/ are equivalent', () => {
    assert.ok(areEvidenceUrlsEquivalent('https://example.com', 'https://www.example.com/'));
  });

  it('non-www subdomain is NOT equivalent to bare domain', () => {
    assert.ok(!areEvidenceUrlsEquivalent('https://app.example.com', 'https://example.com'));
  });
});

// ─── Case 3 — HTTP/HTTPS equivalence ─────────────────────────────────────────

describe('Case 3 — HTTP and HTTPS are equivalent for provenance', () => {
  it('http://example.com/ and https://example.com are equivalent', () => {
    assert.ok(areEvidenceUrlsEquivalent('http://example.com/', 'https://example.com'));
  });

  it('canonical form always uses https scheme', () => {
    const canonical = canonicalizeEvidenceUrl('http://example.com/page');
    assert.ok(canonical?.startsWith('https://'));
  });
});

// ─── Case 4 — Tracking parameters stripped ───────────────────────────────────

describe('Case 4 — Tracking parameters removed', () => {
  it('utm_source=google is stripped — equivalent to clean URL', () => {
    assert.ok(areEvidenceUrlsEquivalent(
      'https://example.com/nosotros?utm_source=google',
      'https://example.com/nosotros'
    ));
  });

  it('all known tracking params are stripped', () => {
    const dirty = 'https://example.com/page?utm_source=x&utm_medium=y&utm_campaign=z&utm_term=a&utm_content=b&fbclid=1&gclid=2&mc_cid=3&mc_eid=4';
    const clean = 'https://example.com/page';
    assert.ok(areEvidenceUrlsEquivalent(dirty, clean));
  });
});

// ─── Case 5 — Functional parameters preserved ────────────────────────────────

describe('Case 5 — Functional parameters preserved (not equivalent)', () => {
  it('https://example.com/page?id=1 and ?id=2 are NOT equivalent', () => {
    assert.ok(!areEvidenceUrlsEquivalent(
      'https://example.com/page?id=1',
      'https://example.com/page?id=2'
    ));
  });

  it('canonical form retains functional param', () => {
    const c = canonicalizeEvidenceUrl('https://example.com/page?id=1');
    assert.ok(c?.includes('id=1'));
  });
});

// ─── Case 6 — Fragment stripped ──────────────────────────────────────────────

describe('Case 6 — Fragment stripped', () => {
  it('https://example.com/page#equipo and https://example.com/page are equivalent', () => {
    assert.ok(areEvidenceUrlsEquivalent(
      'https://example.com/page#equipo',
      'https://example.com/page'
    ));
  });
});

// ─── Case 7 — Different path — not equivalent ────────────────────────────────

describe('Case 7 — Different path (not equivalent)', () => {
  it('https://example.com/ and https://example.com/nosotros are NOT equivalent', () => {
    assert.ok(!areEvidenceUrlsEquivalent(
      'https://example.com/',
      'https://example.com/nosotros'
    ));
  });
});

// ─── Case 8 — LinkedIn regional subdomain ────────────────────────────────────

describe('Case 8 — LinkedIn regional subdomain equivalence', () => {
  it('co.linkedin.com/company/b-secure and www.linkedin.com/company/b-secure/ are equivalent', () => {
    assert.ok(areEvidenceUrlsEquivalent(
      'https://co.linkedin.com/company/b-secure',
      'https://www.linkedin.com/company/b-secure/'
    ));
  });

  it('mx.linkedin.com and pe.linkedin.com with same slug are equivalent', () => {
    assert.ok(areEvidenceUrlsEquivalent(
      'https://mx.linkedin.com/company/acme-corp',
      'https://pe.linkedin.com/company/acme-corp'
    ));
  });

  it('canonical LinkedIn URL is always linkedin.com (no regional subdomain)', () => {
    const c = canonicalizeEvidenceUrl('https://co.linkedin.com/company/b-secure');
    assert.ok(c?.startsWith('https://linkedin.com/'));
  });
});

// ─── Case 9 — LinkedIn different slug (not equivalent) ───────────────────────

describe('Case 9 — LinkedIn different slug (not equivalent)', () => {
  it('/company/b-secure and /company/bsecure-latam are NOT equivalent', () => {
    assert.ok(!areEvidenceUrlsEquivalent(
      'https://www.linkedin.com/company/b-secure',
      'https://www.linkedin.com/company/bsecure-latam'
    ));
  });
});

// ─── Case 10 — Different domain (not equivalent) ─────────────────────────────

describe('Case 10 — Different domain (not equivalent)', () => {
  it('https://b-secure.co and https://bsecure.com are NOT equivalent', () => {
    assert.ok(!areEvidenceUrlsEquivalent(
      'https://b-secure.co',
      'https://bsecure.com'
    ));
  });
});

// ─── Case 11 — Unsafe scheme returns null ────────────────────────────────────

describe('Case 11 — Unsafe scheme returns null', () => {
  it('javascript:alert(1) returns null', () => {
    assert.equal(canonicalizeEvidenceUrl('javascript:alert(1)'), null);
  });

  it('data: URL returns null', () => {
    assert.equal(canonicalizeEvidenceUrl('data:text/html,<h1>hi</h1>'), null);
  });

  it('file: URL returns null', () => {
    assert.equal(canonicalizeEvidenceUrl('file:///etc/passwd'), null);
  });

  it('empty string returns null', () => {
    assert.equal(canonicalizeEvidenceUrl(''), null);
  });

  it('null returns null', () => {
    assert.equal(canonicalizeEvidenceUrl(null), null);
  });

  it('invalid URL returns null', () => {
    assert.equal(canonicalizeEvidenceUrl('not a url at all'), null);
  });

  it('areEvidenceUrlsEquivalent returns false when either URL is invalid', () => {
    assert.ok(!areEvidenceUrlsEquivalent('javascript:void(0)', 'https://example.com'));
    assert.ok(!areEvidenceUrlsEquivalent('https://example.com', 'javascript:void(0)'));
  });
});

// ─── Case 12 — Provenance: tool_result_and_citation with slash mismatch ──────

describe('Case 12 — Provenance with trailing-slash mismatch → tool_result_and_citation', () => {
  it('structured output URL without slash matches result with slash AND citation', () => {
    const audit: AnthropicWebSearchAudit = {
      searchRequests: 1,
      searchCountStatus: 'reported_by_provider',
      queries: [{ toolUseId: 'q1', query: 'B-Secure Colombia' }],
      results: [
        { toolUseId: 'q1', url: 'https://www.b-secure.co/', title: 'B-SECURE' },
      ],
      citations: [
        { url: 'https://www.b-secure.co/', title: 'B-SECURE', textBlockIndex: 0 },
      ],
      errors: [],
      stopReason: 'end_turn',
    };

    // Structured output has no trailing slash
    const origin = classifyUrlOrigin('https://www.b-secure.co', audit);
    assert.equal(origin, 'tool_result_and_citation');
  });

  it('structured output URL without slash matches result with slash → tool_result_url', () => {
    const audit: AnthropicWebSearchAudit = {
      searchRequests: 1,
      searchCountStatus: 'reported_by_provider',
      queries: [{ toolUseId: 'q1', query: 'B-Secure Colombia' }],
      results: [
        { toolUseId: 'q1', url: 'https://www.b-secure.co/', title: 'B-SECURE' },
      ],
      citations: [],
      errors: [],
      stopReason: 'end_turn',
    };

    const origin = classifyUrlOrigin('https://www.b-secure.co', audit);
    assert.equal(origin, 'tool_result_url');
  });

  it('URL not in results or citations is model_generated_url', () => {
    const audit: AnthropicWebSearchAudit = {
      searchRequests: 1,
      searchCountStatus: 'reported_by_provider',
      queries: [{ toolUseId: 'q1', query: 'B-Secure Colombia' }],
      results: [{ toolUseId: 'q1', url: 'https://www.b-secure.co/', title: 'B-SECURE' }],
      citations: [],
      errors: [],
      stopReason: 'end_turn',
    };

    const origin = classifyUrlOrigin('https://completelydifferent.com', audit);
    assert.equal(origin, 'model_generated_url');
  });
});

// ─── Case 13 — Repeated evidence: variants count as one URL ──────────────────

describe('Case 13 — Repeated evidence variants count as one URL', () => {
  it('trailing slash, tracking param, and clean URL count as one repeated entry', () => {
    const candidates = [
      { name: 'Empresa A', evidence_url: 'https://fuente.com/articulo', website: null },
      { name: 'Empresa B', evidence_url: 'https://fuente.com/articulo/', website: null },
      { name: 'Empresa C', evidence_url: 'https://fuente.com/articulo?utm_source=test', website: null },
    ];

    const result = classifyPoolEvidence(candidates);

    assert.ok(result.get('Empresa A')?.is_repeated, 'Empresa A should be repeated');
    assert.ok(result.get('Empresa B')?.is_repeated, 'Empresa B should be repeated');
    assert.ok(result.get('Empresa C')?.is_repeated, 'Empresa C should be repeated');
  });

  it('different pages on same domain are NOT treated as repeated', () => {
    const candidates = [
      { name: 'Empresa A', evidence_url: 'https://fuente.com/pagina-1', website: null },
      { name: 'Empresa B', evidence_url: 'https://fuente.com/pagina-2', website: null },
    ];

    const result = classifyPoolEvidence(candidates);

    assert.ok(!result.get('Empresa A')?.is_repeated, 'Empresa A must not be repeated');
    assert.ok(!result.get('Empresa B')?.is_repeated, 'Empresa B must not be repeated');
  });
});

// ─── Sanity: EVIDENCE_PROVENANCE_VERSION is a positive integer ────────────────

describe('EVIDENCE_PROVENANCE_VERSION', () => {
  it('is a positive integer', () => {
    assert.ok(typeof EVIDENCE_PROVENANCE_VERSION === 'number');
    assert.ok(EVIDENCE_PROVENANCE_VERSION > 0);
    assert.ok(Number.isInteger(EVIDENCE_PROVENANCE_VERSION));
  });
});

// ─── B-Secure offline regression ─────────────────────────────────────────────

describe('B-Secure regression — website URL provenance fixed by canonicalization', () => {
  const audit: AnthropicWebSearchAudit = {
    searchRequests: 3,
    searchCountStatus: 'reported_by_provider',
    queries: [
      { toolUseId: 'srvtoolu_01D5DnzQXrsfCsn15HnaGAvL', query: 'B-Secure Colombia ciberseguridad empresa' },
      { toolUseId: 'srvtoolu_01B87STYNetzmnZ7q24W3EqP', query: 'B-Secure Colombia cybersecurity sitio web oficial' },
      { toolUseId: 'srvtoolu_016acM5XRaHV67VYpbSgpay8', query: 'B-Secure Colombia empleados Medellín Cali sede oficinas' },
    ],
    results: [
      { toolUseId: 'srvtoolu_01D5DnzQXrsfCsn15HnaGAvL', url: 'https://www.b-secure.co/', title: 'B-SECURE | Pasión por la Seguridad' },
      { toolUseId: 'srvtoolu_01D5DnzQXrsfCsn15HnaGAvL', url: 'https://co.linkedin.com/company/b-secure', title: 'B-SECURE | LinkedIn' },
      { toolUseId: 'srvtoolu_01D5DnzQXrsfCsn15HnaGAvL', url: 'https://www.b-secure.co/nosotros/quienes-somos', title: '¿Quiénes somos? | B-SECURE' },
    ],
    citations: [
      { url: 'https://co.linkedin.com/company/b-secure', title: 'B-SECURE | LinkedIn', textBlockIndex: 7 },
      { url: 'https://co.linkedin.com/company/b-secure', title: 'B-SECURE | LinkedIn', textBlockIndex: 7 },
    ],
    errors: [],
    stopReason: 'end_turn',
  };

  it('sitio_web (no slash) classifies as tool_result_url (result has slash)', () => {
    assert.equal(classifyUrlOrigin('https://www.b-secure.co', audit), 'tool_result_url');
  });

  it('linkedin (co.linkedin) classifies as tool_result_and_citation', () => {
    assert.equal(classifyUrlOrigin('https://co.linkedin.com/company/b-secure', audit), 'tool_result_and_citation');
  });

  it('url_evidencia_principal classifies as tool_result_url', () => {
    assert.equal(classifyUrlOrigin('https://www.b-secure.co/nosotros/quienes-somos', audit), 'tool_result_url');
  });

  it('overall audit status is auditable (all three URLs found)', () => {
    const status = deriveCandidateAuditStatus(
      'https://www.b-secure.co',
      'https://co.linkedin.com/company/b-secure',
      'https://www.b-secure.co/nosotros/quienes-somos',
      audit
    );
    assert.equal(status, 'auditable');
  });
});
