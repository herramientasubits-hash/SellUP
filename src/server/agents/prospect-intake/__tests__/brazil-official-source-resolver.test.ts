/**
 * SOURCES-BR-LIGHT-1 — CNPJ por nombre de Brasil. Casos de la medición del
 * 13-10-2026 con 100 grandes brasileñas (Receita 2026-09 + CVM).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createBrazilOfficialSourceResolver,
  type BrazilSnapshotReads,
  type BrazilSnapshotRow,
} from '../resolvers/brazil-official-source-resolver';
import type { OfficialSourceResolverInput } from '../source-enrichment';
import { toBrazilSnapshotRow } from '@/server/prospect-batches/brazil-snapshot-query';
import { computeBrazilCnpjCheckDigits } from '@/server/source-catalog/connectors/br-receita-cnpj/br-cnpj';

const cnpj = (base12: string): string => `${base12}${computeBrazilCnpjCheckDigits(base12)}`;

function row(overrides: Partial<BrazilSnapshotRow> & { key: string }): BrazilSnapshotRow {
  const { key, ...rest } = overrides;
  return {
    taxId: cnpj('000000010001'),
    legalName: key,
    normalizedLegalName: key,
    registryCore: key,
    websiteDomain: null,
    capital: 0,
    activeBranches: 0,
    cvmListed: false,
    workforce: null,
    ...rest,
  };
}

function reads(byName: Record<string, BrazilSnapshotRow[]>, byDomain: Record<string, BrazilSnapshotRow[]> = {}) {
  const calls: string[] = [];
  const impl: BrazilSnapshotReads = {
    byName: async (core) => {
      calls.push(core);
      return byName[core] ?? [];
    },
    byDomainKey: async (key) => {
      calls.push(key);
      return byDomain[key] ?? [];
    },
  };
  return { impl, calls };
}

function input(name: string, domain: string | null = null, countryCode = 'BR'): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, domain, websiteUrl: null, countryCode },
    criteria: { countryCode },
  } as unknown as OfficialSourceResolverInput;
}

const AMBEV = cnpj('075265570001');
const BB = cnpj('000000000001');
const PETROBRAS = cnpj('330001670001');
const BRADESCO = cnpj('607469480001');
const BRADESCO_ENERGIA = cnpj('123456780001');
const JP = cnpj('317090660001');

describe('Brasil — CNPJ por nombre', () => {
  it('sólo resuelve candidatas de Brasil', () => {
    const resolver = createBrazilOfficialSourceResolver({ reads: reads({}).impl });
    assert.equal(resolver.countryCode, 'BR');
    assert.equal(resolver.sourceKey, 'br_receita_registry');
    assert.ok(resolver.canResolve(input('Ambev')));
    assert.ok(!resolver.canResolve(input('Ambev', null, 'AR')));
    assert.ok(!resolver.canResolve(input(' ')));
  });

  it('nombre + web con la misma etiqueta → fuerte, con el porte como tamaño', async () => {
    const workforce = { workers: 0, year: 2026, source: 'br_receita_porte', maxWorkers: null, sizeBand: 'demais' };
    const { impl } = reads({
      AMBEV: [
        row({ key: 'AMBEV', taxId: AMBEV, websiteDomain: 'ambev.com.br', capital: 58e9, workforce }),
        row({ key: 'AMBEV', taxId: cnpj('111111110001'), websiteDomain: 'outra.com.br', capital: 1e5 }),
      ],
    });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Ambev', 'www.ambev.com.br'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, AMBEV);
    assert.equal(result.taxIdentifierType, 'CNPJ');
    assert.equal(result.safeMetadata?.['cnpjVia'], 'name_and_domain');
    assert.deepEqual(result.workforce, workforce);
  });

  it('un solo CNPJ grande y sin web que contradiga → fuerte («Banco do Brasil»)', async () => {
    const { impl } = reads({ 'BANCO DO BRASIL': [row({ key: 'BANCO DO BRASIL', taxId: BB, capital: 120e9 })] });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Banco do Brasil', 'bb.com.br'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, BB);
  });

  it('una pequeña sin web cuando la candidata trae web → pista («Casas Bahia»)', async () => {
    const { impl } = reads({ 'CASAS BAHIA': [row({ key: 'CASAS BAHIA', taxId: JP, capital: 200_000 })] });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Casas Bahia', 'casasbahia.com.br'));
    assert.equal(result.status, 'low_confidence_match');
  });

  it('la misma pequeña con nombre de dos palabras y SIN web en la candidata → fuerte', async () => {
    const { impl } = reads({ 'CASAS BAHIA': [row({ key: 'CASAS BAHIA', taxId: JP, capital: 200_000 })] });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Casas Bahia'));
    assert.equal(result.status, 'matched');
  });

  it('web que contradice → pista («CEMIG» → CEMIG II B.V. con aes.com)', async () => {
    const { impl } = reads({ CEMIG: [row({ key: 'CEMIG', taxId: cnpj('457814250001'), websiteDomain: 'aes.com', capital: 0 })] });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('CEMIG', 'cemig.com.br'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['cnpjVia'], 'domain_conflict');
  });

  it('una palabra, pequeña y sin web propia → pista («Dasa» → una destilería)', async () => {
    const { impl } = reads({ DASA: [row({ key: 'DASA', taxId: cnpj('180543790001'), capital: 40_000 })] });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Dasa', 'dasa.com.br'));
    assert.equal(result.status, 'low_confidence_match');
  });

  it('una palabra corta sin web no se busca (filtro de nombre genérico)', async () => {
    const { impl, calls } = reads({ DASA: [row({ key: 'DASA', taxId: cnpj('180543790001'), capital: 4e9 })] });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Dasa'));
    assert.equal(result.status, 'not_found');
    assert.deepEqual(calls, []);
  });

  it('varios homónimos sin web en la candidata: fuerte sólo si UNO es grande («Gerdau»)', async () => {
    const gerdau = cnpj('336115000001');
    const homonyms = [
      row({ key: 'GERDAU', taxId: gerdau, capital: 24e9 }),
      row({ key: 'GERDAU', taxId: cnpj('222222220001'), capital: 5_000 }),
    ];
    const resolver = createBrazilOfficialSourceResolver({ reads: reads({ GERDAU: homonyms }).impl });
    const result = await resolver.resolve(input('Gerdau'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, gerdau);
    const twoLarge = [...homonyms, row({ key: 'GERDAU', taxId: cnpj('333333330001'), capital: 3e9 })];
    const ambiguous = await createBrazilOfficialSourceResolver({ reads: reads({ GERDAU: twoLarge }).impl }).resolve(input('Gerdau'));
    assert.equal(ambiguous.status, 'low_confidence_match');
  });

  it('por web cuando el nombre comercial no es la razón social («Petrobras»)', async () => {
    const { impl, calls } = reads(
      {},
      {
        '@petrobras': [
          row({ key: '@petrobras', taxId: PETROBRAS, registryCore: 'PETROLEO BRASILEIRO S A PETROBRAS', capital: 205e9 }),
          row({ key: '@petrobras', taxId: cnpj('444444440001'), registryCore: 'TRANSPORTADORA ASSOCIADA DE GAS', capital: 9e9 }),
        ],
      },
    );
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Petrobras', 'petrobras.com.br'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, PETROBRAS);
    assert.equal(result.safeMetadata?.['cnpjVia'], 'domain_and_name');
    assert.ok(calls.includes('@petrobras'));
  });

  it('dentro de un grupo con la misma web gana la cotizada en la CVM («Bradesco»)', async () => {
    const { impl } = reads(
      {},
      {
        '@bradesco': [
          row({ key: '@bradesco', taxId: BRADESCO_ENERGIA, registryCore: 'BRADESCO COMERCIALIZADORA DE ENERGIA', capital: 240e6 }),
          row({ key: '@bradesco', taxId: BRADESCO, registryCore: 'BANCO BRADESCO', capital: 87e9, cvmListed: true }),
        ],
      },
    );
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Bradesco', 'bradesco.com.br'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, BRADESCO);
  });

  it('dos empresas del grupo con la misma web y ninguna cotizada → pista, nunca fuerte', async () => {
    const { impl } = reads(
      {},
      {
        '@usiminas': [
          row({ key: '@usiminas', taxId: cnpj('555555550001'), registryCore: 'MINERACAO USIMINAS', capital: 3.7e9 }),
          row({ key: '@usiminas', taxId: cnpj('666666660001'), registryCore: 'USIMINAS PARTICIPACOES E LOGISTICA', capital: 4.9e8 }),
        ],
      },
    );
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Usiminas', 'usiminas.com'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['cnpjVia'], 'domain_group');
  });

  it('prueba sin «Grupo» y sin «Brasil», y la clave pública de alcaldías', async () => {
    const boticario = cnpj('777777770001');
    const sp = cnpj('466957250001');
    const { impl, calls } = reads({
      BOTICARIO: [row({ key: 'BOTICARIO', taxId: boticario, capital: 6e9 })],
      'MUNICIPIO SAO PAULO': [row({ key: 'MUNICIPIO SAO PAULO', taxId: sp, registryCore: 'MUNICIPIO DE SAO PAULO', publicEntity: true })],
    });
    const resolver = createBrazilOfficialSourceResolver({ reads: impl });
    assert.equal((await resolver.resolve(input('Grupo Boticário'))).taxIdentifier, boticario);
    assert.deepEqual(calls.slice(0, 2), ['GRUPO BOTICARIO', 'BOTICARIO']);
    const city = await resolver.resolve(input('Prefeitura de São Paulo', 'prefeitura.sp.gov.br'));
    assert.equal(city.status, 'matched');
    assert.equal(city.taxIdentifier, sp);
  });

  it('nada en el registro ni por web → not_found; un CNPJ malo nunca sale', async () => {
    const { impl } = reads({ NUBANK: [row({ key: 'NUBANK', taxId: '12345678000100', capital: 1e9 })] });
    const result = await createBrazilOfficialSourceResolver({ reads: impl }).resolve(input('Nubank', 'nubank.com.br'));
    assert.equal(result.status, 'not_found');
    assert.equal(result.taxIdentifier, undefined);
  });
});

describe('Brasil — lectura del registro', () => {
  it('fila leída → alias/dominio apuntan al núcleo del registro; porte → tamaño', () => {
    const mapped = toBrazilSnapshotRow({
      source_key: 'br_receita_domain_key',
      normalized_tax_id: PETROBRAS,
      legal_name: 'PETROLEO BRASILEIRO S A PETROBRAS',
      normalized_legal_name: '@petrobras',
      source_year: 2026,
      raw_data: {
        domain_of: 'PETROLEO BRASILEIRO S A PETROBRAS',
        website_domain: 'petrobras.com.br',
        capital_social: 205e9,
        active_branches: 700,
        cvm_listed: true,
        br_porte: '05',
      },
    });
    assert.equal(mapped.registryCore, 'PETROLEO BRASILEIRO S A PETROBRAS');
    assert.equal(mapped.websiteDomain, 'petrobras.com.br');
    assert.equal(mapped.capital, 205e9);
    assert.equal(mapped.cvmListed, true);
    assert.equal(mapped.workforce?.year, 2026);
    assert.equal(mapped.workforce?.maxWorkers, null);
  });
});
