/**
 * AGENT1-CUT3B23 · CUT-3B2 — contrato COMPARTIDO de evidencia de identidad.
 *
 * Lo que se fija aquí: cada señal significa una cosa distinta, ninguna se
 * fabrica, y la autoridad de cada una es la que YA existe en el repositorio
 * (CUT-3B1 para lo fiscal, `normalization` para dominio y LinkedIn,
 * `canonical-company-identity` para el nombre débil).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompanyIdentityEvidence,
  buildProviderEntityKey,
  hasNoStrongIdentitySignal,
} from '../company-identity-evidence';

describe('CUT-3B2 — identidad fiscal delegada en la autoridad de CUT-3B1', () => {
  it('compone la clave con ÁMBITO de país y canonicaliza la representación', () => {
    const evidence = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      taxIdentifier: 'NIT 900.123.456-7',
      name: 'Acme S.A.S.',
    });

    assert.equal(evidence.fiscalIdentityKey, 'CO:900123456');
    assert.equal(evidence.countryNamespace, 'CO');
  });

  it('sin país NO hay identidad fiscal: un identificador desnudo no es único', () => {
    const evidence = buildCompanyIdentityEvidence({ taxIdentifier: '900123456' });
    assert.equal(evidence.fiscalIdentityKey, null);
    assert.equal(evidence.countryNamespace, null);
  });

  it('el mismo identificador en países distintos produce claves DISTINTAS', () => {
    const co = buildCompanyIdentityEvidence({ countryCode: 'CO', taxIdentifier: '900123456' });
    const mx = buildCompanyIdentityEvidence({ countryCode: 'MX', taxIdentifier: '900123456' });
    assert.equal(co.fiscalIdentityKey, 'CO:900123456');
    assert.equal(mx.fiscalIdentityKey, 'MX:900123456');
    assert.notEqual(co.fiscalIdentityKey, mx.fiscalIdentityKey);
  });

  it('las dos columnas compatibles que canonicalizan igual resuelven una identidad', () => {
    const evidence = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      taxId: '900123456',
      taxIdentifier: '900.123.456-7',
    });
    assert.equal(evidence.fiscalIdentityKey, 'CO:900123456');
  });

  it('dos columnas compatibles que se CONTRADICEN fallan cerrado (sin identidad)', () => {
    const evidence = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      taxId: '900123456',
      taxIdentifier: '800987654',
    });
    assert.equal(evidence.fiscalIdentityKey, null);
  });

  it('un identificador demasiado corto no se convierte en clave pobre', () => {
    const evidence = buildCompanyIdentityEvidence({ countryCode: 'CO', taxIdentifier: '12' });
    assert.equal(evidence.fiscalIdentityKey, null);
  });
});

describe('CUT-3B2 — dominio', () => {
  it('normaliza protocolo, www y path', () => {
    const evidence = buildCompanyIdentityEvidence({ domain: 'https://www.Example.com/co' });
    assert.equal(evidence.normalizedDomain, 'example.com');
  });

  it('cae al website cuando no hay columna de dominio', () => {
    const evidence = buildCompanyIdentityEvidence({ website: 'https://acme.com/nosotros' });
    assert.equal(evidence.normalizedDomain, 'acme.com');
  });

  it('sin dominio ni website queda null, nunca una cadena vacía', () => {
    assert.equal(buildCompanyIdentityEvidence({ name: 'Acme' }).normalizedDomain, null);
  });
});

describe('CUT-3B2 — LinkedIn: sólo EMPRESA', () => {
  it('normaliza una URL de empresa', () => {
    const evidence = buildCompanyIdentityEvidence({
      linkedinUrl: 'https://www.linkedin.com/company/Acme/?trk=x',
    });
    assert.equal(evidence.normalizedLinkedInCompany, 'linkedin.com/company/acme');
  });

  it('RECHAZA un perfil PERSONAL: nunca entra como identidad de empresa', () => {
    const evidence = buildCompanyIdentityEvidence({
      linkedinUrl: 'https://www.linkedin.com/in/juan-perez',
    });
    assert.equal(evidence.normalizedLinkedInCompany, null);
  });
});

describe('CUT-3B2 — identidad de proveedor: el namespace es la defensa', () => {
  it('lleva el proveedor DENTRO de la clave', () => {
    assert.equal(
      buildProviderEntityKey({ providerKey: 'Lusha', providerEntityId: ' 12345 ' }),
      'lusha:12345',
    );
  });

  it('el MISMO valor de id en dos proveedores produce claves distintas', () => {
    const apollo = buildProviderEntityKey({ providerKey: 'apollo', providerEntityId: '7' });
    const lusha = buildProviderEntityKey({ providerKey: 'lusha', providerEntityId: '7' });
    assert.equal(apollo, 'apollo:7');
    assert.equal(lusha, 'lusha:7');
    assert.notEqual(apollo, lusha);
  });

  it('sin proveedor no hay clave: un id desnudo no es comparable', () => {
    assert.equal(buildProviderEntityKey({ providerEntityId: '7' }), null);
    assert.equal(buildProviderEntityKey({ providerKey: 'lusha' }), null);
  });
});

describe('CUT-3B2 — nombre canónico: evidencia DÉBIL', () => {
  it('canonicaliza quitando el sufijo legal', () => {
    assert.equal(
      buildCompanyIdentityEvidence({ name: 'Acme S.A.S.' }).canonicalName,
      'acme',
    );
  });

  it('una frase de categoría no es nombre de empresa', () => {
    assert.equal(
      buildCompanyIdentityEvidence({ name: 'SaaS y plataformas' }).canonicalName,
      null,
    );
  });
});

describe('CUT-3B2 — ausencia de señal fuerte se DECLARA, no se rellena', () => {
  it('un candidato sin fiscal, dominio, proveedor ni LinkedIn se reconoce como tal', () => {
    const evidence = buildCompanyIdentityEvidence({ name: 'Acme', countryCode: 'CO' });
    assert.equal(hasNoStrongIdentitySignal(evidence), true);
    assert.equal(evidence.canonicalName, 'acme');
  });

  it('con dominio ya hay señal fuerte', () => {
    const evidence = buildCompanyIdentityEvidence({ name: 'Acme', domain: 'acme.com' });
    assert.equal(hasNoStrongIdentitySignal(evidence), false);
  });
});
