import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { candidateLeftCompany, runContactSearchFollowUp, type FollowUpPendingCandidate } from '../contact-search-follow-up-core';
import type { RunAutomaticContactEnrichmentForRequestResult } from '../automatic-routing-action-core';
import { leftCompanyLine } from '../../../components/contact-enrichment/contact-enrichment-chat-reducer';

const RESULT = {
  success: true,
  status: 'no_fallback_needed',
  automaticRoutingEnabled: true,
  fallbackExecuted: false,
  attempt1AttemptId: 'run-now',
  attempt2AttemptId: null,
  blockedReason: null,
  reusedExistingCandidates: 0,
  providerCandidatesCreated: { apollo: 0, lusha: null },
  failedProviders: [],
  hubspotFirstCandidates: 2,
  hubspotFirstSatisfied: false,
  contactBankCandidates: 0,
  contactBankSatisfied: false,
  companySiteCandidates: 0,
} as unknown as RunAutomaticContactEnrichmentForRequestResult;

function complete(id: string, metadata: Record<string, unknown> | null): FollowUpPendingCandidate {
  return {
    id,
    source: 'hubspot',
    email: `${id}@colinealcorp.test`,
    phone: '+593 000',
    linkedin_url: `https://www.linkedin.com/in/${id}`,
    enrichment_run_id: 'run-now',
    enrichment_metadata: metadata,
  };
}

describe('aprobación automática y contactos que ya no están (Colineal 25-11)', () => {
  it('un contacto de HubSpot completo que ya trabaja en otra empresa NO pasa solo a Contactos', async () => {
    const approved: string[] = [];
    const out = await runContactSearchFollowUp('req-1', RESULT, {
      loadEarlierCompanyRunIds: async () => [],
      loadPendingCandidates: async () => [
        complete('bernardo', { current_employment: { status: 'other_company', source: 'apollo', current_company: 'GO CORP' } }),
        complete('patricia', { current_employment: { status: 'confirmed', source: 'apollo' } }),
      ],
      approveCandidate: async (id) => {
        approved.push(id);
        return { ok: true };
      },
    });
    assert.deepEqual(approved, ['patricia']);
    assert.equal(out.contactsNoLongerAtCompany, 1);
  });

  it('candidateLeftCompany sólo con «otra empresa» o «sin trabajo actual»', () => {
    assert.equal(candidateLeftCompany({ enrichment_metadata: { current_employment: { status: 'no_current_role' } } }), true);
    assert.equal(candidateLeftCompany({ enrichment_metadata: { current_employment: { status: 'unknown' } } }), false);
    assert.equal(candidateLeftCompany({ enrichment_metadata: null }), false);
  });

  it('el chat dice cuántos ya no están y dónde quedaron', () => {
    assert.equal(leftCompanyLine({ contactsNoLongerAtCompany: 0 }), null);
    assert.match(leftCompanyLine({ contactsNoLongerAtCompany: 2 }) ?? '', /^2 ya no están en la empresa .*«Ya no están en la empresa»/);
    assert.match(leftCompanyLine({ contactsNoLongerAtCompany: 1 }) ?? '', /^1 ya no está en la empresa/);
  });
});
