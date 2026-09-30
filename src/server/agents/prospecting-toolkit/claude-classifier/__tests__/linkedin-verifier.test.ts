/**
 * Tests — LinkedIn de la empresa verificado (AGENT1-CLAUDE-LINKEDIN-1). Sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { verifyLinkedInCompany } from '../linkedin-verifier';

const base = {
  officialSiteLinks: [] as string[],
  searchResultUrls: [] as string[],
  companyName: 'Clínica San Felipe',
  companyDomain: 'clinicasanfelipe.com',
  countryCode: 'PE',
};

describe('verifyLinkedInCompany', () => {
  it('acepta la página que el sitio oficial enlaza', () => {
    const r = verifyLinkedInCompany({
      ...base,
      claimedUrl: 'https://pe.linkedin.com/company/clinica-san-felipe/',
      officialSiteLinks: ['https://www.linkedin.com/company/clinica-san-felipe'],
    });
    assert.equal(r.linkedin?.source, 'website_social_link');
    assert.equal(r.linkedin?.url, 'https://www.linkedin.com/company/clinica-san-felipe');
  });

  it('sin propuesta de Claude, usa el único enlace del sitio oficial (costo cero)', () => {
    const r = verifyLinkedInCompany({
      ...base,
      claimedUrl: null,
      officialSiteLinks: ['https://www.linkedin.com/company/clinica-san-felipe'],
    });
    assert.equal(r.linkedin?.slug, 'clinica-san-felipe');
  });

  it('acepta un resultado de búsqueda cuyo slug coincide con la empresa', () => {
    const r = verifyLinkedInCompany({
      ...base,
      claimedUrl: 'https://www.linkedin.com/company/clinica-san-felipe',
      searchResultUrls: ['https://pe.linkedin.com/company/clinica-san-felipe'],
    });
    assert.equal(r.linkedin?.source, 'provided_search_result');
  });

  it('descarta una URL que Claude escribió sin fuente', () => {
    const r = verifyLinkedInCompany({ ...base, claimedUrl: 'https://www.linkedin.com/company/clinica-san-felipe' });
    assert.equal(r.linkedin, null);
    assert.equal(r.rejected?.reason, 'linkedin_url_without_source');
  });

  it('descarta un perfil personal (/in/)', () => {
    const r = verifyLinkedInCompany({ ...base, claimedUrl: 'https://www.linkedin.com/in/juan-perez' });
    assert.equal(r.linkedin, null);
    assert.equal(r.rejected?.reason, 'not_a_linkedin_company_page');
  });

  it('descarta un resultado de búsqueda de OTRA empresa', () => {
    const r = verifyLinkedInCompany({
      ...base,
      claimedUrl: 'https://www.linkedin.com/company/banco-de-credito',
      searchResultUrls: ['https://www.linkedin.com/company/banco-de-credito'],
    });
    assert.equal(r.linkedin, null);
  });
});
