/**
 * AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — qué reclama un candidato, puro.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveGlobalIdentityClaims } from '../global-identity-claims';
import type { CompanyIdentityEvidence } from '../company-identity-evidence';

function evidence(overrides: Partial<CompanyIdentityEvidence> = {}): CompanyIdentityEvidence {
  return {
    countryNamespace: null,
    fiscalIdentityKey: null,
    normalizedDomain: null,
    providerEntityKey: null,
    normalizedLinkedInCompany: null,
    canonicalName: null,
    ...overrides,
  };
}

describe('§ 1 — precedencia fiscal > dominio', () => {
  it('con identidad fiscal, reclama fiscal y NO reclama el dominio', () => {
    const claims = deriveGlobalIdentityClaims(
      evidence({ fiscalIdentityKey: 'CO:900123456', normalizedDomain: 'acme.com' }),
    );
    assert.deepEqual(claims, [{ type: 'fiscal', key: 'CO:900123456' }]);
  });

  it('🔴 sin identidad fiscal, el dominio SÍ se reclama (mejor señal disponible)', () => {
    const claims = deriveGlobalIdentityClaims(evidence({ normalizedDomain: 'acme.com' }));
    assert.deepEqual(claims, [{ type: 'domain', key: 'acme.com' }]);
  });
});

describe('§ 2 — proveedor y LinkedIn se reclaman siempre que estén, sin conflicto con fiscal/dominio', () => {
  it('fiscal + proveedor + linkedin ⇒ tres reclamos', () => {
    const claims = deriveGlobalIdentityClaims(
      evidence({
        fiscalIdentityKey: 'CO:900123456',
        providerEntityKey: 'lusha:99',
        normalizedLinkedInCompany: 'linkedin.com/company/acme',
      }),
    );
    assert.deepEqual(claims, [
      { type: 'fiscal', key: 'CO:900123456' },
      { type: 'provider_entity', key: 'lusha:99' },
      { type: 'linkedin', key: 'linkedin.com/company/acme' },
    ]);
  });

  it('sólo proveedor (sin fiscal ni dominio) ⇒ un único reclamo', () => {
    const claims = deriveGlobalIdentityClaims(evidence({ providerEntityKey: 'apollo:42' }));
    assert.deepEqual(claims, [{ type: 'provider_entity', key: 'apollo:42' }]);
  });
});

describe('§ 3 — sin ninguna señal fuerte, no hay nada que reclamar', () => {
  it('evidencia vacía ⇒ []', () => {
    assert.deepEqual(deriveGlobalIdentityClaims(evidence()), []);
  });

  it('sólo nombre canónico (evidencia débil) ⇒ [] — TIER 5 nunca reclama', () => {
    assert.deepEqual(deriveGlobalIdentityClaims(evidence({ canonicalName: 'acme inc' })), []);
  });
});
