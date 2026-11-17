/**
 * FEEDBACK 17-11 — «SellUp está trayendo de HubSpot empresas que ya son clientes».
 *
 *   1. La copia libre (reciclada / en bolsa) de una empresa NO se ofrece si otra ficha
 *      de la misma empresa, o su empresa madre, es cliente.
 *   2. El verificador comercial reconoce la etapa «Cliente» real del portal
 *      (`1443029400`); `customer` es «Forecast».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildHubSpotSiblingBlockMatch,
  describeHubSpotSiblingBlock,
  findBlockingHubSpotSibling,
  isSameCompanyHubSpotRecord,
  type HubSpotSiblingVerdict,
} from '../hubspot-free-sibling-guard';
import { classifyHubSpotCommercialMatch, type HubSpotExtendedCompanyMatch } from '../hubspot-commercial-checker';

const FREE = { free: true, reason: 'recycled' } as const;

function sibling(overrides: Partial<HubSpotSiblingVerdict>): HubSpotSiblingVerdict {
  return { id: '2', name: 'Pintuco', relation: 'same_company', availability: FREE, ...overrides };
}

describe('isSameCompanyHubSpotRecord', () => {
  const target = { names: ['Pintuco S.A.', 'PINTUCO'], domain: 'pintuco.com.co' };

  it('mismo dominio ⇒ misma empresa', () => {
    assert.equal(isSameCompanyHubSpotRecord({ name: 'Otra razón', domain: 'www.pintuco.com.co', website: null }, target), true);
  });

  it('el sitio web apunta al mismo dominio ⇒ misma empresa', () => {
    assert.equal(
      isSameCompanyHubSpotRecord({ name: 'X', domain: null, website: 'https://pintuco.com.co/contacto' }, target),
      true,
    );
  });

  it('nombre normalizado exacto sin dominio ⇒ misma empresa (la ficha cliente sin dominio)', () => {
    assert.equal(isSameCompanyHubSpotRecord({ name: 'Pintuco', domain: null, website: null }, target), true);
  });

  it('un nombre sólo parecido NO es la misma empresa', () => {
    assert.equal(isSameCompanyHubSpotRecord({ name: 'Pintuco Ecuador Distribuciones', domain: 'pintuco.ec', website: null }, target), false);
  });
});

describe('findBlockingHubSpotSibling', () => {
  it('otra ficha de la misma empresa es cliente ⇒ bloquea', () => {
    const block = findBlockingHubSpotSibling([sibling({ availability: { free: false, reason: 'customer' } })]);
    assert.deepEqual(block, { kind: 'taken', id: '2', name: 'Pintuco', relation: 'same_company', reason: 'customer' });
    assert.match(describeHubSpotSiblingBlock(block!), /Otra ficha de la misma empresa en HubSpot .* es cliente/);
  });

  it('otra ficha a nombre de un vendedor activo ⇒ bloquea', () => {
    const block = findBlockingHubSpotSibling([sibling({ availability: { free: false, reason: 'active_owner' } })]);
    assert.equal(block?.kind, 'taken');
  });

  it('la empresa madre es cliente ⇒ bloquea', () => {
    const block = findBlockingHubSpotSibling([
      sibling({ relation: 'parent', name: 'Codelco', availability: { free: false, reason: 'customer' } }),
    ]);
    assert.equal(block?.kind, 'taken');
    assert.match(describeHubSpotSiblingBlock(block!), /La empresa madre en HubSpot \(«Codelco»\) es cliente/);
  });

  it('la empresa madre sólo tiene dueño activo ⇒ NO bloquea a la filial', () => {
    const block = findBlockingHubSpotSibling([
      sibling({ relation: 'parent', availability: { free: false, reason: 'active_owner' } }),
    ]);
    assert.equal(block, null);
  });

  it('una hermana que no se pudo leer ⇒ no se ofrece (no verificada)', () => {
    const block = findBlockingHubSpotSibling([sibling({ availability: null })]);
    assert.equal(block?.kind, 'unverified');
  });

  it('prefiere el motivo conocido sobre «no verificada»', () => {
    const block = findBlockingHubSpotSibling([
      sibling({ id: '3', availability: null }),
      sibling({ id: '4', availability: { free: false, reason: 'customer' } }),
    ]);
    assert.equal(block?.kind, 'taken');
    assert.equal(block?.id, '4');
  });

  it('todas las hermanas libres o ninguna ⇒ la ficha sigue libre', () => {
    assert.equal(findBlockingHubSpotSibling([sibling({})]), null);
    assert.equal(findBlockingHubSpotSibling([]), null);
  });

  it('la constancia del bloqueo se lee como «ya existe en HubSpot»', () => {
    const match = buildHubSpotSiblingBlockMatch(
      { kind: 'taken', id: '2', name: 'Pintuco', relation: 'same_company', reason: 'customer' },
      '1',
    );
    assert.equal(match.status, 'existing_in_hubspot');
    assert.equal(match.source, 'hubspot');
    assert.equal(match.hubspotFreeToTake, undefined);
  });
});

describe('verificador de duplicados: el freno está conectado', () => {
  const source = readFileSync(join(__dirname, '..', 'hubspot-duplicate-checker.ts'), 'utf8');

  it('mira las fichas hermanas antes de marcar libre', () => {
    assert.match(source, /if \(availability\?\.free\) \{\s*const block = await findHubSpotSiblingBlock/);
  });

  it('pide la empresa madre a HubSpot', () => {
    assert.match(source, /'hs_parent_company_id'/);
  });

  it('una búsqueda de hermanas que falla deja la ficha como no verificada', () => {
    assert.match(source, /return \{ kind: 'unverified', id: null, name: null, relation: null \}/);
  });
});

describe('classifyHubSpotCommercialMatch — etapas reales del portal de UBITS', () => {
  function company(overrides: Partial<HubSpotExtendedCompanyMatch>): HubSpotExtendedCompanyMatch {
    return {
      hubspotCompanyId: '1',
      name: 'Pintuco',
      domain: 'pintuco.com.co',
      nit: null,
      lifecycleStage: null,
      leadStatus: null,
      ownerId: null,
      lastMeetingDate: null,
      lastActivityDate: null,
      numberOfEmployees: null,
      numberOfDeals: null,
      matchMethod: 'domain',
      matchConfidence: 92,
      commercialStatus: 'unknown',
      recyclableReason: null,
      ...overrides,
    };
  }

  it('«Cliente» (1443029400) ⇒ cliente, bloqueada', () => {
    const r = classifyHubSpotCommercialMatch({ company: company({ lifecycleStage: '1443029400' }), matchMethod: 'domain' });
    assert.equal(r.hubspotMatchStatus, 'exact_match_customer');
    assert.equal(r.commercialStatus, 'customer');
  });

  it('estado de lead «Customer» ⇒ cliente', () => {
    const r = classifyHubSpotCommercialMatch({ company: company({ leadStatus: 'Customer' }), matchMethod: 'domain' });
    assert.equal(r.commercialStatus, 'customer');
  });

  it('`customer` es «Forecast» ⇒ prospecto activo, nunca reciclable', () => {
    const r = classifyHubSpotCommercialMatch({ company: company({ lifecycleStage: 'customer' }), matchMethod: 'domain' });
    assert.equal(r.commercialStatus, 'active_prospect');
    assert.equal(r.recyclableStatus, 'not_recyclable');
  });
});
