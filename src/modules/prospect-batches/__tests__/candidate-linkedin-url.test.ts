import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCandidateLinkedInUrl, getCandidateLinkedInDisplay, isLinkedInCompanyUrl } from '../candidate-linkedin-url';

describe('isLinkedInCompanyUrl', () => {
  it('accepts linkedin.com/company/ URL', () => {
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/company/clarocolombia'), true);
  });

  it('accepts co.linkedin.com/company/ subdomain', () => {
    assert.equal(isLinkedInCompanyUrl('https://co.linkedin.com/company/solventumhealth'), true);
  });

  it('rejects /in/ personal profile', () => {
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/in/john-doe'), false);
  });

  it('rejects /posts/ path', () => {
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/posts/something'), false);
  });

  it('rejects /jobs/ path', () => {
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/jobs/view/123'), false);
  });

  it('rejects /school/ path', () => {
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/school/uniandes'), false);
  });

  it('rejects /showcase/ path', () => {
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/showcase/my-product'), false);
  });

  it('rejects non-linkedin URL', () => {
    assert.equal(isLinkedInCompanyUrl('https://example.com/company/foo'), false);
  });

  it('rejects null', () => {
    assert.equal(isLinkedInCompanyUrl(null), false);
  });

  it('rejects empty string', () => {
    assert.equal(isLinkedInCompanyUrl(''), false);
  });
});

describe('getCandidateLinkedInUrl', () => {
  it('returns metadata.linkedin_enrichment.company_url when present', () => {
    const metadata = {
      linkedin_enrichment: {
        company_url: 'https://www.linkedin.com/company/clarocolombia',
      },
    };
    assert.equal(getCandidateLinkedInUrl(metadata), 'https://www.linkedin.com/company/clarocolombia');
  });

  it('falls back to metadata.rich_profile.company.linkedin_url when linkedin_enrichment absent', () => {
    const metadata = {
      rich_profile: {
        company: {
          linkedin_url: 'https://www.linkedin.com/company/solventumhealth',
        },
      },
    };
    assert.equal(getCandidateLinkedInUrl(metadata), 'https://www.linkedin.com/company/solventumhealth');
  });

  it('prefers linkedin_enrichment over rich_profile', () => {
    const metadata = {
      linkedin_enrichment: {
        company_url: 'https://www.linkedin.com/company/claro',
      },
      rich_profile: {
        company: {
          linkedin_url: 'https://www.linkedin.com/company/other',
        },
      },
    };
    assert.equal(getCandidateLinkedInUrl(metadata), 'https://www.linkedin.com/company/claro');
  });

  it('rejects non-company URL in linkedin_enrichment and falls back to rich_profile', () => {
    const metadata = {
      linkedin_enrichment: {
        company_url: 'https://www.linkedin.com/in/personal-profile',
      },
      rich_profile: {
        company: {
          linkedin_url: 'https://www.linkedin.com/company/valid',
        },
      },
    };
    assert.equal(getCandidateLinkedInUrl(metadata), 'https://www.linkedin.com/company/valid');
  });

  it('returns null when no valid LinkedIn URL found', () => {
    assert.equal(getCandidateLinkedInUrl({}), null);
    assert.equal(getCandidateLinkedInUrl(null), null);
    assert.equal(getCandidateLinkedInUrl(undefined), null);
  });

  it('returns null when only personal profile URLs present', () => {
    const metadata = {
      linkedin_enrichment: { company_url: 'https://www.linkedin.com/in/someone' },
      rich_profile: { company: { linkedin_url: null } },
    };
    assert.equal(getCandidateLinkedInUrl(metadata), null);
  });
});

// ─── v1.16K-R-H: getCandidateLinkedInDisplay ─────────────────────────────────

describe('getCandidateLinkedInDisplay', () => {
  it('returns status=found for linkedin_enrichment with status=found', () => {
    const metadata = {
      linkedin_enrichment: {
        status: 'found',
        company_url: 'https://www.linkedin.com/company/clarocolombia',
      },
    };
    const result = getCandidateLinkedInDisplay(metadata);
    assert.ok(result !== null);
    assert.equal(result!.status, 'found');
    assert.equal(result!.url, 'https://www.linkedin.com/company/clarocolombia');
    assert.equal(result!.reviewRequired, false);
  });

  it('returns status=suggested for ambiguous with valid company_url', () => {
    const metadata = {
      linkedin_enrichment: {
        status: 'ambiguous',
        company_url: 'https://www.linkedin.com/company/intersalud-ocupacional',
        confidence: 60,
      },
    };
    const result = getCandidateLinkedInDisplay(metadata);
    assert.ok(result !== null);
    assert.equal(result!.status, 'suggested');
    assert.equal(result!.url, 'https://www.linkedin.com/company/intersalud-ocupacional');
    assert.equal(result!.reviewRequired, true);
  });

  it('returns null for ambiguous without company_url', () => {
    const metadata = {
      linkedin_enrichment: { status: 'ambiguous', confidence: 60 },
    };
    assert.equal(getCandidateLinkedInDisplay(metadata), null);
  });

  it('returns null for ambiguous with /in/ path', () => {
    const metadata = {
      linkedin_enrichment: {
        status: 'ambiguous',
        company_url: 'https://www.linkedin.com/in/someone',
      },
    };
    assert.equal(getCandidateLinkedInDisplay(metadata), null);
  });

  it('returns null for ambiguous with /posts/ path', () => {
    const metadata = {
      linkedin_enrichment: {
        status: 'ambiguous',
        company_url: 'https://www.linkedin.com/posts/something',
      },
    };
    assert.equal(getCandidateLinkedInDisplay(metadata), null);
  });

  it('returns null for status=not_found', () => {
    const metadata = {
      linkedin_enrichment: {
        status: 'not_found',
        company_url: null,
      },
    };
    assert.equal(getCandidateLinkedInDisplay(metadata), null);
  });

  it('returns found from rich_profile when no linkedin_enrichment', () => {
    const metadata = {
      rich_profile: {
        company: { linkedin_url: 'https://www.linkedin.com/company/someco' },
      },
    };
    const result = getCandidateLinkedInDisplay(metadata);
    assert.ok(result !== null);
    assert.equal(result!.status, 'found');
    assert.equal(result!.reviewRequired, false);
  });

  it('returns null when metadata is null', () => {
    assert.equal(getCandidateLinkedInDisplay(null), null);
  });
});

// ─── Q3F-5BB.7D: flat metadata.linkedin_url + enrichment/import fallbacks ─────

describe('getCandidateLinkedInUrl — Q3F-5BB.7D fallbacks', () => {
  it('reads flat metadata.linkedin_url (Lusha writer path)', () => {
    const metadata = { linkedin_url: 'https://www.linkedin.com/company/lusha-co' };
    assert.equal(getCandidateLinkedInUrl(metadata), 'https://www.linkedin.com/company/lusha-co');
  });

  it('prioritizes canonical linkedin_enrichment.company_url over flat linkedin_url', () => {
    const metadata = {
      linkedin_enrichment: { status: 'found', company_url: 'https://www.linkedin.com/company/canonical' },
      linkedin_url: 'https://www.linkedin.com/company/flat',
    };
    assert.equal(getCandidateLinkedInUrl(metadata), 'https://www.linkedin.com/company/canonical');
  });

  it('reads enrichment.web.linkedin_company.url', () => {
    const metadata = { enrichment: { web: { linkedin_company: { url: 'https://www.linkedin.com/company/webco' } } } };
    assert.equal(getCandidateLinkedInUrl(metadata), 'https://www.linkedin.com/company/webco');
  });

  it('reads external.linkedin_url and import.linkedin_url', () => {
    assert.equal(
      getCandidateLinkedInUrl({ external: { linkedin_url: 'https://www.linkedin.com/company/extco' } }),
      'https://www.linkedin.com/company/extco',
    );
    assert.equal(
      getCandidateLinkedInUrl({ import: { linkedin_url: 'https://www.linkedin.com/company/impco' } }),
      'https://www.linkedin.com/company/impco',
    );
  });

  it('rejects a flat linkedin_url that is a personal /in/ profile', () => {
    assert.equal(getCandidateLinkedInUrl({ linkedin_url: 'https://www.linkedin.com/in/someone' }), null);
  });

  it('does not surface LinkedIn for a candidate with no LinkedIn data (non-Lusha safe)', () => {
    assert.equal(getCandidateLinkedInUrl({ provider: 'agent_1', score: 90 }), null);
  });
});

describe('getCandidateLinkedInDisplay — Q3F-5BB.7D fallbacks', () => {
  it('returns found for a flat metadata.linkedin_url company profile', () => {
    const result = getCandidateLinkedInDisplay({ linkedin_url: 'https://www.linkedin.com/company/lusha-co' });
    assert.ok(result !== null);
    assert.equal(result!.status, 'found');
    assert.equal(result!.url, 'https://www.linkedin.com/company/lusha-co');
    assert.equal(result!.reviewRequired, false);
  });

  it('returns null for a flat linkedin_url that is not a company profile', () => {
    assert.equal(getCandidateLinkedInDisplay({ linkedin_url: 'https://www.linkedin.com/in/someone' }), null);
  });
});
