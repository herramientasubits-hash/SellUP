import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCandidateLinkedInUrl, isLinkedInCompanyUrl } from '../candidate-linkedin-url';

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
