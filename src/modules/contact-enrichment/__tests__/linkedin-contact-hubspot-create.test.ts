// AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — el LinkedIn del candidato llega a HubSpot al aprobar.
//
// Recorre el camino real con las piezas puras: fila del candidato creada por LinkedIn →
// contacto oficial al aprobar (`buildContactInsertPayload`) → propiedades de HubSpot
// (`buildHubSpotContactProperties`) → cuerpo del POST (`buildHubSpotContactCreateBody`, #651)
// → reintento sin `hs_linkedin_url` ante un 400 (`postHubSpotContactCreateWithLinkedinFallback`).
// Sin red. Datos ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildContactInsertPayload, type CandidateRecord } from '../candidate-review-core';
import {
  buildQuickSearchCandidateRow,
  evaluateQuickSearchCompanyConsistency,
} from '../contact-quick-search-candidate-core';
import type { SearchedContactData } from '../linkedin-contact-search-core';
import { buildHubSpotContactProperties, type ContactForSync } from '@/modules/contacts/contact-hubspot-sync-core';
import {
  buildHubSpotContactCreateBody,
  postHubSpotContactCreateWithLinkedinFallback,
} from '@/server/integrations/hubspot-contact-sync';
import type { CompanyCandidate } from '../types';

const DATA: SearchedContactData = {
  entryMode: 'linkedin_single',
  linkedinUrl: 'https://www.linkedin.com/in/jos%C3%A9-ficticio',
  linkedinSlug: 'josé-ficticio',
  profile: {
    provider: 'lusha',
    sourceContactId: 'lusha-1',
    firstName: 'José',
    lastName: 'Ficticio',
    fullName: 'José Ficticio',
    title: 'Gerente de Talento',
    seniority: null,
    country: null,
    email: 'jose@empresa-ficticia.test',
    providerCompanyName: 'Empresa Ficticia SAS',
    providerCompanyDomain: 'empresa-ficticia.test',
    providerCompanyWebsiteUrl: 'empresa-ficticia.test',
    phoneAvailable: null,
  },
  providersCalled: ['apollo', 'lusha'],
  creditsSpent: null,
  searchedAt: '2026-10-26T12:00:00.000Z',
};
const COMPANY: CompanyCandidate = {
  source: 'sellup',
  name: 'Empresa Ficticia SAS',
  domain: 'empresa-ficticia.test',
  sellupAccountId: 'acc-1',
  matchConfidence: 1,
};

function approvedContact(): ContactForSync {
  const row = buildQuickSearchCandidateRow({
    runId: 'run-1',
    data: DATA,
    company: COMPANY,
    consistency: evaluateQuickSearchCompanyConsistency(DATA.profile, COMPANY),
    companyMatchedBy: 'sellup_domain',
  });
  const candidate = {
    ...row,
    id: 'cand-1',
    department: null,
    account_id: 'acc-1',
    hubspot_company_id: null,
    company_name: COMPANY.name,
    company_domain: COMPANY.domain,
    country_code: null,
  } as unknown as CandidateRecord;
  const payload = buildContactInsertPayload({ candidate, accountId: 'acc-1', internalUserId: 'u1' });
  return {
    id: 'contact-1',
    account_id: payload.account_id,
    full_name: payload.full_name,
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
    phone: payload.phone,
    mobile_phone: null,
    job_title: payload.job_title,
    linkedin_url: payload.linkedin_url,
    hubspot_contact_id: null,
    metadata: {},
  };
}

describe('LinkedIn → HubSpot al crear el contacto', () => {
  it('el POST de creación lleva hs_linkedin_url con la URL canónica', () => {
    const contact = approvedContact();
    assert.equal(contact.linkedin_url, 'https://www.linkedin.com/in/jos%C3%A9-ficticio');
    const body = buildHubSpotContactCreateBody(buildHubSpotContactProperties(contact, contact.email as string), true);
    assert.equal(body.hs_linkedin_url, 'https://www.linkedin.com/in/jos%C3%A9-ficticio');
    assert.equal(body.email, 'jose@empresa-ficticia.test');
  });

  it('ante un 400 se reintenta UNA vez sin hs_linkedin_url (mismo reintento que #612/#651)', async () => {
    const contact = approvedContact();
    const body = buildHubSpotContactCreateBody(buildHubSpotContactProperties(contact, contact.email as string), true);
    const sent: Array<Record<string, string>> = [];
    const response = await postHubSpotContactCreateWithLinkedinFallback(body, async (props) => {
      sent.push(props);
      return new Response(null, { status: sent.length === 1 ? 400 : 201 });
    });
    assert.equal(response.status, 201);
    assert.equal(sent.length, 2);
    assert.equal('hs_linkedin_url' in sent[0], true);
    assert.equal('hs_linkedin_url' in sent[1], false);
  });
});
