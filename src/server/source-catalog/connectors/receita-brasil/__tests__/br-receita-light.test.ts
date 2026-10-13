/**
 * SOURCES-BR-LIGHT-1 — nombres, dominios, filas y entradas de la carga liviana de
 * Brasil (Receita + CVM). Casos tomados de la medición del 13-10-2026.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  brazilCandidateNameVariants,
  brazilCoreContainsWords,
  brazilNameCore,
  brazilPublicEntityKey,
  brazilRegistryAliasKeys,
  endsWithBrazilLegalForm,
} from '../br-name-keys';
import {
  brazilCompanyDomainFromEmail,
  brazilDomainFitsName,
  brazilDomainLabel,
  brazilDomainLabelsAgree,
  brazilDomainLookupKey,
  isBrazilPublicSectorDomain,
  registrableBrazilDomain,
} from '../br-domain';
import {
  BR_RECEITA_DIRECTORY_SOURCE_KEY,
  BR_RECEITA_DOMAIN_KEY_SOURCE_KEY,
  BR_RECEITA_NAME_ALIAS_SOURCE_KEY,
  BR_RECEITA_REGISTRY_SOURCE_KEY,
  brReceitaDirectoryExclusion,
  brReceitaDirectoryPriority,
  brReceitaRecordEligible,
  buildBrReceitaDirectoryRow,
  buildBrReceitaDomainKeyRow,
  buildBrReceitaNameAliasRows,
  buildBrReceitaRegistryRow,
  formatBrazilCnpj,
  type BrReceitaCompanyRecord,
} from '../br-receita-rows';
import { parseBrReceitaLightLine, parseCvmCadastro } from '../br-receita-input';
import { computeBrazilCnpjCheckDigits } from '../../br-receita-cnpj/br-cnpj';
import { BR_PORTE_BANDS, workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  brCnaeAllowedInDiscovery,
  macroHasBrReceitaCoverage,
  resolveBrCnaeMacro,
} from '@/server/prospect-batches/country-source-discovery/br-receita-macro-table';

/** CNPJ válido a partir de 12 caracteres. */
const cnpj = (base12: string): string => `${base12}${computeBrazilCnpjCheckDigits(base12)}`;

const PARAMS = { sourceYear: 2026, sourcePeriod: '2026-09', importedAt: '2026-10-13T00:00:00.000Z' };

function record(overrides: Partial<BrReceitaCompanyRecord> = {}): BrReceitaCompanyRecord {
  return {
    cnpj: cnpj('075265570001'),
    legalName: 'AMBEV S.A.',
    tradeName: 'AMBEV',
    naturezaJuridica: '2046',
    capitalSocial: 58_308_213_545,
    porte: '05',
    openingDate: '20050708',
    cnae: '1113502',
    cnaeDescription: 'Fabricação de cervejas e chopes',
    uf: 'SP',
    municipality: 'SAO PAULO',
    emailDomain: 'ambev.com.br',
    activeBranches: 120,
    countryCode: null,
    ...overrides,
  };
}

describe('br-name-keys — forma societaria por estructura, sólo al final', () => {
  it('quita LTDA, S.A., S/A, EIRELI, ME, EPP, «& Cia» y «em recuperação judicial», apilados', () => {
    assert.equal(brazilNameCore('AMBEV S.A.'), 'AMBEV');
    assert.equal(brazilNameCore('JBS S/A'), 'JBS');
    assert.equal(brazilNameCore('WEG SA'), 'WEG');
    assert.equal(brazilNameCore('Magazine Luiza Sociedade Anônima'), 'MAGAZINE LUIZA');
    assert.equal(brazilNameCore('PADARIA BOM PAO LTDA - ME'), 'PADARIA BOM PAO');
    assert.equal(brazilNameCore('JOAO SILVA E CIA LTDA EPP'), 'JOAO SILVA');
    assert.equal(brazilNameCore('OI S.A. - EM RECUPERACAO JUDICIAL'), 'OI');
    assert.equal(brazilNameCore('TECH EIRELI'), 'TECH');
    assert.equal(brazilNameCore('Natura & Co'), 'NATURA E CO');
  });

  it('no quita formas en medio ni deja el nombre vacío', () => {
    assert.equal(brazilNameCore('SA COMERCIO DE PECAS LTDA'), 'SA COMERCIO DE PECAS');
    assert.equal(brazilNameCore('COMPANHIA PARANAENSE DE ENERGIA'), 'COMPANHIA PARANAENSE DE ENERGIA');
    assert.equal(brazilNameCore('LTDA'), 'LTDA');
    assert.equal(brazilNameCore(''), '');
    assert.equal(brazilNameCore(null), '');
    assert.ok(endsWithBrazilLegalForm('Gerdau S.A.'));
    assert.ok(!endsWithBrazilLegalForm('Gerdau'));
  });

  it('variantes del candidato: sin «Grupo», sin «Brasil», parte antes del guion, clave pública', () => {
    const cores = (name: string) => brazilCandidateNameVariants(name).map((v) => v.core);
    assert.deepEqual(cores('Grupo Boticário'), ['GRUPO BOTICARIO', 'BOTICARIO']);
    assert.deepEqual(cores('Engie Brasil'), ['ENGIE BRASIL', 'ENGIE']);
    assert.deepEqual(cores('Banco do Brasil'), ['BANCO DO BRASIL', 'BANCO']);
    assert.deepEqual(cores('Sabesp - Saneamento'), ['SABESP SANEAMENTO', 'SABESP']);
    assert.deepEqual(cores('Prefeitura de São Paulo'), ['PREFEITURA DE SAO PAULO', 'MUNICIPIO SAO PAULO']);
    assert.deepEqual(cores(''), []);
  });

  it('clave pública: alcaldías y estados se escriben igual en los dos lados', () => {
    assert.equal(brazilPublicEntityKey('MUNICIPIO DE SAO PAULO'), 'MUNICIPIO SAO PAULO');
    assert.equal(brazilPublicEntityKey('PREFEITURA MUNICIPAL DE CAMPINAS'), 'MUNICIPIO CAMPINAS');
    assert.equal(brazilPublicEntityKey('ESTADO DE MINAS GERAIS'), 'ESTADO MINAS GERAIS');
    assert.equal(brazilPublicEntityKey('GOVERNO DO ESTADO DE MINAS GERAIS'), 'ESTADO MINAS GERAIS');
    assert.equal(brazilPublicEntityKey('AMBEV'), null);
  });

  it('alias: nome fantasia, nombre comercial de la CVM, partes y clave pública; nunca de fondos', () => {
    assert.deepEqual(
      brazilRegistryAliasKeys({ legalName: 'TELEFONICA BRASIL S.A.', tradeName: 'VIVO', cvmTradeName: 'TELEFÔNICA BRASIL' }),
      ['VIVO'],
    );
    assert.deepEqual(
      brazilRegistryAliasKeys({ legalName: 'COMPANHIA DE SANEAMENTO BASICO DO ESTADO DE SAO PAULO - SABESP' }),
      ['COMPANHIA DE SANEAMENTO BASICO DO ESTADO DE SAO PAULO', 'SABESP'],
    );
    assert.deepEqual(brazilRegistryAliasKeys({ legalName: 'MUNICIPIO DE CAMPINAS' }), ['MUNICIPIO CAMPINAS']);
    assert.deepEqual(
      brazilRegistryAliasKeys({ legalName: 'BRADESCO FUNDO DE INVESTIMENTO RENDA FIXA', tradeName: 'BRADESCO' }),
      [],
    );
  });

  it('contención por palabras completas', () => {
    assert.ok(brazilCoreContainsWords('PETROLEO BRASILEIRO S A PETROBRAS', 'PETROBRAS'));
    assert.ok(!brazilCoreContainsWords('PETROBRASIL COMERCIO', 'PETROBRAS'));
  });
});

describe('br-domain — la web sólo vale si encaja con el nombre', () => {
  it('dominio registrable y etiqueta, incluidos los del Estado', () => {
    assert.equal(registrableBrazilDomain('correio.itau.com.br'), 'itau.com.br');
    assert.equal(registrableBrazilDomain('www.saopaulo.sp.gov.br'), 'saopaulo.sp.gov.br');
    assert.equal(registrableBrazilDomain('ir.weg.net'), 'weg.net');
    assert.equal(brazilDomainLabel('magazineluiza.com.br'), 'magazineluiza');
    assert.equal(brazilDomainLabel('https://www.p-iguatu.pr.gov.br/'), 'piguatu');
    assert.ok(brazilDomainLabelsAgree('embraer.com', 'embraer.com.br'));
    assert.ok(!brazilDomainLabelsAgree('aes.com', 'cemig.com.br'));
    assert.equal(brazilDomainLookupKey('www.bradesco.com.br'), '@bradesco');
    assert.ok(isBrazilPublicSectorDomain('camaracondor.rs.gov.br'));
    assert.ok(!isBrazilPublicSectorDomain('ambev.com.br'));
  });

  it('encaja por palabra propia, por nombre pegado o por sigla', () => {
    assert.ok(brazilDomainFitsName('magazineluiza.com.br', ['MAGAZINE LUIZA S/A']));
    assert.ok(brazilDomainFitsName('sabesp.com.br', ['COMPANHIA DE SANEAMENTO BASICO DO ESTADO DE SAO PAULO - SABESP']));
    assert.ok(brazilDomainFitsName('cpfl.com.br', ['COMPANHIA PAULISTA DE FORCA E LUZ']));
    assert.ok(brazilDomainFitsName('weg.net', ['WEG SA']));
  });

  it('el correo de la contadora o del abogado nunca es la web de la empresa', () => {
    assert.ok(!brazilDomainFitsName('contabilizei.com.br', ['PADARIA BOM PAO LTDA']));
    assert.equal(
      brazilCompanyDomainFromEmail({ email: 'fiscal@pradvogados.com.br', names: ['DLL PARTICIPACOES LTDA'], publicEntity: false }),
      null,
    );
    assert.equal(
      brazilCompanyDomainFromEmail({ email: 'contato@gmail.com', names: ['GMAIL COMERCIO LTDA'], publicEntity: false }),
      null,
    );
    assert.equal(
      brazilCompanyDomainFromEmail({ email: 'x@bol.com.br', names: ['BOL INDUSTRIA LTDA'], publicEntity: false }),
      null,
    );
  });

  it('un dominio del Estado sólo vale para un ente público', () => {
    assert.equal(
      brazilCompanyDomainFromEmail({ email: 'gabinete@candoi.pr.gov.br', names: ['MUNICIPIO DE CANDOI'], publicEntity: true }),
      'candoi.pr.gov.br',
    );
    assert.equal(
      brazilCompanyDomainFromEmail({ email: 'a@candoi.pr.gov.br', names: ['CANDOI TRANSPORTES LTDA'], publicEntity: false }),
      null,
    );
  });
});

describe('br-receita-rows — registro, alias, dominio y directorio', () => {
  it('sólo matrices privadas DEMAIS (sin empresário individual) y entes públicos', () => {
    assert.ok(brReceitaRecordEligible(record()));
    assert.ok(!brReceitaRecordEligible(record({ porte: '01' })));
    assert.ok(!brReceitaRecordEligible(record({ porte: '03' })));
    assert.ok(!brReceitaRecordEligible(record({ naturezaJuridica: '2135' })));
    assert.ok(!brReceitaRecordEligible(record({ naturezaJuridica: '3999' })));
    assert.ok(!brReceitaRecordEligible(record({ naturezaJuridica: '4120' })));
    assert.ok(brReceitaRecordEligible(record({ naturezaJuridica: '1244', porte: '05' })));
  });

  it('fila de registro: CNPJ validado, núcleo, porte, web que encaja y nada personal', () => {
    const row = buildBrReceitaRegistryRow(record(), PARAMS);
    assert.ok(row);
    assert.equal(row.source_key, BR_RECEITA_REGISTRY_SOURCE_KEY);
    assert.equal(row.country_code, 'BR');
    assert.equal(row.normalized_tax_id, cnpj('075265570001'));
    assert.equal(row.tax_id, formatBrazilCnpj(cnpj('075265570001')));
    assert.match(row.tax_id, /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
    assert.equal(row.normalized_legal_name, 'AMBEV');
    assert.equal(row.record_identity_key, `tax:${cnpj('075265570001')}`);
    assert.equal(row.raw_data['br_porte'], '05');
    assert.equal(row.raw_data['website_domain'], 'ambev.com.br');
    assert.equal(row.raw_data['website_domain_source'], 'receita_email_domain');
    const json = JSON.stringify(row);
    assert.ok(!json.includes('@'), 'ningún correo');
  });

  it('un CNPJ con dígito verificador malo no entra', () => {
    assert.equal(buildBrReceitaRegistryRow(record({ cnpj: '07526557000199' }), PARAMS), null);
  });

  it('la web de la CVM gana y marca a la cotizada', () => {
    const row = buildBrReceitaRegistryRow(record({ emailDomain: 'contabilizei.com.br' }), PARAMS, {
      tradeName: 'AMBEV',
      domain: 'ambev.com.br',
      sector: null,
    });
    assert.equal(row?.raw_data['website_domain'], 'ambev.com.br');
    assert.equal(row?.raw_data['website_domain_source'], 'cvm_cadastro');
    assert.equal(row?.raw_data['cvm_listed'], true);
  });

  it('alias y clave de dominio apuntan al mismo CNPJ con identidad propia', () => {
    const row = buildBrReceitaRegistryRow(record({ legalName: 'TELEFONICA BRASIL S.A.', tradeName: 'VIVO', emailDomain: 'telefonica.com.br' }), PARAMS)!;
    const aliases = buildBrReceitaNameAliasRows(row, ['VIVO', 'TELEFONICA BRASIL', 'VIVO']);
    assert.deepEqual(aliases.map((a) => a.normalized_legal_name), ['VIVO']);
    assert.equal(aliases[0].source_key, BR_RECEITA_NAME_ALIAS_SOURCE_KEY);
    assert.equal(aliases[0].raw_data['alias_of'], 'TELEFONICA BRASIL');
    assert.equal(aliases[0].record_identity_key, `br-name-alias:${row.normalized_tax_id}:VIVO`);
    const domainRow = buildBrReceitaDomainKeyRow(row)!;
    assert.equal(domainRow.source_key, BR_RECEITA_DOMAIN_KEY_SOURCE_KEY);
    assert.equal(domainRow.normalized_legal_name, '@telefonica');
    assert.equal(domainRow.raw_data['domain_of'], 'TELEFONICA BRASIL');
  });

  it('sin web que encaje no hay clave de dominio', () => {
    const row = buildBrReceitaRegistryRow(record({ emailDomain: 'contabilizei.com.br' }), PARAMS)!;
    assert.equal(row.raw_data['website_domain'], undefined);
    assert.equal(buildBrReceitaDomainKeyRow(row), null);
  });

  it('directorio: corte de capital o sucursales, sin holdings ni SPE, con macro por CNAE', () => {
    const ok = record();
    const row = buildBrReceitaRegistryRow(ok, PARAMS)!;
    const dir = buildBrReceitaDirectoryRow(ok, row)!;
    assert.equal(dir.source_key, BR_RECEITA_DIRECTORY_SOURCE_KEY);
    assert.equal(dir.raw_data['macro_industry_key'], 'consumer_goods');
    assert.ok((dir.priority_score ?? 0) > 0);

    const small = record({ capitalSocial: 500_000, activeBranches: 2 });
    assert.equal(brReceitaDirectoryExclusion(small, buildBrReceitaRegistryRow(small, PARAMS)!), 'below_directory_cut');
    const branches = record({ capitalSocial: 10_000, activeBranches: 3 });
    assert.equal(brReceitaDirectoryExclusion(branches, buildBrReceitaRegistryRow(branches, PARAMS)!), null);
    const holding = record({ cnae: '6462000' });
    assert.equal(brReceitaDirectoryExclusion(holding, buildBrReceitaRegistryRow(holding, PARAMS)!), 'not_operating_activity');
    const spe = record({ legalName: 'VILA NOVA SPE LTDA', cnae: '4120400' });
    assert.equal(brReceitaDirectoryExclusion(spe, buildBrReceitaRegistryRow(spe, PARAMS)!), 'not_operating_name');
    const hotel = record({ cnae: '5510801' });
    assert.equal(brReceitaDirectoryExclusion(hotel, buildBrReceitaRegistryRow(hotel, PARAMS)!), 'no_macro');
    const abroad = record({ countryCode: '249' });
    assert.equal(brReceitaDirectoryExclusion(abroad, buildBrReceitaRegistryRow(abroad, PARAMS)!), 'foreign_address');
  });

  it('directorio: entes públicos sólo cabezas con web .gov.br; hospital → Salud', () => {
    const city = record({ legalName: 'MUNICIPIO DE CANDOI', naturezaJuridica: '1244', emailDomain: 'candoi.pr.gov.br', cnae: '8411600', capitalSocial: 0, activeBranches: 0 });
    const cityRow = buildBrReceitaDirectoryRow(city, buildBrReceitaRegistryRow(city, PARAMS)!)!;
    assert.equal(cityRow.raw_data['macro_industry_key'], 'government');
    assert.equal(cityRow.raw_data['public_entity'], true);
    const noWeb = record({ legalName: 'MUNICIPIO DE CANDOI', naturezaJuridica: '1244', emailDomain: 'gmail.com', cnae: '8411600' });
    assert.equal(brReceitaDirectoryExclusion(noWeb, buildBrReceitaRegistryRow(noWeb, PARAMS)!), 'public_without_gov_web');
    const fund = record({ legalName: 'FUNDO MUNICIPAL DE SAUDE DE CANDOI', naturezaJuridica: '1333', emailDomain: 'candoi.pr.gov.br' });
    assert.equal(brReceitaDirectoryExclusion(fund, buildBrReceitaRegistryRow(fund, PARAMS)!), 'public_not_head');
    const hospital = record({ legalName: 'HOSPITAL DE CLINICAS DE PORTO ALEGRE', naturezaJuridica: '1104', emailDomain: 'hcpa.edu.br', cnae: '8610101' });
    const hospitalRow = buildBrReceitaRegistryRow(hospital, PARAMS)!;
    assert.equal(hospitalRow.raw_data['website_domain'], 'hcpa.edu.br');
    assert.equal(brReceitaDirectoryExclusion(hospital, hospitalRow), 'public_without_gov_web');
  });

  it('prioridad determinista: más capital y más sucursales primero', () => {
    assert.ok(brReceitaDirectoryPriority(1e10, 0) > brReceitaDirectoryPriority(1e6, 0));
    assert.ok(brReceitaDirectoryPriority(1e6, 50) > brReceitaDirectoryPriority(1e6, 3));
    assert.equal(brReceitaDirectoryPriority(1e6, 3), brReceitaDirectoryPriority(1e6, 3));
  });
});

describe('br-receita-macro-table — tabla CNAE aprobada (13-10-2026)', () => {
  it('la clase manda sobre la división; holdings y SPE fuera del buscador', () => {
    assert.equal(resolveBrCnaeMacro('4644-3/01'), 'health_pharma');
    assert.equal(resolveBrCnaeMacro('4771701'), 'health_pharma');
    assert.equal(resolveBrCnaeMacro('4651601'), 'technology');
    assert.equal(resolveBrCnaeMacro('4751201'), 'technology');
    assert.equal(resolveBrCnaeMacro('4711301'), 'retail');
    assert.equal(resolveBrCnaeMacro('6201501'), 'technology');
    assert.equal(resolveBrCnaeMacro('8411600'), 'government');
    assert.equal(resolveBrCnaeMacro('5611201'), null);
    assert.equal(resolveBrCnaeMacro('85'), null);
    assert.ok(!brCnaeAllowedInDiscovery('6462000'));
    assert.ok(!brCnaeAllowedInDiscovery('6810201'));
    assert.ok(brCnaeAllowedInDiscovery('6201501'));
    assert.ok(macroHasBrReceitaCoverage('technology'));
    assert.ok(!macroHasBrReceitaCoverage('education'));
  });
});

describe('porte de la Receita en el filtro de tamaño', () => {
  it('ME y EPP quedan enteras bajo el umbral ICP; DEMAIS no decide', () => {
    const me = workforceFromRawData({ br_porte: '01', br_porte_year: 2026 }, 'br_receita_porte');
    assert.equal(me?.maxWorkers, BR_PORTE_BANDS['01'].max);
    assert.equal(me?.declaredBelowIcp, true);
    const epp = workforceFromRawData({ br_porte: '03', br_porte_year: 2026 }, 'br_receita_porte');
    assert.equal(epp?.maxWorkers, 99);
    assert.equal(epp?.declaredBelowIcp, true);
    const demais = workforceFromRawData({ br_porte: '05' }, 'br_receita_porte', 2026);
    assert.equal(demais?.maxWorkers, null);
    assert.equal(demais?.workers, 0);
    assert.equal(demais?.declaredBelowIcp, undefined);
    assert.equal(workforceFromRawData({ br_porte: '05' }, 'br_receita_porte'), null, 'sin año no hay tramo');
    assert.equal(workforceFromRawData({ br_porte: '99', br_porte_year: 2026 }, 'br_receita_porte'), null);
  });
});

describe('br-receita-input — TSV del extractor y cadastro de la CVM', () => {
  it('lee una línea del TSV y salta la cabecera', () => {
    const line = [cnpj('075265570001'), 'AMBEV S.A.', 'AMBEV', '2046', '58308213545.00', '05', '20050708', '1113502', 'Fabricação de cervejas', 'SP', 'SAO PAULO', 'ambev.com.br', '120', ''].join('\t');
    const parsed = parseBrReceitaLightLine(line);
    assert.equal(parsed?.legalName, 'AMBEV S.A.');
    assert.equal(parsed?.capitalSocial, 58_308_213_545);
    assert.equal(parsed?.activeBranches, 120);
    assert.equal(parsed?.countryCode, null);
    assert.equal(parseBrReceitaLightLine('cnpj\trazao_social\tnome_fantasia\tnatureza\tcapital\tporte\tdata_inicio\tcnae\tcnae_descricao\tuf\tmunicipio\temail_domain\tfiliais_ativas\tpais'), null);
    assert.equal(parseBrReceitaLightLine('solo\tdos'), null);
  });

  it('CVM: sólo activas, CNPJ validado y del correo sólo el dominio', () => {
    const header = 'CNPJ_CIA;DENOM_SOCIAL;DENOM_COMERC;SIT;EMAIL;SETOR_ATIV';
    const bradesco = cnpj('607469480001');
    const text = [
      header,
      `${bradesco.slice(0, 2)}.${bradesco.slice(2, 5)}.${bradesco.slice(5, 8)}/${bradesco.slice(8, 12)}-${bradesco.slice(12)};BANCO BRADESCO S.A.;BANCO BRADESCO S.A.;ATIVO;diretoria_ri@bradesco.com.br;Bancos`,
      `${cnpj('113966330001')};3A COMPANHIA SECURITIZADORA;TRIPLO A;CANCELADA;dri@3asec.com.br;Securitização`,
      '00.000.000/0001-00;MALO;MALO;ATIVO;x@malo.com;',
    ].join('\n');
    const listings = parseCvmCadastro(text);
    assert.equal(listings.size, 1);
    assert.deepEqual(listings.get(bradesco), { tradeName: 'BANCO BRADESCO S.A.', domain: 'bradesco.com.br', sector: 'Bancos' });
  });
});
