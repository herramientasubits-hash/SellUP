/**
 * «Agregar empresa» no deja entrar basura: sin sitio web ni NIT no se agrega, lo que ya
 * es cliente o lo trabaja otro en HubSpot tampoco, y lo reciclable se vincula.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideManualAccountHubSpot,
  manualAccountIdentityError,
  MANUAL_ACCOUNT_MESSAGES,
} from '../manual-account-checks';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('manualAccountIdentityError', () => {
  it('sin dominio ni NIT no se puede agregar', () => {
    assert.equal(manualAccountIdentityError({ domain: null, taxIdentifier: '  ' }), MANUAL_ACCOUNT_MESSAGES.missingIdentity);
  });

  it('con uno de los dos basta', () => {
    assert.equal(manualAccountIdentityError({ domain: 'empresa.com', taxIdentifier: null }), null);
    assert.equal(manualAccountIdentityError({ domain: null, taxIdentifier: '900123456' }), null);
  });
});

describe('decideManualAccountHubSpot', () => {
  const match = { hubspotCompanyId: 'hs-1' };

  it('sin coincidencia se crea sin aviso', () => {
    assert.deepEqual(decideManualAccountHubSpot({ hubspotMatchStatus: 'no_match', match: null }), {
      kind: 'create',
      notice: null,
    });
  });

  it('un cliente de HubSpot no se agrega como prospecto', () => {
    const decision = decideManualAccountHubSpot({ hubspotMatchStatus: 'exact_match_customer', match });
    assert.equal(decision.kind, 'block');
  });

  it('un prospecto activo de otro no se agrega', () => {
    const decision = decideManualAccountHubSpot({ hubspotMatchStatus: 'exact_match_prospect_active', match });
    assert.equal(decision.kind, 'block');
  });

  it('un reciclable o ex cliente se vincula, no se duplica', () => {
    for (const status of ['exact_match_prospect_recyclable', 'exact_match_ex_customer'] as const) {
      assert.deepEqual(decideManualAccountHubSpot({ hubspotMatchStatus: status, match }), {
        kind: 'link',
        hubspotCompanyId: 'hs-1',
        notice: MANUAL_ACCOUNT_MESSAGES.hubspotLinked,
      });
    }
  });

  it('parecida o sin respuesta: se crea sin vincular y con aviso', () => {
    for (const status of ['possible_match_requires_review', 'hubspot_lookup_failed', 'not_attempted'] as const) {
      const decision = decideManualAccountHubSpot({ hubspotMatchStatus: status, match: null });
      assert.equal(decision.kind, 'create');
      assert.ok(decision.kind === 'create' && decision.notice);
    }
  });
});

describe('el drawer «Agregar empresa»', () => {
  const drawer = readFileSync(join(HERE, '..', '..', '..', 'components', 'accounts', 'create-account-drawer.tsx'), 'utf8');
  const actions = readFileSync(join(HERE, '..', 'actions.ts'), 'utf8');

  it('usa la acción con revisión de duplicados, no createAccount directo', () => {
    assert.ok(drawer.includes('addAccountManually('));
    assert.ok(!drawer.includes('createAccount('));
  });

  it('la acción revisa SellUp y HubSpot antes de crear', () => {
    const fn = actions.slice(actions.indexOf('export async function addAccountManually('));
    const create = fn.indexOf('createAccount(input)');
    assert.ok(fn.indexOf('manualAccountIdentityError(') < create);
    assert.ok(fn.indexOf('findExistingAccountForCandidate(') < create);
    assert.ok(fn.indexOf('checkHubSpotCompanyCommercialStatus(') < create);
  });
});
