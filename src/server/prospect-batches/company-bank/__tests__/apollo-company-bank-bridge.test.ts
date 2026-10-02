/**
 * AGENT1-COMPANY-BANK — el puente Apollo ⇄ banco, puro.
 *
 * REAL_PROVIDER_CALLS = 0 · REAL_CREDITS = 0 · PROD_WRITES = 0.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_BANK_PAYLOAD_KIND,
  apolloEvidenceKeyForCapped,
  isCompanyBankDisabled,
  mergeBankOrganizations,
  planApolloBankDeposit,
  planBankSettlement,
  readApolloBankEvidence,
} from '../apollo-company-bank-bridge';
import { isDepositItemWellFormed } from '../company-bank-store';
import {
  fromCandidateEvidenceSnapshot,
  toCandidateEvidenceSnapshot,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/checkpoint';
import { toRawDiscoveredOrganization } from '@/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server';
import type { DeliveryCappedCompany, WebSearchResult } from '@/server/agents/prospecting-toolkit/types';

function apolloResult(id: string, name: string, domain: string): WebSearchResult {
  return {
    title: name,
    url: `https://${domain}`,
    snippet: 'empresa de tecnología',
    source: 'apollo_organizations',
    rank: 3,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: id,
      domain,
      website: `https://www.${domain}`,
      linkedin_url: `https://www.linkedin.com/company/${id}`,
      industry: 'information technology & services',
      country_code: 'CO',
      employee_count: 120,
      apollo_profile: { industry: 'information technology & services', industries: [] },
    },
  } as WebSearchResult;
}

function capped(overrides: Partial<DeliveryCappedCompany> = {}): DeliveryCappedCompany {
  return {
    name: 'Alfa Tech',
    domain: 'alfatech.co',
    linkedinUrl: null,
    countryCode: 'CO',
    providerOrganizationId: 'org-1',
    countsTowardTarget: false,
    claims: [{ type: 'domain', key: 'alfatech.co' }],
    ...overrides,
  };
}

const EVIDENCE = toCandidateEvidenceSnapshot(apolloResult('org-1', 'Alfa Tech', 'alfatech.co'));

describe('planApolloBankDeposit', () => {
  it('incompleta ⇒ to_complete con motivo; completa ⇒ ready sin motivos', () => {
    const plan = planApolloBankDeposit({
      countryCode: 'CO',
      macroIndustryKey: 'technology',
      sourceBatchId: 'b1',
      capped: [capped(), capped({ name: 'Beta', domain: 'beta.co', providerOrganizationId: 'org-2', countsTowardTarget: true, claims: [{ type: 'domain', key: 'beta.co' }] })],
      evidenceFor: () => EVIDENCE,
    });
    assert.equal(plan.notBankable.length, 0);
    assert.deepEqual(plan.items.map((i) => [i.tier, i.missingFields]), [
      ['to_complete', ['target_conditions']],
      ['ready', []],
    ]);
    for (const item of plan.items) {
      assert.equal(item.sourceProvider, 'apollo');
      assert.equal(item.sourceBatchId, 'b1');
      assert.equal((item.payload as { kind: string }).kind, APOLLO_BANK_PAYLOAD_KIND);
      assert.equal(isDepositItemWellFormed(item), true, 'lo que se planea cumple lo que la 142 exige');
    }
  });

  it('sin dominio, sin evidencia o sin claves ⇒ NO va al banco (vuelve a «Descartadas»)', () => {
    const noDomain = capped({ domain: null });
    const noClaims = capped({ name: 'Gamma', domain: 'gamma.co', claims: [] });
    const noEvidence = capped({ name: 'Delta', domain: 'delta.co', providerOrganizationId: 'org-x' });
    const plan = planApolloBankDeposit({
      countryCode: 'CO',
      macroIndustryKey: 'technology',
      sourceBatchId: 'b1',
      capped: [noDomain, noClaims, noEvidence],
      evidenceFor: (c) => (c.providerOrganizationId === 'org-x' ? null : EVIDENCE),
    });
    assert.equal(plan.items.length, 0);
    assert.deepEqual(plan.notBankable, [noDomain, noClaims, noEvidence]);
  });

  it('sin macro industria ⇒ nada al banco', () => {
    const plan = planApolloBankDeposit({
      countryCode: 'CO',
      macroIndustryKey: null,
      sourceBatchId: 'b1',
      capped: [capped()],
      evidenceFor: () => EVIDENCE,
    });
    assert.equal(plan.items.length, 0);
    assert.equal(plan.notBankable.length, 1);
  });
});

describe('readApolloBankEvidence', () => {
  it('ida y vuelta: lo guardado reconstruye la MISMA organización que la búsqueda', () => {
    const [item] = planApolloBankDeposit({
      countryCode: 'CO',
      macroIndustryKey: 'technology',
      sourceBatchId: 'b1',
      capped: [capped()],
      evidenceFor: () => EVIDENCE,
    }).items;
    const stored = JSON.parse(JSON.stringify(item.payload)) as Record<string, unknown>;
    const evidence = readApolloBankEvidence({ sourceProvider: 'apollo', payload: stored });
    assert.ok(evidence);
    assert.deepEqual(evidence, EVIDENCE);
    const original = toRawDiscoveredOrganization(apolloResult('org-1', 'Alfa Tech', 'alfatech.co'), 1);
    const rebuilt = toRawDiscoveredOrganization(fromCandidateEvidenceSnapshot(evidence), 1);
    assert.deepEqual(rebuilt, original);
    assert.equal(apolloEvidenceKeyForCapped(capped()), `apollo:${original.providerOrganizationId}`);
  });

  it('formato desconocido, otro proveedor, sin nombre o sin dominio ⇒ null', () => {
    assert.equal(readApolloBankEvidence({ sourceProvider: 'apollo', payload: { kind: 'x', evidence: EVIDENCE } }), null);
    assert.equal(readApolloBankEvidence({ sourceProvider: 'lusha', payload: { kind: APOLLO_BANK_PAYLOAD_KIND, evidence: EVIDENCE } }), null);
    assert.equal(readApolloBankEvidence({ sourceProvider: 'apollo', payload: { kind: APOLLO_BANK_PAYLOAD_KIND, evidence: { ...EVIDENCE, domain: null } } }), null);
    assert.equal(readApolloBankEvidence({ sourceProvider: 'apollo', payload: { kind: APOLLO_BANK_PAYLOAD_KIND, evidence: { ...EVIDENCE, title: 7 } } }), null);
    assert.equal(readApolloBankEvidence({ sourceProvider: 'apollo', payload: { kind: APOLLO_BANK_PAYLOAD_KIND, evidence: [] } }), null);
  });

  it('tipos basura en campos opcionales se vuelven vacíos, no se propagan', () => {
    const evidence = readApolloBankEvidence({
      sourceProvider: 'apollo',
      payload: { kind: APOLLO_BANK_PAYLOAD_KIND, evidence: { title: 'X', domain: 'x.co', keywords: 'no-lista', employee_count: 'mil' } },
    });
    assert.ok(evidence);
    assert.deepEqual(evidence.keywords, []);
    assert.equal(evidence.employee_count, null);
  });
});

describe('mergeBankOrganizations', () => {
  const key = (o: { name: string }) => o.name;
  it('sin banco, la lista de Apollo sale idéntica', () => {
    const fresh = [{ name: 'a', providerRank: 1 }, { name: 'b', providerRank: 2 }];
    assert.deepEqual(mergeBankOrganizations([], fresh, key), fresh);
  });
  it('el banco va primero y Apollo se desplaza; si Apollo la trae, gana la copia fresca', () => {
    const bank = [{ name: 'x', providerRank: 1 }, { name: 'b', providerRank: 2 }];
    const fresh = [{ name: 'a', providerRank: 1 }, { name: 'b', providerRank: 2 }];
    assert.deepEqual(mergeBankOrganizations(bank, fresh, key), [
      { name: 'x', providerRank: 1 },
      { name: 'a', providerRank: 2 },
      { name: 'b', providerRank: 3 },
    ]);
  });
});

describe('planBankSettlement', () => {
  it('escrita ⇒ asignada · recortada otra vez ⇒ devuelta · lo demás ⇒ invalidada', () => {
    const items = planBankSettlement({
      batchId: 'lote',
      drawn: [
        { bankId: '1', domain: 'a.co' },
        { bankId: '2', domain: 'b.co' },
        { bankId: '3', domain: 'c.co' },
      ],
      persistedCandidateIdByDomain: new Map([['a.co', 'cand-a']]),
      cappedDomains: new Set(['b.co']),
    });
    assert.deepEqual(items, [
      { id: '1', outcome: 'assigned', batchId: 'lote', candidateId: 'cand-a' },
      { id: '2', outcome: 'released' },
      { id: '3', outcome: 'invalidated', reason: 'not_admitted_on_redraw' },
    ]);
  });
});

describe('interruptor', () => {
  it('ausente ⇒ banco encendido; 1/true/yes ⇒ apagado', () => {
    assert.equal(isCompanyBankDisabled({}), false);
    assert.equal(isCompanyBankDisabled({ AGENT1_COMPANY_BANK_DISABLED: '0' }), false);
    for (const v of ['1', 'true', 'YES', ' yes ']) {
      assert.equal(isCompanyBankDisabled({ AGENT1_COMPANY_BANK_DISABLED: v }), true, v);
    }
  });
});
