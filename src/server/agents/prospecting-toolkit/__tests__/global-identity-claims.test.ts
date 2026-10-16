/**
 * AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — qué reclama un candidato, puro.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveGlobalIdentityClaimEnvelope, deriveGlobalIdentityClaims } from '../global-identity-claims';
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

describe('§ 2 — proveedor siempre; LinkedIn exclusivo sólo sin identidad fiscal', () => {
  // 🔴 AGENT1-CLAIMS-LINKEDIN-SUBSIDIARIES-1 — esta prueba fijaba el DEFECTO: con
  // NIT también se reclamaba el LinkedIn en exclusiva, y una filial con NIT propio
  // a la que la fuente daba el LinkedIn de la matriz chocaba con ella. Ahora con
  // fiscal el LinkedIn viaja como señal de CRUCE (`identityLinkedIn`, migración
  // 152), con la excepción de fiscal distinta.
  it('fiscal + proveedor + linkedin ⇒ fiscal y proveedor exclusivos; LinkedIn como cruce', () => {
    const input = evidence({
      fiscalIdentityKey: 'CO:900123456',
      providerEntityKey: 'lusha:99',
      normalizedLinkedInCompany: 'linkedin.com/company/acme',
    });
    assert.deepEqual(deriveGlobalIdentityClaims(input), [
      { type: 'fiscal', key: 'CO:900123456' },
      { type: 'provider_entity', key: 'lusha:99' },
    ]);
    assert.equal(
      deriveGlobalIdentityClaimEnvelope(input).identityLinkedIn,
      'linkedin.com/company/acme',
    );
  });

  it('sin fiscal: dominio + proveedor + linkedin ⇒ tres reclamos', () => {
    const claims = deriveGlobalIdentityClaims(
      evidence({
        normalizedDomain: 'acme.com',
        providerEntityKey: 'lusha:99',
        normalizedLinkedInCompany: 'linkedin.com/company/acme',
      }),
    );
    assert.deepEqual(claims, [
      { type: 'domain', key: 'acme.com' },
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
