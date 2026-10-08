/**
 * SOURCES-SV-CLOSE-1 — El Salvador «estándar México»: NIT y verificador, núcleo del
 * nombre por estructura, persona natural o entidad, alias, variantes, web de las
 * instituciones, filas de las cuatro claves, tabla de palabras de COMPRASAL,
 * resolvedor de NIT y tramo de contribuyente en el filtro de tamaño. Nombres reales
 * de los listados de Hacienda, del Portal de Transparencia y de COMPRASAL (medidos el
 * 07-10-2026). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatSalvadoranNit, isValidSalvadoranNitCheckDigit, normalizeSalvadoranNit } from '../sv-nit';
import {
  classifySalvadorTaxpayerName,
  endsWithSalvadorLegalForm,
  salvadorCandidateNameVariants,
  salvadorNameCore,
  salvadorPublicEntityKey,
  salvadorRegistryAliasKeys,
} from '../sv-name-keys';
import {
  salvadorDomainNamesEntity,
  salvadorPublicEntityDomain,
  salvadorSingleWordConfirmedByDomain,
} from '../sv-domain';
import {
  aggregateSvComprasalSuppliers,
  buildSvComprasalDirectoryRow,
  buildSvNitNameAliasRows,
  buildSvNitRegistryRow,
  buildSvPublicEntityRow,
  buildSvRegistryAndAliasRows,
  groupSvTaxListByNit,
  parseSvComprasalAward,
  parseSvTaxListEntry,
  parseSvTransparenciaInstitution,
  svComprasalBuyers,
  svNitAliasKeys,
  svPublicEntityNits,
  svSupersededPublicNits,
  svTransparenciaCandidate,
  svUniqueNitByKey,
  SV_COMPRASAL_DIRECTORY_SOURCE_KEY,
  SV_LARGE_TAXPAYER_CATEGORY,
  SV_MEDIUM_TAXPAYER_CATEGORY,
  SV_NIT_NAME_ALIAS_SOURCE_KEY,
  SV_NIT_REGISTRY_SOURCE_KEY,
  SV_PUBLIC_ENTITIES_SOURCE_KEY,
  type SvComprasalAward,
  type SvSnapshotRow,
  type SvTaxListEntry,
} from '../sv-sources-rows';
import {
  isSvComprasalRelevant,
  macroHasSvCoverage,
  resolveSvComprasalSupplierMacro,
  resolveSvDirectoryMacro,
  resolveSvProcessRule,
  SV_COMPRASAL_MACRO_TABLE_APPROVED,
} from '@/server/prospect-batches/country-source-discovery/sv-comprasal-macro-table';
import {
  createSalvadorOfficialSourceResolver,
  type SalvadorNameRow,
} from '@/server/agents/prospect-intake/resolvers/salvador-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { getTaxIdentifierRule, validateTaxIdentifier } from '@/modules/prospect-batches/tax-identifier-rules';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';

const importedAt = '2026-10-07T00:00:00.000Z';

function entry(partial: Partial<SvTaxListEntry> & Pick<SvTaxListEntry, 'list' | 'nit' | 'name'>): SvTaxListEntry {
  const years: Record<string, number> = {
    dgii_large_2019: 2019,
    hacienda_large_2012: 2012,
    hacienda_medium_2012: 2012,
  };
  return {
    year: years[partial.list] ?? 2014,
    section: null,
    parent: null,
    municipality: null,
    department: null,
    regime: null,
    ...partial,
  };
}

function registryRow(entries: SvTaxListEntry[]): SvSnapshotRow {
  const result = buildSvNitRegistryRow(entries, { importedAt });
  assert.ok('row' in result, JSON.stringify(result));
  return result.row;
}

// ─── NIT ───────────────────────────────────────────────────────────────────

describe('NIT de El Salvador', () => {
  it('acepta NIT reales de los dos tramos del correlativo (≤ 100 y > 100)', () => {
    // Asamblea Legislativa (correlativo 002), 3M El Salvador (102), alcaldía de Ahuachapán (001).
    for (const nit of ['06140101120025', '06142410901022', '01010106110010']) {
      assert.equal(isValidSalvadoranNitCheckDigit(nit), true, nit);
    }
    assert.equal(normalizeSalvadoranNit('0614-010112-002-5'), '06140101120025');
    assert.equal(formatSalvadoranNit('06140101120025'), '0614-010112-002-5');
  });

  it('rechaza un verificador equivocado o una forma rota', () => {
    assert.equal(normalizeSalvadoranNit('0614-010112-002-6'), null);
    assert.equal(normalizeSalvadoranNit('0614-010112-002'), null);
    assert.equal(normalizeSalvadoranNit(null), null);
  });

  it('regla de importación SV-NIT-v1 (sólo forma, como Honduras)', () => {
    assert.equal(getTaxIdentifierRule('SV')?.ruleVersion, 'SV-NIT-v1');
    assert.equal(validateTaxIdentifier('0614-010112-002-5', 'SV').normalized, '06140101120025');
    assert.equal(validateTaxIdentifier('0614-010112', 'SV').valid, false);
  });
});

// ─── Nombres ───────────────────────────────────────────────────────────────

describe('núcleo del nombre salvadoreño', () => {
  it('quita la forma por su estructura, también apilada', () => {
    const cases: Array<[string, string]> = [
      ['3M EL SALVADOR, S.A. DE C.V.', '3M EL SALVADOR'],
      ['ABDALA-MILIAN, S. A. DE C. V.', 'ABDALA MILIAN'],
      ['" CSH COMERCIAL, S. A. DE. C. V. , "', 'CSH COMERCIAL'],
      ['ACCESO FINANCIERO, LTDA. DE C.V.', 'ACCESO FINANCIERO'],
      ['ACACES DE R. L.', 'ACACES'],
      ['AES CLESA Y COMPAÑIA, S. EN C. DE C. V.', 'AES CLESA'],
      ['AES DISTRIBUIDORES SALVADOREÑOS Y CIA., S. EN C. DE C.V.', 'AES DISTRIBUIDORES SALVADORENOS'],
      ['ALBA PETROLEOS DE EL SALVADOR, S. E. M. DE C. V.', 'ALBA PETROLEOS DE EL SALVADOR'],
      ['AEROVIAS DEL CONTINENTE AMERICANO, SOCIEDAD ANONIMA SUCURSAL EL SALVADOR', 'AEROVIAS DEL CONTINENTE AMERICANO'],
      ['ALBACROME SOCIEDAD ANONIMA DE CAPITAL VARIABLE', 'ALBACROME'],
      ['" INDUSTRIAS ALIMENTICIAS KERN\'S DE EL SALVADOR , S.A. DE C.V."', 'INDUSTRIAS ALIMENTICIAS KERNS DE EL SALVADOR'],
      ['TEXTILES LA PAZ L L C', 'TEXTILES LA PAZ'],
      ['Bioarquitectura S.A de C.V', 'BIOARQUITECTURA'],
      ['LA CENTRO AMERICANA, S.A.', 'LA CENTROAMERICANA'],
      ['MONTAJES ELECTROMECANICOS DE C.A., S.A. DE C.V.', 'MONTAJES ELECTROMECANICOS DE CENTROAMERICA'],
      ['MONTAJES ELECTROMECÁNICOS DE CENTROAMÉRICA S.A. DE C.V.', 'MONTAJES ELECTROMECANICOS DE CENTROAMERICA'],
      ['NIPRO MEDICAL CORPORATION SUC EL SALVADOR', 'NIPRO MEDICAL CORPORATION'],
      ['INDRA SOLUCIONES TECNOLOGÍAS DE LA INFORMACIÓN, S.L.U.', 'INDRA SOLUCIONES TECNOLOGIAS DE LA INFORMACION'],
      ['SERVICIOS BURSATILES SALVADOREÑOS, S.A. DE C.V., PUESTO DE BOLSA DE PRODUCTOS Y SERVICIOS', 'SERVICIOS BURSATILES SALVADORENOS'],
    ];
    for (const [name, core] of cases) assert.equal(salvadorNameCore(name), core, name);
  });

  it('la sigla entre paréntesis sale del núcleo y queda como alias', () => {
    const name = 'Administracion Nacional de Acuaductos y Alcantarillados (ANDA)';
    assert.equal(salvadorNameCore(name), 'ADMINISTRACION NACIONAL DE ACUADUCTOS Y ALCANTARILLADOS');
    assert.ok(salvadorRegistryAliasKeys(name).includes('ANDA'));
    assert.ok(salvadorRegistryAliasKeys('COMERCIAL TECNICA INTERNACIONAL, S.A. DE C.V. (CTI, S.A. DE C.V.)').includes('CTI'));
    assert.deepEqual(salvadorRegistryAliasKeys('Fideicomiso de Obligaciones Previsionales (FOB)'), []);
  });

  it('reconoce la forma al final', () => {
    assert.equal(endsWithSalvadorLegalForm('ACACYCPNC, DE R.L.'), true);
    assert.equal(endsWithSalvadorLegalForm('Banco Agrícola'), false);
  });
});

describe('persona natural, entidad o excluido', () => {
  it('las personas naturales nunca son entidad', () => {
    for (const name of ['ACEVEDO BERGANZA GUSTAVO JOSE', 'ANA CRISTINA GALO DE MENDOZA', 'ESTRADA VDA DE IRAHETA MARIA JULIA', 'JOSE ERNESTO PAZ']) {
      assert.equal(classifySalvadorTaxpayerName(name), 'natural_person', name);
    }
  });

  it('siglas, asociaciones y sociedades sin forma son entidad', () => {
    for (const name of [
      'AGEPYM', 'COFARSAL', 'C I D E P', 'ASOC TELETON PRO REHABILITACION', 'COMPASSION INTERNATIONAL INCORPORATED',
      'UMANA & MORALES ABOGADOS', '3M EL SALVADOR, S.A. DE C.V.', 'CITIBANK,N.A.SUCURSAL SAN SALVADOR',
      'PAGADURIA AUXILIAR DEPARTAMENTAL DE EDUCACION LA UNION', 'Multiservicios A y M', 'LG SONIC B.V.',
    ]) {
      assert.equal(classifySalvadorTaxpayerName(name), 'entity', name);
    }
  });

  it('sucesiones, uniones temporales, consorcios y partidos quedan fuera', () => {
    for (const name of ['SUCESION JOSE PEREZ', 'UDP CONSTRUCTORES', 'CONSORCIO VIAL OCCIDENTE', 'PARTIDO DEMOCRATA', 'UNION DE PERSONAS IMPERSAL-PAVESA']) {
      assert.equal(classifySalvadorTaxpayerName(name), 'excluded', name);
    }
  });
});

describe('claves públicas y variantes del candidato', () => {
  it('alcaldía y municipalidad dan la misma clave; ministerio sin enlaces', () => {
    assert.equal(salvadorPublicEntityKey('Alcaldía Municipal de Santa Tecla'), 'ALCALDIA SANTA TECLA');
    assert.equal(salvadorPublicEntityKey('Municipalidad de Santa Tecla'), 'ALCALDIA SANTA TECLA');
    assert.equal(salvadorPublicEntityKey('Ministerio de Salud Pública y Asistencia Social'), 'MINISTERIO SALUD PUBLICA ASISTENCIA SOCIAL');
    assert.equal(
      salvadorPublicEntityKey('Hospital Nacional San Juan de Dios - Santa Ana'),
      salvadorPublicEntityKey('Hospital Nacional San Juan de Dios, Santa Ana'),
    );
    assert.equal(salvadorPublicEntityKey('Banco Agrícola, S.A.'), null);
  });

  it('prueba con y sin «(de) El Salvador»', () => {
    const cores = salvadorCandidateNameVariants('3M').map((v) => v.core);
    assert.deepEqual(cores, ['3M', '3M EL SALVADOR', '3M DE EL SALVADOR']);
    const banco = salvadorCandidateNameVariants('Banco Cuscatlán de El Salvador').map((v) => v.core);
    assert.deepEqual(banco.slice(0, 2), ['BANCO CUSCATLAN DE EL SALVADOR', 'BANCO CUSCATLAN']);
  });

  it('la parte antes de la coma también se prueba («Ministerio de Educación, Ciencia y Tecnología»)', () => {
    const cores = salvadorCandidateNameVariants('Ministerio de Educación, Ciencia y Tecnología').map((v) => v.core);
    assert.ok(cores.includes('MINISTERIO DE EDUCACION'));
    assert.ok(cores.includes('MINISTERIO EDUCACION'));
  });

  it('la clave pública va justo detrás de su variante', () => {
    const variants = salvadorCandidateNameVariants('Alcaldía de Santa Tecla');
    assert.deepEqual(variants.slice(0, 2).map((v) => v.origin), ['name', 'public']);
    assert.equal(variants[1].core, 'ALCALDIA SANTA TECLA');
  });
});

// ─── Web ───────────────────────────────────────────────────────────────────

describe('web de las instituciones', () => {
  it('sólo si la dirección nombra a la entidad', () => {
    assert.equal(salvadorDomainNamesEntity('seguridad.gob.sv', 'Ministerio de Justicia y Seguridad Publica', 'MJSP'), true);
    assert.equal(salvadorDomainNamesEntity('mindel.gob.sv', 'Ministerio de Desarrollo Local', 'MINDEL'), true);
    assert.equal(salvadorDomainNamesEntity('amst.gob.sv', 'Municipalidad de La Libertad Sur', 'LLS'), false);
  });

  it('del portal propio sin el prefijo de servicio; nunca un correo gratuito', () => {
    assert.equal(
      salvadorPublicEntityDomain({ name: 'Asamblea Legislativa', acronym: 'asamblea', siteUrl: 'https://transparencia.asamblea.gob.sv/', emailDomain: 'asamblea.gob.sv' }),
      'asamblea.gob.sv',
    );
    assert.equal(salvadorPublicEntityDomain({ name: 'Alcaldía Municipal de Sesori', acronym: null, siteUrl: null, emailDomain: 'gmail.com' }), null);
  });

  it('una palabra sólo la confirma su propia web', () => {
    assert.equal(salvadorSingleWordConfirmedByDomain('https://www.duralita.com', 'DURALITA', { publicEntity: false }), true);
    assert.equal(salvadorSingleWordConfirmedByDomain('anda.gob.sv', 'ANDA', { publicEntity: false }), false);
    assert.equal(salvadorSingleWordConfirmedByDomain('anda.gob.sv', 'ANDA', { publicEntity: true }), true);
  });
});

// ─── Registro y alias ──────────────────────────────────────────────────────

describe('sv_nit_registry y sv_nit_name_alias', () => {
  it('lee las filas del extractor y descarta un verificador roto', () => {
    assert.equal(parseSvTaxListEntry({ list: 'dgii_large_2019', year: 2019, nit: '06142410901022', name: '3M EL SALVADOR, S.A. DE C.V.' })?.nit, '06142410901022');
    assert.equal(parseSvTaxListEntry({ list: 'dgii_large_2019', year: 2019, nit: '06142410901023', name: 'X, S.A.' }), null);
    assert.equal(parseSvTaxListEntry({ list: 'embajadas', year: 2014, nit: '06142410901022', name: 'X' }), null);
  });

  it('un NIT, una fila: el nombre y el año de la lista de mayor prioridad', () => {
    const row = registryRow([
      entry({ list: 'hacienda_large_2012', nit: '06142410901022', name: '3M EL SALVADOR, S.A. DE C.V.' }),
      entry({ list: 'dgii_large_2019', nit: '06142410901022', name: '3M EL SALVADOR, S.A. DE C.V.' }),
    ]);
    assert.equal(row.source_key, SV_NIT_REGISTRY_SOURCE_KEY);
    assert.equal(row.source_year, 2019);
    assert.equal(row.normalized_legal_name, '3M EL SALVADOR');
    assert.equal(row.record_identity_key, 'tax:06142410901022');
    assert.equal(row.raw_data['taxpayer_category'], SV_LARGE_TAXPAYER_CATEGORY);
    assert.equal(row.raw_data['metrics_year'], 2019);
    assert.deepEqual(row.raw_data['origins'], ['dgii_large_2019', 'hacienda_large_2012']);
  });

  it('el nombre de una entidad pública gana al de la lista de medianos', () => {
    const row = registryRow([
      entry({ list: 'hacienda_medium_2012', nit: '06141101210013', name: 'UNIVERSIDAD DE EL SALVADOR' }),
      entry({ list: 'hacienda_public_2014', nit: '06141101210013', name: 'Universidad de El Salvador ( UES)', section: 'autonoma' }),
    ]);
    assert.equal(row.legal_name, 'Universidad de El Salvador ( UES)');
    assert.equal(row.source_year, 2014);
    // Una institución pública no lleva tramo de contribuyente.
    assert.equal(row.raw_data['taxpayer_category'], undefined);
  });

  it('una sociedad sólo en Medianos 2012 lleva ese tramo con su año', () => {
    const row = registryRow([entry({ list: 'hacienda_medium_2012', nit: '06140506011033', name: 'ALFA TECNOLOGIAS, S.A. DE C.V.' })]);
    assert.equal(row.raw_data['taxpayer_category'], SV_MEDIUM_TAXPAYER_CATEGORY);
    assert.equal(row.raw_data['metrics_year'], 2012);
  });

  it('el NIT viejo de una institución queda reemplazado por el de la lista de entidades 2014', () => {
    const entries = [
      entry({ list: 'hacienda_medium_2012', nit: '06142211901056', name: 'SUPERINTENDENCIA DEL SISTEMA FINANCIERO' }),
      entry({ list: 'hacienda_public_2014', nit: '06140208111017', name: 'Superintendencia del Sistema Financiero (SSF)', section: 'autonoma' }),
    ];
    assert.deepEqual([...svSupersededPublicNits(groupSvTaxListByNit(entries))], ['06142211901056']);
    const { registryRows, excluded } = buildSvRegistryAndAliasRows(entries, { importedAt });
    assert.deepEqual(registryRows.map((r) => r.tax_id), ['06140208111017']);
    assert.equal(excluded.get('superseded_public_nit'), 1);
  });

  it('alias estructurales «AFP X» y «MINISTERIO <primera palabra>»; uno compartido por dos NIT se descarta', () => {
    assert.ok(salvadorRegistryAliasKeys('ADMINISTRADORA DE FONDOS DE PENSIONES CONFIA, S.A.').includes('AFP CONFIA'));
    assert.ok(salvadorRegistryAliasKeys('Ministerio de Salud Pública y Asistencia Social').includes('MINISTERIO SALUD'));
    const { aliasRows } = buildSvRegistryAndAliasRows(
      [
        entry({ list: 'hacienda_public_2014', nit: '06140101021015', name: 'Ministerio de Desarrollo Local' }),
        entry({ list: 'hacienda_public_2014', nit: '06140101110081', name: 'Ministerio de Desarrollo Urbano' }),
        entry({ list: 'hacienda_public_2014', nit: '06140101220032', name: 'Ministerio de Salud Pública y Asistencia Social' }),
      ],
      { importedAt },
    );
    const keys = aliasRows.map((r) => r.normalized_legal_name);
    assert.ok(!keys.includes('MINISTERIO DESARROLLO'));
    assert.ok(keys.includes('MINISTERIO SALUD'));
  });

  it('una persona natural nunca entra (ni por otro nombre del mismo NIT)', () => {
    const result = buildSvNitRegistryRow(
      [
        entry({ list: 'dgii_large_2019', nit: '02132403841014', name: 'ACEVEDO BERGANZA GUSTAVO JOSE' }),
        entry({ list: 'hacienda_large_2012', nit: '02132403841014', name: 'GUSTAVO JOSE ACEVEDO BERGANZA' }),
      ],
      { importedAt },
    );
    assert.deepEqual(result, { excluded: 'natural_person' });
  });

  it('alcaldía con municipio y departamento', () => {
    const row = registryRow([
      entry({ list: 'hacienda_municipality_2014', nit: '01010106110010', name: 'Alcaldía Municipal de Ahuachapán', municipality: 'Ahuachapán', department: 'AHUACHAPAN' }),
    ]);
    assert.equal(row.city, 'Ahuachapán');
    assert.equal(row.region, 'AHUACHAPAN');
    assert.equal(row.raw_data['taxpayer_category'], undefined);
  });

  it('alias: otro nombre, la sigla y la clave pública; nunca el nombre propio', () => {
    const entries = [
      entry({ list: 'hacienda_public_2014', nit: '06142101230059', name: 'Administracion Nacional de Acuaductos y Alcantarillados (ANDA)' }),
      entry({ list: 'dgii_large_2019', nit: '06142101230059', name: 'ADMINISTRACION NACIONAL DE ACUEDUCTOS Y ALCANTARILLADOS' }),
    ];
    const row = registryRow(entries);
    const keys = svNitAliasKeys(entries, row.normalized_legal_name);
    // El nombre de 2019 manda; el de 2014 (con su errata) y la sigla quedan como alias.
    assert.equal(row.normalized_legal_name, 'ADMINISTRACION NACIONAL DE ACUEDUCTOS Y ALCANTARILLADOS');
    assert.ok(keys.includes('ANDA'));
    assert.ok(keys.includes('ADMINISTRACION NACIONAL DE ACUADUCTOS Y ALCANTARILLADOS'));
    assert.ok(!keys.includes(row.normalized_legal_name));
    const aliases = buildSvNitNameAliasRows({ registryRow: row, keys });
    assert.ok(aliases.every((a) => a.source_key === SV_NIT_NAME_ALIAS_SOURCE_KEY && a.tax_id === '06142101230059'));
    assert.ok(aliases.some((a) => a.record_identity_key === 'sv-name-alias:06142101230059:ANDA'));
  });

  it('agrupa por NIT y deja únicos sólo los núcleos de UN NIT', () => {
    const a = registryRow([entry({ list: 'dgii_large_2019', nit: '06142410901022', name: 'ACME, S.A. DE C.V.' })]);
    const b = registryRow([entry({ list: 'hacienda_medium_2012', nit: '06140506011033', name: 'ACME, LTDA. DE C.V.' })]);
    const c = registryRow([entry({ list: 'dgii_large_2019', nit: '12171509881019', name: 'ABDALA-MILIAN, S. A. DE C. V.' })]);
    const unique = svUniqueNitByKey([a, b, c]);
    assert.equal(unique.has('ACME'), false);
    assert.equal(unique.get('ABDALA MILIAN'), '12171509881019');
    assert.equal(groupSvTaxListByNit([...[a, b]].map((r) => entry({ list: 'dgii_large_2019', nit: r.tax_id!, name: r.legal_name }))).size, 2);
  });
});

// ─── Gobierno ──────────────────────────────────────────────────────────────

describe('sv_public_entities', () => {
  const nitByKey = new Map([['MINISTERIO JUSTICIA SEGURIDAD PUBLICA', '06140101071012'], ['HOSPITAL NACIONAL ILOBASCO', '09031006961016']]);

  it('Transparencia con web y NIT por la clave pública', () => {
    const institution = parseSvTransparenciaInstitution({ category_id: 1, id: 15, acronym: 'MJSP', name: 'Ministerio de Justicia y Seguridad Publica', email_domain: 'seguridad.gob.sv', site_url: '' });
    assert.ok(institution);
    const result = buildSvPublicEntityRow(svTransparenciaCandidate(institution), { importedAt, sharedDomains: new Set(), nitByKey });
    assert.ok('row' in result);
    assert.equal(result.row.source_key, SV_PUBLIC_ENTITIES_SOURCE_KEY);
    assert.equal(result.row.tax_id, '06140101071012');
    assert.equal(result.row.raw_data['website_domain'], 'seguridad.gob.sv');
    assert.equal(result.row.raw_data['entity_kind'], 'ministry');
    assert.equal(result.row.record_identity_key, 'sv-public-entity:MINISTERIO JUSTICIA SEGURIDAD PUBLICA');
  });

  it('un hospital con el dominio compartido de Salud entra por su NIT, sin web', () => {
    const candidate = svTransparenciaCandidate({ categoryId: 6, id: 1, acronym: 'HNI', name: 'Hospital Nacional de Ilobasco', emailDomain: 'salud.gob.sv', siteUrl: null });
    const result = buildSvPublicEntityRow(candidate, { importedAt, sharedDomains: new Set(['salud.gob.sv']), nitByKey });
    assert.ok('row' in result);
    assert.equal(result.row.tax_id, '09031006961016');
    assert.equal(result.row.raw_data['website_domain'], undefined);
  });

  it('fuera: alcaldías anteriores a la reforma de 2024, ONG, registros de prueba y sin web ni NIT', () => {
    const shared = { importedAt, sharedDomains: new Set<string>(), nitByKey };
    const cases: Array<[number, string, string | null, string]> = [
      [5, 'Alcaldía Municipal de Sesori', 'gmail.com', 'pre_reform_municipality'],
      [8, 'Iniciativa Social para la Democracia', 'isd.org.sv', 'not_public'],
      [4, 'Prueba y Ejemplo', 'iaip.gob.sv', 'test_record'],
      [10, 'Municipalidad de Chalatenango Norte', 'gmail.com', 'no_website_no_nit'],
    ];
    for (const [categoryId, name, emailDomain, reason] of cases) {
      const result = buildSvPublicEntityRow(svTransparenciaCandidate({ categoryId, id: 1, acronym: null, name, emailDomain, siteUrl: null }), shared);
      assert.deepEqual(result, { excluded: reason }, name);
    }
  });

  it('NIT por la sigla oficial sólo si ese NIT es de una institución pública', () => {
    const byAcronym = new Map([['BANDESAL', '06142209111110']]);
    const candidate = svTransparenciaCandidate({ categoryId: 2, id: 9, acronym: 'BANDESAL', name: 'Banco de Desarrollo de la República de El Salvador', emailDomain: 'bandesal.gob.sv', siteUrl: null });
    const ok = buildSvPublicEntityRow(candidate, { importedAt, sharedDomains: new Set(), nitByKey: byAcronym, publicNits: new Set(['06142209111110']) });
    assert.ok('row' in ok);
    assert.equal(ok.row.tax_id, '06142209111110');
    const noPublic = buildSvPublicEntityRow(candidate, { importedAt, sharedDomains: new Set(), nitByKey: byAcronym, publicNits: new Set() });
    assert.ok('row' in noPublic);
    assert.equal(noPublic.row.tax_id, null);
    const reg = registryRow([entry({ list: 'hacienda_public_2014', nit: '06142209111110', name: 'Banco de Desarrollo de El Salvador (BANDESAL)' })]);
    assert.deepEqual([...svPublicEntityNits([reg])], ['06142209111110']);
  });

  it('las compradoras de COMPRASAL son instituciones vigentes (una por nombre, último año)', () => {
    const awards = [
      award({ id: 1, institution: 'Hospital Nacional de Ilobasco', date: '2025-03-01' }),
      award({ id: 2, institution: 'Hospital Nacional de Ilobasco', date: '2026-02-01' }),
    ];
    const buyers = svComprasalBuyers(awards);
    assert.equal(buyers.length, 1);
    assert.equal(buyers[0].lastYear, 2026);
    const result = buildSvPublicEntityRow(buyers[0], { importedAt, sharedDomains: new Set(), nitByKey });
    assert.ok('row' in result);
    assert.equal(result.row.raw_data['entity_kind'], 'university_or_hospital');
    assert.equal(result.row.source_year, 2026);
  });
});

// ─── COMPRASAL ─────────────────────────────────────────────────────────────

function award(partial: Partial<SvComprasalAward> & { id: number }): SvComprasalAward {
  return {
    supplierId: 17408,
    name: 'Bioarquitectura S.A de C.V',
    tradeName: 'Bioarquitectura',
    amountUsd: 10_000,
    date: '2026-08-28',
    process: 'SERVICIO DE BLINDAJE INSTALACION ELECTRICA',
    institution: 'Hospital Nacional "Enfermera Angélica Vidal de Najarro", San Bartolo (San Salvador)',
    institutionCode: '3216',
    ...partial,
  };
}

describe('tabla de palabras de COMPRASAL (aprobada el 07-10-2026)', () => {
  it('aprobada por la dueña', () => {
    assert.equal(SV_COMPRASAL_MACRO_TABLE_APPROVED, true);
  });

  it('clasifica por lo que se compra; lo que no dice nada queda sin macro', () => {
    const cases: Array<[string, string | null]> = [
      ['ADQUISICION DE MEDICAMENTOS PARA HOSPITALES', 'health_pharma'],
      ['SUMINISTRO DE LICENCIAS DE SOFTWARE', 'technology'],
      ['SERVICIO DE ENLACE DE DATOS E INTERNET', 'technology'],
      ['SERVICIO DE VIGILANCIA PARA OFICINAS', 'services_company'],
      ['PAVIMENTACION DE CALLE EN CANTON', 'property_construction'],
      ['SUMINISTRO DE COMBUSTIBLE PARA FLOTA VEHICULAR', 'energy_mining_environment'],
      ['SEGURO DE VIDA COLECTIVO PARA EMPLEADOS', 'insurance_financial_services'],
      ['ALIMENTACION PARA FIESTAS PATRONALES', null],
      ['COMPRA DE TONER Y PAPELERIA', null],
      ['SERVICIO DE VIDEOVIGILANCIA', 'technology'],
    ];
    for (const [process, macro] of cases) {
      const rule = resolveSvProcessRule(process);
      assert.equal(rule?.macro ?? null, macro, process);
    }
  });

  it('la macro es la que suma al menos la mitad de TODO lo adjudicado', () => {
    assert.equal(resolveSvComprasalSupplierMacro({ medicamentos: 60, informatica: 40 })?.macroIndustryKey, 'health_pharma');
    assert.equal(resolveSvComprasalSupplierMacro({ medicamentos: 40, sin_clasificar: 60 }), null);
    assert.equal(resolveSvComprasalSupplierMacro({ informatica: 30, telecomunicaciones: 30, consultoria: 40 })?.ruleKey, 'informatica');
  });

  it('relevancia, cobertura y re-clasificación', () => {
    assert.equal(isSvComprasalRelevant({ awardedUsd: 50_000, lastYear: 2025 }), true);
    assert.equal(isSvComprasalRelevant({ awardedUsd: 49_999, lastYear: 2026 }), false);
    assert.equal(macroHasSvCoverage('government'), true);
    assert.equal(macroHasSvCoverage('retail'), false);
    assert.equal(resolveSvDirectoryMacro('comprasal_supplier', 'medicamentos'), 'health_pharma');
    assert.equal(resolveSvDirectoryMacro('public_entity', null), 'government');
  });
});

describe('sv_comprasal_directory', () => {
  const registry = registryRow([entry({ list: 'dgii_large_2019', nit: '06142410901022', name: 'BIOARQUITECTURA, S.A. DE C.V.' })]);
  const params = {
    importedAt,
    nitByKey: svUniqueNitByKey([registry]),
    registryByNit: new Map([[registry.tax_id!, registry]]),
    ambiguousKeys: new Set<string>(),
  };

  it('lee las adjudicaciones y suma por proveedora y regla', () => {
    assert.equal(parseSvComprasalAward({ id: 1, sid: 2, name: 'X S.A.', amount_usd: -1 }), null);
    const [supplier] = aggregateSvComprasalSuppliers([
      award({ id: 1, amountUsd: 60_000, process: 'SUMINISTRO DE MATERIALES DE CONSTRUCCION' }),
      award({ id: 2, amountUsd: 20_000, process: 'FIESTAS PATRONALES', institutionCode: '9999' }),
    ]);
    assert.equal(supplier.awards, 2);
    assert.equal(supplier.buyers, 2);
    assert.deepEqual(supplier.amountByRule, { construccion: 60_000, eventos: 20_000 });
  });

  it('empata al único NIT del registro y guarda su razón social oficial', () => {
    const [supplier] = aggregateSvComprasalSuppliers([award({ id: 1, amountUsd: 80_000, process: 'CONSTRUCCION DE MURO' })]);
    const result = buildSvComprasalDirectoryRow(supplier, params);
    assert.ok('row' in result, JSON.stringify(result));
    assert.equal(result.row.source_key, SV_COMPRASAL_DIRECTORY_SOURCE_KEY);
    assert.equal(result.row.tax_id, '06142410901022');
    assert.equal(result.row.legal_name, 'BIOARQUITECTURA, S.A. DE C.V.');
    assert.equal(result.row.raw_data['macro_industry_key'], 'property_construction');
    assert.equal(result.row.raw_data['activity_code'], 'construccion');
    assert.equal(result.row.raw_data['taxpayer_category'], SV_LARGE_TAXPAYER_CATEGORY);
    assert.equal(result.row.raw_data['website_domain'], undefined);
  });

  it('fuera: sin NIT, ambigua, persona natural, consorcio, poco monto', () => {
    const check = (awards: SvComprasalAward[], reason: string, override = params): void => {
      const [supplier] = aggregateSvComprasalSuppliers(awards);
      assert.deepEqual(buildSvComprasalDirectoryRow(supplier, override), { excluded: reason }, reason);
    };
    check([award({ id: 1, name: 'OTRA EMPRESA, S.A. DE C.V.', amountUsd: 90_000, process: 'CONSTRUCCION' })], 'no_nit');
    check([award({ id: 1, amountUsd: 90_000, process: 'CONSTRUCCION' })], 'ambiguous_nit', { ...params, ambiguousKeys: new Set(['BIOARQUITECTURA']) });
    check([award({ id: 1, name: 'JOSE ANTONIO PEREZ LOPEZ', amountUsd: 90_000, process: 'CONSTRUCCION' })], 'natural_person');
    check([award({ id: 1, name: 'CONSORCIO VIAL, S.A. DE C.V.', amountUsd: 90_000, process: 'CONSTRUCCION' })], 'consortium');
    check([award({ id: 1, amountUsd: 10_000, process: 'CONSTRUCCION' })], 'not_relevant');
    check([award({ id: 1, amountUsd: 90_000, process: 'FIESTAS PATRONALES' })], 'no_dominant_macro');
  });
});

// ─── Resolvedor ────────────────────────────────────────────────────────────

function resolverInput(name: string, domain: string | null = null): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode: 'SV', domain, websiteUrl: null },
    criteria: { countryCode: 'SV' },
  } as unknown as OfficialSourceResolverInput;
}

function resolverWith(rowsByCore: Record<string, SalvadorNameRow[]>) {
  const asked: string[] = [];
  const resolver = createSalvadorOfficialSourceResolver({
    querySnapshots: async (core) => {
      asked.push(core);
      return rowsByCore[core] ?? [];
    },
  });
  return { resolver, asked };
}

describe('resolvedor de NIT por nombre', () => {
  const large = workforceFromRawData({ taxpayer_category: SV_LARGE_TAXPAYER_CATEGORY, metrics_year: 2019 }, 'sv_hacienda_taxpayer_lists');

  it('sólo El Salvador', () => {
    const { resolver } = resolverWith({});
    assert.equal(resolver.canResolve(resolverInput('Banco Agrícola')), true);
    assert.equal(resolver.canResolve({ ...resolverInput('Banco Agrícola'), candidate: { canonicalName: 'Banco Agrícola', countryCode: 'HN' } } as unknown as OfficialSourceResolverInput), false);
  });

  it('un NIT con «El Salvador» añadido es fuerte y lleva el tramo de contribuyente', async () => {
    const { resolver } = resolverWith({
      '3M EL SALVADOR': [{ taxId: '06142410901022', legalName: '3M EL SALVADOR, S.A. DE C.V.', normalizedLegalName: '3M EL SALVADOR', workforce: large }],
    });
    const result = await resolver.resolve(resolverInput('3M Company S.A.'));
    // «3M COMPANY» no está: no hay coincidencia (nada difuso).
    assert.equal(result.status, 'not_found');
    const ok = await resolver.resolve(resolverInput('3M El Salvador S.A. de C.V.'));
    assert.equal(ok.status, 'matched');
    assert.equal(ok.taxIdentifier, '06142410901022');
    assert.equal(ok.taxIdentifierType, 'NIT');
    assert.equal(ok.workforce?.sizeBand, 'gran contribuyente (Hacienda El Salvador)');
  });

  it('dos NIT → pista ambigua, nunca fuerte', async () => {
    const { resolver } = resolverWith({
      'LACTEOS DEL CORRAL': [
        { taxId: '06142410901022', legalName: 'LACTEOS DEL CORRAL, S.A.', normalizedLegalName: 'LACTEOS DEL CORRAL' },
        { taxId: '06140506011033', legalName: 'LACTEOS DEL CORRAL, LTDA.', normalizedLegalName: 'LACTEOS DEL CORRAL' },
      ],
    });
    const result = await resolver.resolve(resolverInput('Lácteos del Corral'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['ambiguous'], true);
  });

  it('una palabra: pista salvo que su web la confirme', async () => {
    const rows = { DURALITA: [{ taxId: '06142410901022', legalName: 'DURALITA, S.A. DE C.V.', normalizedLegalName: 'DURALITA' }] };
    assert.equal((await resolverWith(rows).resolver.resolve(resolverInput('Duralita'))).status, 'low_confidence_match');
    assert.equal((await resolverWith(rows).resolver.resolve(resolverInput('Duralita', 'duralita.com'))).status, 'matched');
  });

  it('un NIT con verificador roto nunca se ofrece', async () => {
    const { resolver } = resolverWith({ 'ACME EL SALVADOR': [{ taxId: '06142410901023', legalName: 'ACME', normalizedLegalName: 'ACME EL SALVADOR' }] });
    assert.equal((await resolver.resolve(resolverInput('Acme El Salvador'))).status, 'not_found');
  });
});

// ─── Tamaño ────────────────────────────────────────────────────────────────

describe('tramo de contribuyente en el filtro de tamaño', () => {
  it('se registra con su año y NO decide (sin piso ni techo de personas)', () => {
    for (const category of [SV_LARGE_TAXPAYER_CATEGORY, SV_MEDIUM_TAXPAYER_CATEGORY]) {
      const workforce = workforceFromRawData({ taxpayer_category: category, metrics_year: 2012 }, 'sv_hacienda_taxpayer_lists');
      assert.ok(workforce, category);
      assert.equal(workforce.year, 2012);
      assert.equal(workforce.maxWorkers, null);
      const candidate = { officialSourceIdentity: { strongIdentityAvailable: true, officialSourceMetadata: { workforce } } };
      const decision = resolveEmployeeSizeForIcpGate({
        threshold: 200,
        referenceYear: 2026,
        officialRegistryWorkforce: extractOfficialRegistryWorkforce(candidate),
      });
      assert.notEqual(decision.selectedSource, 'official_registry_workers', `${category}: ${decision.reason}`);
    }
  });
});

// ─── Familias ──────────────────────────────────────────────────────────────

describe('familias de fuente', () => {
  it('registro y directorio por NIT; alias e instituciones por registro nativo', () => {
    assert.equal(getSourceFamily(SV_NIT_REGISTRY_SOURCE_KEY), 'TAX_GRAIN');
    assert.equal(getSourceFamily(SV_COMPRASAL_DIRECTORY_SOURCE_KEY), 'TAX_GRAIN');
    assert.equal(getSourceFamily(SV_NIT_NAME_ALIAS_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
    assert.equal(getSourceFamily(SV_PUBLIC_ENTITIES_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
  });
});
