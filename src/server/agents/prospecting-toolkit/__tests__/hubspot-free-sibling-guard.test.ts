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
  hubSpotBrandCore,
  isSameCompanyHubSpotRecord,
  isSameHubSpotBrand,
  hubSpotDomainRoot,
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

describe('mismo grupo en otro país (decisión de la dueña 17-11)', () => {
  type Side = { name: string; domain?: string | null };
  // Casos reales de Prod: la filial libre ↔ el cliente del mismo grupo en HubSpot.
  const SAME_BRAND: Array<[Side, Side]> = [
    [{ name: 'Falabella Argentina', domain: 'falabella.com.ar' }, { name: 'Falabella Retail Colombia', domain: 'falabella.com.co' }],
    [{ name: 'Inchcape Chile', domain: 'inchcape.cl' }, { name: 'INCHCAPE GLOBAL BUSINESS SERVICES SAS', domain: 'inchcape.com' }],
    [{ name: 'Itaú', domain: 'itau.com.ar' }, { name: 'Itaú Paraguay', domain: 'https://www.itau.com.py/' }],
    [{ name: 'Sodexo Chile', domain: 'sodexo.cl' }, { name: 'Sodexo México', domain: 'sodexo.com.mx' }],
    // Dos o más palabras: basta la marca, aunque no haya dominio.
    [{ name: 'Zurich Santander Chile' }, { name: 'Zurich Santander México' }],
    [{ name: 'Laboratorios Bagó Argentina' }, { name: 'Laboratorios Bago Peru' }],
  ];
  for (const [free, client] of SAME_BRAND) {
    it(`«${free.name}» es del mismo grupo que «${client.name}»`, () => assert.equal(isSameHubSpotBrand(free, client), true));
  }

  // Parecidos reales que NO son el mismo grupo.
  const DIFFERENT: Array<[Side, Side]> = [
    // Marca de una palabra común sin la misma raíz de dominio (falsos positivos vistos en Prod).
    [{ name: 'ALFA Group', domain: 'alfagroup.cl' }, { name: 'Alfa Co SAC', domain: 'alfaco.pe' }],
    [{ name: 'Grupo Medical', domain: 'grupomedical.cl' }, { name: 'MEDICAL CORPORATION GROUP', domain: 'medicalcorp.com' }],
    [{ name: 'Sodexo Chile', domain: 'sodexo.cl' }, { name: 'Sodexo México', domain: null }],
    [{ name: 'Caja Los Andes' }, { name: 'Universidad de los Andes' }],
    [{ name: 'Caja Los Andes' }, { name: 'Banco Caja Social' }],
    [{ name: 'Banco Ciudad' }, { name: 'Clínica Ciudad del Mar Chile' }],
    [{ name: 'Clínica Alemana' }, { name: 'Clínica Las Condes' }],
    [{ name: 'AFP Capital' }, { name: 'Engen Capital' }],
    [{ name: 'Inchcape Chile', domain: 'inchcape.cl' }, { name: 'Inchcape MACAM', domain: 'inchcape.com' }],
    [{ name: 'Mutual de Seguridad' }, { name: 'Grupo Mutual' }],
    [{ name: 'EL NORTE - Compañía de Seguros S.A.' }, { name: 'Clínica General del Norte' }],
    [{ name: 'Axon Pharma CHILE' }, { name: 'Pint Pharma Chile SPA' }],
  ];
  for (const [free, other] of DIFFERENT) {
    it(`«${free.name}» NO es del mismo grupo que «${other.name}»`, () => assert.equal(isSameHubSpotBrand(free, other), false));
  }

  it('la raíz del dominio quita sufijos genéricos y de país', () => {
    assert.equal(hubSpotDomainRoot('www.falabella.com.co'), 'falabella');
    assert.equal(hubSpotDomainRoot('https://itau.com.py/personas'), 'itau');
    assert.equal(hubSpotDomainRoot('shop.sodexo.cl'), 'sodexo');
  });

  it('la marca quita país, forma jurídica y palabras genéricas', () => {
    assert.equal(hubSpotBrandCore('Falabella Retail Colombia'), 'falabella');
    assert.equal(hubSpotBrandCore('Grupo Domex, S.A. de C.V. República Dominicana'), 'domex');
    assert.equal(hubSpotBrandCore('Grupo Chile S.A.'), null);
  });

  it('un cliente del mismo grupo bloquea; un dato distinto de «cliente» no', () => {
    const block = findBlockingHubSpotSibling([
      sibling({ relation: 'group_client', name: 'Falabella México', availability: { free: false, reason: 'customer' } }),
    ]);
    assert.equal(block?.kind, 'taken');
    assert.match(describeHubSpotSiblingBlock(block!), /El mismo grupo en HubSpot \(«Falabella México»\) es cliente/);
    assert.equal(
      findBlockingHubSpotSibling([sibling({ relation: 'group_client', availability: { free: false, reason: 'active_owner' } })]),
      null,
    );
  });
});

describe('verificador de duplicados: el freno está conectado', () => {
  const source = readFileSync(join(__dirname, '..', 'hubspot-duplicate-checker.ts'), 'utf8');

  it('mira las fichas hermanas antes de marcar libre', () => {
    assert.match(source, /if \(availability\?\.free\) \{\s*const block = await findHubSpotSiblingBlock/);
  });

  it('busca clientes del mismo grupo (etapa Cliente o Current Customer)', () => {
    assert.match(source, /searchClientsByBrandWord/);
    assert.match(source, /hs_current_customer/);
    assert.match(source, /relation: 'group_client'/);
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
