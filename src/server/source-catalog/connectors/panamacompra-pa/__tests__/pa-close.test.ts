/**
 * SOURCES-PA-CLOSE-1 — RUC, nombres, dominios, filas de carga, resolvedor y capa
 * gratuita de Panamá. Cero E/S. Los nombres y RUC de empresas reales salen de
 * fuentes públicas (PanamaCompraEnCifras, lista de Grandes Contribuyentes de la DGI
 * publicada en la Gaceta Oficial 30271-A).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalPanamaRuc, parsePanamaRuc } from '../pa-ruc';
import {
  endsWithPanamaLegalForm,
  isPanamaPublicEntityCore,
  panamaCandidateNameVariants,
  panamaNameCore,
  panamaPublicEntityKey,
  panamaRegistryAliasKeys,
} from '../pa-name-keys';
import {
  isPanamaPersonalEmailDomain,
  panamaCompanyDomainFromEmailDomain,
  panamaSingleWordConfirmedByDomain,
  registrablePanamaDomain,
} from '../pa-domain';
import {
  buildPaFreeDirectoryRow,
  buildPaRucNameAliasRows,
  buildPaRucRegistryRow,
  mergePanamaRucSources,
  paEntryAliasKeys,
  paOwnNameKeys,
  paPreferredLegalName,
  parsePaBuyer,
  parsePaLargeTaxpayer,
  parsePaSupplier,
  PA_FREE_DIRECTORY_MIN_AWARDED_PAB,
  type PaRucEntry,
  type PaSupplier,
} from '../pa-sources-rows';
import { normalizePanamaCompanyCore } from '../pa-panamacompra-ruc-rows';
import { CENTRAL_AMERICA_LEGAL_FORMS, normalizeCompanyNameCore } from '../../../company-name-core';
import { guatemalaNameCore } from '../../gt-guatecompras/gt-name-keys';
import {
  createPanamaOfficialSourceResolver,
  type PanamaNameRow,
} from '@/server/agents/prospect-intake/resolvers/panama-official-source-resolver';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  buildPaFreeDirectoryDiscoveryAdapter,
  PA_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type PaFreeDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/pa-free-directory-discovery-adapter';
import {
  macroHasPaCoverage,
  resolvePaDirectoryMacro,
} from '@/server/prospect-batches/country-source-discovery/pa-free-directory-macro-table';
import {
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '@/server/prospect-batches/country-source-discovery/country-source-capability';
import { getSourceFamily } from '../../../record-identity/source-family-registry';

const read = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8');

describe('RUC de Panamá', () => {
  it('sociedad: tomo-folio-asiento, sin DV (RUC reales de la lista de la DGI)', () => {
    assert.equal(canonicalPanamaRuc('155641197-2-2016'), '155641197-2-2016');
    assert.equal(canonicalPanamaRuc('280-134-61098'), '280-134-61098');
    assert.deepEqual(parsePanamaRuc('280-319-61818 D.V.53'), { ruc: '280-319-61818', dv: '53', publicEntity: false });
    assert.deepEqual(parsePanamaRuc('11524-2-115657-78'), { ruc: '11524-2-115657', dv: '78', publicEntity: false });
    assert.equal(canonicalPanamaRuc('0000015344-0041-0148061'), '15344-41-148061');
  });

  it('entidad pública: provincia-NT-tomo-asiento (Caja de Seguro Social, Banco Nacional)', () => {
    assert.deepEqual(parsePanamaRuc('8-NT-2-4249-8'), { ruc: '8-NT-2-4249', dv: '8', publicEntity: true });
    assert.equal(canonicalPanamaRuc('8-NT-1-12541-40'), '8-NT-1-12541');
    assert.equal(canonicalPanamaRuc('8-NT-01-12761'), '8-NT-1-12761');
  });

  it('sociedad antigua con tomo corto: sólo si la fuente sólo trae sociedades (DGI) o ya está cargada', () => {
    assert.equal(parsePanamaRuc('82-30-15216'), null);
    assert.deepEqual(parsePanamaRuc('82-30-15216', { allowShortTomo: true }), { ruc: '82-30-15216', dv: null, publicEntity: false });
    assert.equal(canonicalPanamaRuc('44-242-5856'), '44-242-5856');
    const { entries, excluded } = mergePanamaRucSources({
      suppliers: [supplier({ ruc: '82-30-15216', name: 'NESTLE PANAMA S A' })],
      buyers: [],
      largeTaxpayers: [{ ruc: '82-30-15216', name: 'NESTLE PANAMA S A' }],
    });
    assert.equal(excluded['panamacompra_supplier']?.invalid_ruc, 1);
    assert.ok(entries.get('82-30-15216')?.largeTaxpayer);
    assert.equal(entries.get('82-30-15216')?.supplier, null);
  });

  it('nunca cédulas de personas naturales, relleno ni basura', () => {
    for (const raw of ['0008-0123-0456', '6-716-267-22', 'E-8-96362', 'PE-9-1606', '000-2-2015', '2--0-111', '02', '---', 'Sin Rut', null]) {
      assert.equal(parsePanamaRuc(raw), null, String(raw));
    }
  });
});

describe('núcleo del nombre (por estructura, sólo al final)', () => {
  it('formas escritas de cualquier manera', () => {
    const cases: Array<[string, string]> = [
      ['Constructora Urbana S.-A.', 'CONSTRUCTORA URBANA'],
      ['Cable Onda, S..A.', 'CABLE ONDA'],
      ['PINTURAS GARANTIZADAS. S,A', 'PINTURAS GARANTIZADAS'],
      ['CERVECERIA NACIONAL S. DE R.L.', 'CERVECERIA NACIONAL'],
      ['Liberty Services Corporation', 'LIBERTY SERVICES'],
      ['MULTIBANK .INC', 'MULTIBANK'],
      ['GEO F. NOVEY INC', 'GEO F NOVEY'],
      ['COCHEZ Y CIA, S.A.', 'COCHEZ'],
      ['EMPRESAS MELO, S. A.', 'EMPRESAS MELO'],
      ['DESARROLLOS DEL ISTMO, SOCIEDA ANOMINA', 'DESARROLLOS DEL ISTMO'],
      ['HSBC BANK USA, SUCURSAL DE PANAMA', 'HSBC BANK USA'],
      ['FUNDACION PANAMA VERDE, FUNDACION DE INTERES PRIVADO', 'FUNDACION PANAMA VERDE'],
    ];
    for (const [name, core] of cases) assert.equal(panamaNameCore(name), core, name);
  });

  it('la sigla o el nombre comercial final salen del núcleo y quedan como alias', () => {
    assert.equal(panamaNameCore('COMPAÑÍA PANAMEÑA DE AVIACIÓN, S. A.(COPA AIRLINES'), 'COMPANIA PANAMENA DE AVIACION');
    assert.deepEqual(panamaRegistryAliasKeys('COMPAÑÍA PANAMEÑA DE AVIACIÓN, S. A.(COPA AIRLINES'), ['COPA AIRLINES']);
    assert.deepEqual(panamaRegistryAliasKeys('Universidad Santa María La Antigua (USMA)'), ['USMA']);
    assert.deepEqual(panamaRegistryAliasKeys('DISTRIBUIDORA ISOL, S.A. (DAISOL) S.A.'), ['DAISOL']);
    assert.equal(panamaNameCore('Consultores Electrotecnicos y Contratistas, S.A. ('), 'CONSULTORES ELECTROTECNICOS Y CONTRATISTAS');
  });

  it('nombre comercial corto tras la forma: núcleo = razón social, alias = el nombre', () => {
    assert.equal(panamaNameCore('SERVICIOS Y SOLUCIONES TECNOLOGICAS, S.A SERVITEC'), 'SERVICIOS Y SOLUCIONES TECNOLOGICAS');
    assert.deepEqual(panamaRegistryAliasKeys('SERVICIOS Y SOLUCIONES TECNOLOGICAS, S.A SERVITEC'), ['SERVITEC']);
    assert.deepEqual(panamaRegistryAliasKeys('Professional Development Center INC PDCI'), ['PDCI']);
    // Un enlace tras la forma no es un nombre comercial.
    assert.equal(panamaNameCore('INVERSIONES S A DE PANAMA'), 'INVERSIONES S A DE PANAMA');
  });

  it('nada de alias para país o lengua, ni para consorcios', () => {
    assert.deepEqual(panamaRegistryAliasKeys('DIGICEL (PANAMA) S.A.'), []);
    assert.deepEqual(panamaRegistryAliasKeys('MEDITEC, S.A. (ESPAÑOL)MEDITEC INC. (INGLES)'), []);
    assert.deepEqual(panamaRegistryAliasKeys('CONSORCIO VIAL (CVP)'), []);
  });

  it('un nombre que es SÓLO la forma no tiene núcleo', () => {
    assert.equal(panamaNameCore('S.A.'), '');
    assert.equal(panamaNameCore('Sociedad Anónima'), '');
    assert.equal(panamaNameCore(null), '');
  });

  it('endsWithPanamaLegalForm', () => {
    assert.equal(endsWithPanamaLegalForm('Banistmo, S.A.'), true);
    assert.equal(endsWithPanamaLegalForm('Banistmo'), false);
  });

  it('la limpieza compartida de Centroamérica (Guatemala, Honduras) NO cambia', () => {
    assert.equal(normalizeCompanyNameCore('COCHEZ Y CIA, S.A.', CENTRAL_AMERICA_LEGAL_FORMS), 'COCHEZ Y CIA');
    assert.equal(normalizePanamaCompanyCore('Liberty Services Corporation'), 'LIBERTY SERVICES');
    assert.equal(guatemalaNameCore('COFIÑO STAHL Y COMPAÑÍA, S.A.'), 'COFINO STAHL');
  });
});

describe('entidades públicas', () => {
  it('clave pública: alcaldía = municipio, sin palabras de enlace', () => {
    assert.equal(panamaPublicEntityKey('MUNICIPIO DE SAN MIGUELITO'), 'MUNICIPIO SAN MIGUELITO');
    assert.equal(panamaPublicEntityKey('Alcaldía de San Miguelito'), 'MUNICIPIO SAN MIGUELITO');
    assert.equal(panamaPublicEntityKey('Alcaldía del Distrito de Panamá'), 'MUNICIPIO PANAMA');
    assert.equal(panamaPublicEntityKey('Ministerio de Salud'), 'MINISTERIO SALUD');
    assert.equal(panamaPublicEntityKey('Copa Airlines'), null);
    assert.equal(isPanamaPublicEntityCore('CAJA DE SEGURO SOCIAL'), true);
    assert.equal(isPanamaPublicEntityCore('UNIVERSIDAD LATINA DE PANAMA'), false);
  });
});

describe('variantes del nombre del candidato', () => {
  const cores = (name: string) => panamaCandidateNameVariants(name).map((v) => `${v.core}/${v.origin}`);

  it('con y sin «Panamá»; el núcleo de siempre primero', () => {
    assert.deepEqual(cores('Sonda Panamá'), ['SONDA PANAMA/name', 'SONDA/without_panama', 'SONDA DE PANAMA/with_panama']);
    assert.deepEqual(cores('Copa Airlines'), ['COPA AIRLINES/name', 'COPA AIRLINES PANAMA/with_panama', 'COPA AIRLINES DE PANAMA/with_panama']);
  });

  it('una entidad pública nunca pierde «de Panamá» y prueba su clave pública', () => {
    assert.deepEqual(cores('Municipio de Panamá'), ['MUNICIPIO DE PANAMA/name', 'MUNICIPIO PANAMA/public']);
    assert.deepEqual(cores('Alcaldía de San Miguelito'), ['ALCALDIA DE SAN MIGUELITO/name', 'MUNICIPIO SAN MIGUELITO/public']);
  });

  it('partes separadas por guion o barra', () => {
    assert.equal(cores('Más Móvil - Cable & Wireless Panamá, S.A.').includes('CABLE&WIRELESS PANAMA/part'), true);
  });
});

describe('dominio web desde el correo registrado (sólo el dominio)', () => {
  it('corporativo → dominio registrable', () => {
    assert.equal(panamaCompanyDomainFromEmailDomain('ventas.grupomelo.com.pa'), 'grupomelo.com.pa');
    assert.equal(panamaCompanyDomainFromEmailDomain('compras@cochezycia.com'), 'cochezycia.com');
    assert.equal(registrablePanamaDomain('a.b.copaair.com'), 'copaair.com');
  });

  it('gratuitos, proveedores de internet, universidades y Estado → nada', () => {
    for (const domain of ['gmail.com', 'hotmail.es', 'hotmial.com', 'yahoo.com.mx', 'cwpanama.net', 'cableonda.net', 'utp.ac.pa', 'up.edu.pa', 'css.gob.pa', null, '']) {
      assert.equal(panamaCompanyDomainFromEmailDomain(domain), null, String(domain));
    }
    assert.equal(isPanamaPersonalEmailDomain('sinfo.net'), true);
  });

  it('una palabra: la web confirma sólo si su etiqueta es esa palabra', () => {
    assert.equal(panamaSingleWordConfirmedByDomain('www.banistmo.com', 'BANISTMO', { publicEntity: false }), true);
    assert.equal(panamaSingleWordConfirmedByDomain('banistmo-pa.com', 'BANISTMO', { publicEntity: false }), false);
    assert.equal(panamaSingleWordConfirmedByDomain('idaan.gob.pa', 'IDAAN', { publicEntity: false }), false);
    assert.equal(panamaSingleWordConfirmedByDomain('idaan.gob.pa', 'IDAAN', { publicEntity: true }), true);
  });
});

function supplier(overrides: Partial<PaSupplier> = {}): PaSupplier {
  return {
    ruc: '30394-2-238626',
    name: 'CABLE ONDA, S.A.',
    names: [],
    tradeName: null,
    ampyme: false,
    emailDomain: 'cableonda.com.pa',
    awards: 40,
    awardedPab: 2_500_000,
    buyers: 12,
    lastYear: 2025,
    region: null,
    fam: { '4321': 2_000_000, '8111': 100_000 },
    ...overrides,
  };
}

function entry(overrides: Partial<PaRucEntry> = {}): PaRucEntry {
  return { ruc: '30394-2-238626', dv: null, publicEntity: false, supplier: supplier(), buyer: null, largeTaxpayer: null, ...overrides };
}

const params = { sourceYear: 2026, importedAt: '2026-10-07T00:00:00.000Z' };

describe('líneas de los extractores', () => {
  it('proveedora: sólo familias UNSPSC de 4 dígitos y montos positivos', () => {
    const parsed = parsePaSupplier({ ruc: '1-2-3', name: ' X  S.A. ', fam: { '4321': 10, '43': 5, '8111': -1 }, ampyme: true, email_domain: 'x.com' });
    assert.deepEqual(parsed?.fam, { '4321': 10 });
    assert.equal(parsed?.name, 'X S.A.');
    assert.equal(parsed?.ampyme, true);
    assert.equal(parsePaSupplier({ name: 'sin ruc' }), null);
  });

  it('entidad y Gran Contribuyente', () => {
    assert.equal(parsePaBuyer({ ruc: '8-NT-2-4249-8', name: 'CAJA DE SEGURO SOCIAL', area: 'INSTITUCIONES DESCENTRALIZADAS' })?.area, 'INSTITUCIONES DESCENTRALIZADAS');
    assert.equal(parsePaLargeTaxpayer({ ruc: '280-134-61098' }), null);
  });
});

describe('unión por RUC', () => {
  it('cédulas fuera; un RUC NT sólo vale como entidad compradora; el DV se conserva', () => {
    const { entries, excluded } = mergePanamaRucSources({
      suppliers: [supplier({ ruc: '30394-2-238626-12' }), supplier({ ruc: '8-123-456' }), supplier({ ruc: '8-NT-2-4249' })],
      buyers: [{ ruc: '8-NT-2-4249-8', name: 'CAJA DE SEGURO SOCIAL', area: 'INSTITUCIONES DESCENTRALIZADAS', region: 'Panamá' }],
      largeTaxpayers: [{ ruc: '30394-2-238626', name: 'CABLE ONDA S A' }],
    });
    assert.equal(entries.size, 2);
    assert.equal(entries.get('30394-2-238626')?.dv, '12');
    assert.ok(entries.get('30394-2-238626')?.largeTaxpayer);
    assert.equal(entries.get('8-NT-2-4249')?.publicEntity, true);
    assert.equal(excluded['panamacompra_supplier']?.invalid_ruc, 1);
    assert.equal(excluded['panamacompra_supplier']?.public_ruc_not_buyer, 1);
  });

  it('razón social: la del buscador si coincide con la de la DGI (que es OCR); si no, la de la DGI', () => {
    assert.equal(paPreferredLegalName(entry({ largeTaxpayer: { ruc: 'x', name: 'CABLE ONDA S A' } })), 'CABLE ONDA, S.A.');
    assert.equal(paPreferredLegalName(entry({ supplier: supplier({ name: 'CW PANAMA' }), largeTaxpayer: { ruc: 'x', name: 'CABLE & WIRELESS PANAMA S A' } })), 'CABLE & WIRELESS PANAMA S A');
  });
});

describe('pa_ruc_registry y pa_ruc_name_alias', () => {
  it('fila del registro con el Gran Contribuyente para el filtro de tamaño', () => {
    const row = buildPaRucRegistryRow(entry({ largeTaxpayer: { ruc: '30394-2-238626', name: 'CABLE ONDA S A' } }), params)!;
    assert.equal(row.source_key, 'pa_ruc_registry');
    assert.equal(row.normalized_legal_name, 'CABLE ONDA');
    assert.deepEqual(row.raw_data['origins'], ['panamacompra_supplier', 'dgi_large_taxpayer']);
    assert.equal(row.raw_data['taxpayer_category'], 'PA_GRAN_CONTRIBUYENTE');
    assert.equal(row.record_identity_key, 'tax:30394-2-238626');
    // Nunca correos ni personas en la fila.
    assert.equal(JSON.stringify(row).includes('@'), false);
  });

  it('el Gran Contribuyente llega al filtro como «gran contribuyente» sin número de personas (no decide solo)', () => {
    const row = buildPaRucRegistryRow(entry({ largeTaxpayer: { ruc: 'x', name: 'CABLE ONDA S A' } }), params)!;
    const workforce = workforceFromRawData(row.raw_data, 'pa_dgi_large_taxpayers');
    assert.deepEqual(workforce, { workers: 0, year: 2023, source: 'pa_dgi_large_taxpayers', maxWorkers: null, sizeBand: 'gran contribuyente (DGI Panamá)' });
    assert.equal(workforceFromRawData(buildPaRucRegistryRow(entry(), params)!.raw_data, 'x'), null);
  });

  it('alias: otros nombres y siglas, nunca el núcleo propio', () => {
    const copa = entry({
      ruc: '130-377-34706',
      supplier: supplier({ ruc: '130-377-34706', name: 'COMPAÑÍA PANAMEÑA DE AVIACIÓN, S. A.(COPA AIRLINES', tradeName: 'COPA AIRLINES' }),
    });
    const row = buildPaRucRegistryRow(copa, params)!;
    const keys = paEntryAliasKeys(copa, row.normalized_legal_name);
    assert.deepEqual(keys, ['COPA AIRLINES']);
    const aliases = buildPaRucNameAliasRows({ registryRow: row, keys });
    assert.equal(aliases[0].source_key, 'pa_ruc_name_alias');
    assert.equal(aliases[0].record_identity_key, 'pa-name-alias:130-377-34706:COPA AIRLINES');
    const mit = entry({ ruc: '42169-52-286856', supplier: null, largeTaxpayer: { ruc: '42169-52-286856', name: 'MANZANILLO INTERNATIONAL TERMINAL PMA SA' } });
    assert.deepEqual(paEntryAliasKeys(mit, 'MANZANILLO INTERNATIONAL TERMINAL PMA'), ['MANZANILLO INTERNATIONAL TERMINAL PANAMA', 'MANZANILLO INTERNATIONAL TERMINAL']);
    assert.deepEqual(paOwnNameKeys({ legal_name: 'MUNICIPIO DE ARRAIJAN', normalized_legal_name: 'MUNICIPIO DE ARRAIJAN' }), ['MUNICIPIO DE ARRAIJAN', 'MUNICIPIO ARRAIJAN']);
  });
});

describe('pa_free_directory (capa gratuita)', () => {
  const why = (e: PaRucEntry) => {
    const result = buildPaFreeDirectoryRow(e, { ...params, sharedDomains: new Set() });
    return 'excluded' in result ? result.excluded : 'row';
  };

  it('relevancia aprobada: Gran Contribuyente, entidad con RUC o ≥ B/.1 millón adjudicado', () => {
    assert.equal(PA_FREE_DIRECTORY_MIN_AWARDED_PAB, 1_000_000);
    assert.equal(why(entry({ supplier: supplier({ awardedPab: 999_999 }) })), 'not_relevant');
    assert.equal(why(entry({ supplier: supplier({ awardedPab: 1_000_000 }) })), 'row');
    assert.equal(why(entry({ supplier: supplier({ name: 'CONSORCIO VIAL NORTE' }) })), 'consortium');
    assert.equal(why(entry({ supplier: supplier({ fam: { '9010': 100 } }) })), 'no_dominant_macro');
    assert.equal(why(entry({ supplier: supplier({ fam: {} }), largeTaxpayer: { ruc: 'x', name: 'CABLE ONDA S A' } })), 'no_dominant_macro');
  });

  it('proveedora: macro por UNSPSC, web del correo (salvo dominio compartido), sin correos', () => {
    const result = buildPaFreeDirectoryRow(entry(), { ...params, sharedDomains: new Set() });
    assert.ok('row' in result);
    const raw = result.row.raw_data;
    assert.equal(raw['directory_kind'], 'panamacompra_supplier');
    assert.equal(raw['activity_code'], '4321');
    assert.equal(raw['macro_industry_key'], resolvePaDirectoryMacro('panamacompra_supplier', '4321'));
    assert.equal(raw['website_domain'], 'cableonda.com.pa');
    const shared = buildPaFreeDirectoryRow(entry(), { ...params, sharedDomains: new Set(['cableonda.com.pa']) });
    assert.ok('row' in shared);
    assert.equal(shared.row.raw_data['website_domain'], undefined);
  });

  it('entidad compradora con RUC → Gobierno, primero en el orden, sin web del correo', () => {
    const result = buildPaFreeDirectoryRow(
      entry({
        ruc: '8-NT-2-4249',
        publicEntity: true,
        supplier: null,
        buyer: { ruc: '8-NT-2-4249', name: 'CAJA DE SEGURO SOCIAL', area: 'INSTITUCIONES DESCENTRALIZADAS', region: 'Panamá' },
      }),
      { ...params, sharedDomains: new Set() },
    );
    assert.ok('row' in result);
    assert.equal(result.row.raw_data['macro_industry_key'], 'government');
    assert.equal(result.row.priority_score >= 1_000_000, true);
    assert.equal(result.row.raw_data['website_domain'], undefined);
  });
});

function candidate(name: string, domain: string | null = null, countryCode = 'PA'): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode, domain, websiteUrl: null },
    criteria: { countryCode },
  } as unknown as OfficialSourceResolverInput;
}

function resolverWith(rows: Record<string, PanamaNameRow[]>) {
  const asked: string[] = [];
  const resolver = createPanamaOfficialSourceResolver({
    querySnapshots: async (core) => {
      asked.push(core);
      return rows[core] ?? [];
    },
  });
  return { resolver, asked };
}

describe('resolvedor de RUC por nombre (pa_ruc_registry)', () => {
  it('un RUC con ese núcleo → fuerte; el tamaño «gran contribuyente» viaja', async () => {
    const workforce = { workers: 0, year: 2023, source: 'pa_dgi_large_taxpayers', maxWorkers: null, sizeBand: 'gran contribuyente (DGI Panamá)' };
    const { resolver } = resolverWith({
      'CERVECERIA NACIONAL': [{ taxId: '155641197-2-2016', legalName: 'CERVECERIA NACIONAL S. DE R.L.', normalizedLegalName: 'CERVECERIA NACIONAL', workforce }],
    });
    const result = await resolver.resolve(candidate('Cervecería Nacional'));
    assert.equal(result.status, 'matched');
    assert.equal(result.sourceKey, 'pa_ruc_registry');
    assert.equal(result.taxIdentifier, '155641197-2-2016');
    assert.equal(result.taxIdentifierType, 'RUC');
    assert.deepEqual(result.workforce, workforce);
  });

  it('alias y variante sin «Panamá»: el mismo RUC por dos filas sigue siendo uno', async () => {
    const { resolver, asked } = resolverWith({
      SONDA: [
        { taxId: '1412728-1-1473', legalName: 'SONDA , S.A.', normalizedLegalName: 'SONDA' },
        { taxId: '1412728-1-1473', legalName: 'SONDA , S.A.', normalizedLegalName: 'SONDA', alias: true },
      ],
    });
    const result = await resolver.resolve(candidate('Sonda Panamá'));
    assert.equal(result.status, 'matched');
    assert.deepEqual(asked, ['SONDA PANAMA', 'SONDA']);
    assert.equal(result.safeMetadata?.['nameVariant'], 'without_panama');
  });

  it('Copa Airlines por su alias', async () => {
    const { resolver } = resolverWith({
      'COPA AIRLINES': [{ taxId: '130-377-34706', legalName: 'COMPAÑÍA PANAMEÑA DE AVIACIÓN, S. A.', normalizedLegalName: 'COPA AIRLINES', alias: true }],
    });
    const result = await resolver.resolve(candidate('Copa Airlines'));
    assert.equal(result.status, 'matched');
    assert.equal(result.legalName, 'COMPAÑÍA PANAMEÑA DE AVIACIÓN, S. A.');
    assert.equal(result.safeMetadata?.['matchedAlias'], true);
  });

  it('dos RUC distintos → pista, nunca fuerte (p. ej. un RUC en la DGI y otro en PanamaCompra)', async () => {
    const { resolver } = resolverWith({
      'PETROLEOS DELTA': [
        { taxId: '11524-2-115657', legalName: 'PETROLEOS DELTA S A', normalizedLegalName: 'PETROLEOS DELTA' },
        { taxId: '12909-233-127655', legalName: 'PETROLEOS DELTA, S.A.', normalizedLegalName: 'PETROLEOS DELTA' },
      ],
    });
    const result = await resolver.resolve(candidate('Petróleos Delta'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['candidateCount'], 2);
  });

  it('una palabra: pista sin web; fuerte si la web lo confirma', async () => {
    const rows = { BANISTMO: [{ taxId: '633197-1-456744', legalName: 'BANISTMO, S.A.', normalizedLegalName: 'BANISTMO' }] };
    const { resolver } = resolverWith(rows);
    assert.equal((await resolver.resolve(candidate('Banistmo'))).status, 'low_confidence_match');
    assert.equal((await resolver.resolve(candidate('Banistmo', 'banistmo.com'))).status, 'matched');
    assert.equal((await resolver.resolve(candidate('Banistmo, S.A.'))).status, 'matched');
  });

  it('sólo Panamá; nada encontrado → not_found con el núcleo buscado', async () => {
    const { resolver } = resolverWith({});
    assert.equal(resolver.canResolve(candidate('Banco General', null, 'CR')), false);
    const result = await resolver.resolve(candidate('Banco General'));
    assert.equal(result.status, 'not_found');
    assert.equal(result.safeMetadata?.['normalizedSearchName'], 'BANCO GENERAL');
  });
});

function directoryRow(overrides: Partial<PaFreeDirectorySnapshotReadRow> = {}): PaFreeDirectorySnapshotReadRow {
  return {
    record_identity_key: 'tax:30394-2-238626',
    ruc: '30394-2-238626',
    legal_name: 'CABLE ONDA, S.A.',
    normalized_legal_name: 'CABLE ONDA',
    city: null,
    region: null,
    directory_kind: 'panamacompra_supplier',
    activity_code: '4321',
    public_entity_area: null,
    website_domain: 'cableonda.com.pa',
    official_size_band: null,
    priority_score: 12040,
    ...overrides,
  };
}

describe('adaptador de la capa gratuita de Panamá', () => {
  const macro = resolvePaDirectoryMacro('panamacompra_supplier', '4321')!;

  it('cableado: Panamá tiene capa gratuita y su cobertura sale de SU tabla', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('PA'));
    assert.deepEqual(resolveCountrySourceCapability(' pa '), { countryCode: 'PA', sourceKey: PA_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY });
    assert.equal(countrySourceMacroHasCoverage('PA', 'government'), true);
    assert.equal(countrySourceMacroHasCoverage('PA', macro), macroHasPaCoverage(macro));
    assert.match(read('src/server/prospect-batches/country-source-discovery/prepaid-novelty-gate.server.ts'), /paFreeDirectoryDiscoveryReads: buildPaFreeDirectoryDiscoveryReads\(adminClient\)/);
  });

  it('ofrece con RUC, web y rubro; la macro de HOY manda; un RUC una vez', async () => {
    const asked: Array<{ macroIndustryKey: string; limit: number }> = [];
    const adapter = buildPaFreeDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async (input) => {
        asked.push(input);
        return [
          directoryRow(),
          directoryRow({ record_identity_key: 'tax:dup' }),
          directoryRow({ ruc: '1-2-3', record_identity_key: 'tax:1-2-3', activity_code: '9999' }),
          directoryRow({ ruc: '02', record_identity_key: 'tax:junk' }),
          directoryRow({ ruc: '280-134-61098', record_identity_key: 'tax:280-134-61098', official_size_band: 'large', website_domain: 'gmail' }),
        ];
      },
    });
    const result = await adapter({ countryCode: 'PA', macroIndustryKey: macro, limit: 500 } as never);
    assert.equal(asked[0].limit, 200);
    assert.equal(result.sourceKey, 'pa_free_directory_discovery');
    assert.deepEqual(result.companies.map((c) => c.taxId), ['30394-2-238626', '280-134-61098']);
    const [first, second] = result.companies;
    assert.equal(first.taxIdentifierType, 'RUC');
    assert.equal(first.domain, 'cableonda.com.pa');
    assert.equal(first.industryCode, '4321');
    assert.equal(first.officialSizeBand, undefined);
    assert.deepEqual(second.officialSizeBand, { band: 'large', sourceLabel: 'DGI – Grandes Contribuyentes' });
    assert.equal(second.domain, null);
  });

  it('entidad pública: sólo para Gobierno, con su área como industria', async () => {
    const adapter = buildPaFreeDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async () => [
        directoryRow({ ruc: '8-NT-2-4249', directory_kind: 'public_entity', activity_code: '8-NT-2-4249', public_entity_area: 'INSTITUCIONES DESCENTRALIZADAS', legal_name: 'CAJA DE SEGURO SOCIAL', website_domain: null }),
      ],
    });
    const result = await adapter({ countryCode: 'PA', macroIndustryKey: 'government', limit: 10 } as never);
    assert.equal(result.companies[0].taxId, '8-NT-2-4249');
    assert.equal(result.companies[0].declaredIndustry, 'INSTITUCIONES DESCENTRALIZADAS');
  });

  it('macro sin cobertura → no consulta', async () => {
    let called = false;
    const adapter = buildPaFreeDirectoryDiscoveryAdapter({ readCompaniesByMacro: async () => { called = true; return []; } });
    const result = await adapter({ countryCode: 'PA', macroIndustryKey: 'no_such_macro', limit: 10 } as never);
    assert.equal(called, false);
    assert.equal(result.companies.length, 0);
  });
});

describe('cableado y familias de fuente', () => {
  it('la fábrica usa el resolvedor de Panamá con su lectura (registro + alias)', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /createPanamaOfficialSourceResolver\(\{\s*querySnapshots: buildPanamaSnapshotNameQuery\(snapshotClient\),\s*\}\)/);
    assert.doesNotMatch(wiring, /PA_PANAMACOMPRA_RUC_SOURCE_KEY/);
    const query = read('src/server/prospect-batches/panama-snapshot-query.ts');
    assert.match(query, /\.in\('source_key', \[PA_RUC_REGISTRY_SOURCE_KEY, PA_RUC_NAME_ALIAS_SOURCE_KEY\]\)/);
    assert.doesNotMatch(query, /\.(insert|update|upsert|delete)\(/);
  });

  it('grano: un RUC una fila en registro y directorio; varias claves por RUC en alias', () => {
    assert.equal(getSourceFamily('pa_ruc_registry'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('pa_free_directory'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('pa_ruc_name_alias'), 'NATIVE_RECORD_GRAIN');
  });
});
