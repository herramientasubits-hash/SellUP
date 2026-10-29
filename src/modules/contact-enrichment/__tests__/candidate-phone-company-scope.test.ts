// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — pendiente de «Reasignar empresa»: los flujos de
// teléfono (reveal, privacy gate, supresión, recovery, webhook) usan la empresa EFECTIVA del
// candidato (la reasignada, si existe) y no la del run.
// Sin red, sin DB.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { resolveCandidatePhoneCompanyScope } from '../candidate-company-reassignment-core';
import { mapPhoneRevealPrivacyGateCandidateRow, PRIVACY_GATE_CANDIDATE_SELECT } from '../phone-reveal-privacy-gate';
import { mapRecoveryCandidate } from '../phone-reveal-recovery-deps';

const REASSIGNED = {
  company_reassignment: {
    version: 1,
    account_id: 'acc-new',
    hubspot_company_id: '777',
    company_name: 'Nueva SA',
    company_domain: 'nueva.com',
    country_code: 'CL',
    selected_source: 'hubspot',
    account_resolution: 'existing_by_hubspot',
    reassigned_by: 'user-1',
    reassigned_at: '2026-10-29T12:00:00.000Z',
    original: { account_id: null, hubspot_company_id: null, company_name: 'Vieja', company_domain: null },
    original_company_consistency: null,
  },
};

const RUN = { account_id: 'acc-old', company_name: 'Vieja SA', company_country_code: 'CO' };

describe('resolveCandidatePhoneCompanyScope', () => {
  it('sin reasignación devuelve exactamente lo del run', () => {
    assert.deepEqual(resolveCandidatePhoneCompanyScope(RUN, {}), {
      accountId: 'acc-old',
      companyName: 'Vieja SA',
      companyCountryCode: 'CO',
    });
  });

  it('run nulo y sin reasignación ⇒ todo null', () => {
    assert.deepEqual(resolveCandidatePhoneCompanyScope(null, null), {
      accountId: null,
      companyName: null,
      companyCountryCode: null,
    });
  });

  it('con reasignación manda la empresa reasignada', () => {
    assert.deepEqual(resolveCandidatePhoneCompanyScope(RUN, REASSIGNED), {
      accountId: 'acc-new',
      companyName: 'Nueva SA',
      companyCountryCode: 'CL',
    });
  });

  it('run sin cuenta (nació sin empresa) + reasignación ⇒ cuenta reasignada', () => {
    const scope = resolveCandidatePhoneCompanyScope({ account_id: null, company_name: 'X' }, REASSIGNED);
    assert.equal(scope.accountId, 'acc-new');
  });

  it('reasignación sin país conserva el país del run', () => {
    const meta = { company_reassignment: { ...REASSIGNED.company_reassignment, country_code: null } };
    assert.equal(resolveCandidatePhoneCompanyScope(RUN, meta).companyCountryCode, 'CO');
  });

  it('reasignación malformada ⇒ fail-closed (lo del run)', () => {
    const meta = { company_reassignment: { version: 2, account_id: 'acc-new' } };
    assert.equal(resolveCandidatePhoneCompanyScope(RUN, meta).accountId, 'acc-old');
  });
});

describe('mappers de teléfono aplican la reasignación', () => {
  it('privacy gate lee enrichment_metadata y usa la cuenta reasignada', () => {
    assert.match(PRIVACY_GATE_CANDIDATE_SELECT, /enrichment_metadata/);
    const row = mapPhoneRevealPrivacyGateCandidateRow({
      id: 'c1',
      source: 'apollo',
      phone: null,
      enrichment_metadata: REASSIGNED,
      run: { account_id: 'acc-old' },
    });
    assert.equal(row.accountId, 'acc-new');
  });

  it('recovery usa cuenta y país reasignados', () => {
    const rec = mapRecoveryCandidate({ id: 'c1', enrichment_metadata: REASSIGNED, run: [RUN] });
    assert.equal(rec.accountId, 'acc-new');
    assert.equal(rec.runCompanyCountryCode, 'CL');
  });

  it('recovery sin reasignación no cambia', () => {
    const rec = mapRecoveryCandidate({ id: 'c1', enrichment_metadata: {}, run: RUN });
    assert.equal(rec.accountId, 'acc-old');
    assert.equal(rec.runCompanyCountryCode, 'CO');
  });

  it('reveal, webhook y supresión pasan por el helper (estático)', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    for (const rel of [
      'modules/contact-enrichment/phone-reveal-actions.ts',
      'app/api/integrations/apollo/phone-reveal/webhook/route.ts',
      'modules/contact-enrichment/phone-cache-suppression-actions.ts',
    ]) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      assert.match(src, /resolveCandidatePhoneCompanyScope\(/, rel);
      assert.doesNotMatch(src, /accountId: run\?\.account_id \?\? null/, rel);
    }
  });
});
