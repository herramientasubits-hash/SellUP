import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectCandidateAccountIds,
  mergeCandidateAccountContext,
} from '../candidate-account-context';
import { hubspotCompanyUrl } from '../../../components/contact-enrichment/hubspot-company-url';
import type { PendingContactCandidate } from '../types';

function candidate(overrides: Partial<PendingContactCandidate>): PendingContactCandidate {
  return {
    id: 'c1',
    full_name: 'Ana',
    title: null,
    email: null,
    linkedin_url: null,
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0,
    enrichment_metadata: {},
    enrichment_run_id: null,
    created_at: '2026-10-08T00:00:00Z',
    phone_reveal_status: null,
    company_name: 'Acme',
    company_domain: null,
    account_id: null,
    hubspot_company_id: null,
    ...overrides,
  } as PendingContactCandidate;
}

describe('candidate-account-context — la empresa asociada en este momento', () => {
  it('reúne los account_id distintos, sin vacíos', () => {
    const ids = collectCandidateAccountIds([
      candidate({ id: 'a', account_id: 'acc-1' }),
      candidate({ id: 'b', account_id: 'acc-1' }),
      candidate({ id: 'c', account_id: '  ' }),
      candidate({ id: 'd', account_id: null }),
      candidate({ id: 'e', account_id: 'acc-2' }),
    ]);
    assert.deepEqual(ids, ['acc-1', 'acc-2']);
  });

  it('la cuenta aporta la página web y sólo llena dominio y HubSpot ID cuando el run no los trae', () => {
    const [withRun, withoutRun] = mergeCandidateAccountContext(
      [
        candidate({ id: 'a', account_id: 'acc-1', company_domain: 'run.com', hubspot_company_id: '111' }),
        candidate({ id: 'b', account_id: 'acc-1' }),
      ],
      [{ id: 'acc-1', website: 'https://www.acme.com', domain: 'acme.com', hubspot_company_id: '999' }],
    );
    assert.equal(withRun.company_domain, 'run.com');
    assert.equal(withRun.hubspot_company_id, '111');
    assert.equal(withRun.company_website, 'https://www.acme.com');
    assert.equal(withoutRun.company_domain, 'acme.com');
    assert.equal(withoutRun.hubspot_company_id, '999');
  });

  it('sin cuenta asociada (o no visible) deja al candidato como venía', () => {
    const [out] = mergeCandidateAccountContext(
      [candidate({ account_id: 'acc-x', company_domain: 'x.com' })],
      [],
    );
    assert.equal(out.company_domain, 'x.com');
    assert.equal(out.company_website, null);
  });
});

describe('hubspotCompanyUrl', () => {
  it('con portal abre la ficha de la empresa en ese portal', () => {
    assert.equal(hubspotCompanyUrl('12345', '987'), 'https://app.hubspot.com/contacts/987/company/12345');
  });
  it('sin portal usa el enlace genérico de empresas', () => {
    assert.equal(hubspotCompanyUrl(' 12345 ', null), 'https://app.hubspot.com/contacts/companies/12345');
  });
});
