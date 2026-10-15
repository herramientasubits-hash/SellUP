/**
 * Tests — «Proveedores de una empresa», Fase 2 (AGENT1-SUPPLIER-SEARCH-PUBLIC-1):
 * proveedores de una entidad pública colombiana según SECOP II.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoSecopAggregateUrl,
  buildCoSecopFamiliesUrl,
  coSecopSinceDate,
  fetchCoSecopSuppliers,
  parseCoSecopEvidence,
  parseUnspscCode,
  unspscPrefixesForMacro,
} from '../co-secop-suppliers';
import {
  describePublicBuyerSupplier,
  normalizePublicEntityName,
  pickPublicBuyer,
  runPublicBuyerSupplierStep,
  tagPublicBuyerSuppliers,
  type PublicBuyerStepDeps,
  type PublicBuyerSupplier,
  type PublicEntityRow,
} from '../public-buyer-suppliers';

const MEDELLIN: PublicEntityRow = {
  taxId: '890905211',
  normalizedLegalName: 'ALCALDIA DE MEDELLIN',
  shortName: 'Distrito Especial de Ciencia, Tecnología e Innovación de Medellín',
  isHead: true,
};

describe('1. ¿la referencia es una entidad pública?', () => {
  it('normaliza como el registro', () => {
    assert.equal(normalizePublicEntityName('  Alcaldía de Medellín. '), 'ALCALDIA DE MEDELLIN');
  });

  it('coincidencia exacta, o por el nombre corto de la fuente', () => {
    assert.deepEqual(pickPublicBuyer('Alcaldía de Medellín', [MEDELLIN]), { entity: MEDELLIN, matchedBy: 'exact' });
    const cali: PublicEntityRow = {
      taxId: '890399011',
      normalizedLegalName: 'SANTIAGO DE CALI DISTRITO ESPECIAL DEPORTIVO CULTURAL',
      shortName: 'Santiago de Cali',
      isHead: true,
    };
    assert.equal(pickPublicBuyer('Santiago de Cali', [cali]).entity, cali);
  });

  it('por el comienzo del nombre, prefiriendo la única cabeza', () => {
    const rows: PublicEntityRow[] = [
      { taxId: '899999001', normalizedLegalName: 'MINISTERIO DE EDUCACION NACIONAL', shortName: null, isHead: true },
      { taxId: '800000001', normalizedLegalName: 'MINISTERIO DE EDUCACION NACIONAL FONDO X', shortName: null, isHead: false },
    ];
    assert.deepEqual(pickPublicBuyer('Ministerio de Educación', rows), { entity: rows[0], matchedBy: 'prefix' });
  });

  it('dos posibles ⇒ no corre; una empresa privada ⇒ no corre', () => {
    const rows: PublicEntityRow[] = [
      { taxId: '1', normalizedLegalName: 'ALCALDIA DE SAN JOSE DEL GUAVIARE', shortName: null, isHead: true },
      { taxId: '2', normalizedLegalName: 'ALCALDIA DE SAN JOSE DE CUCUTA', shortName: null, isHead: true },
    ];
    assert.deepEqual(pickPublicBuyer('Alcaldía de San José', rows), { entity: null, reason: 'ambiguous_entity' });
    assert.deepEqual(pickPublicBuyer('Bancolombia', []), { entity: null, reason: 'not_public_entity' });
  });
});

describe('2. consultas a SECOP II', () => {
  it('Tecnología = informática (43), audiovisual (45) y familias de TI y telecomunicaciones', () => {
    assert.deepEqual(unspscPrefixesForMacro('technology'), ['43', '45', '8111', '8112', '8116', '8311', '8312']);
    assert.deepEqual(unspscPrefixesForMacro('government_public_sector'), []);
  });

  it('el periodo es el año en curso y los dos anteriores', () => {
    assert.equal(coSecopSinceDate('2026-10-14T00:00:00Z'), '2024-01-01');
  });

  it('la consulta pide sólo lo que se usa (nunca cuentas bancarias)', () => {
    const aggregate = new URL(buildCoSecopAggregateUrl({ buyerTaxId: '890905211', sinceDate: '2024-01-01', prefixes: ['43'] }));
    const url = `${aggregate.searchParams.get('$select')} ${aggregate.searchParams.get('$where')}`;
    assert.match(url, /nit_entidad='890905211'/);
    assert.match(url, /starts_with\(codigo_de_categoria_principal, 'V1\.43'\)/);
    const families = new URL(
      buildCoSecopFamiliesUrl({ buyerTaxId: '890905211', sinceDate: '2024-01-01', supplierTaxIds: ['900092385'] }),
    ).searchParams.get('$select') as string;
    for (const u of [url, families]) assert.doesNotMatch(u, /cuenta|banco|representante/i);
  });

  it('lee códigos y páginas de proceso', () => {
    assert.equal(parseUnspscCode('V1.81111500'), '81111500');
    assert.equal(parseUnspscCode('x'), null);
    const evidence = parseCoSecopEvidence([
      { documento_proveedor: '900092385', urlproceso: { url: 'https://community.secop.gov.co/a' } },
      { documento_proveedor: '900092385', urlproceso: { url: 'https://community.secop.gov.co/b' } },
      { documento_proveedor: '901140525', urlproceso: { url: 'javascript:alert(1)' } },
    ]);
    assert.equal(evidence.get('900092385'), 'https://community.secop.gov.co/a');
    assert.equal(evidence.has('901140525'), false);
  });

  it('la industria de cada proveedor es la de lo que más le vende a la entidad', async () => {
    const result = await fetchCoSecopSuppliers(
      { buyerTaxId: '890905211', macroIndustryKey: 'technology', nowIso: '2026-10-14T00:00:00Z' },
      async (url) => {
        const u = decodeURIComponent(url);
        if (u.includes('$group=documento_proveedor,codigo')) {
          return [
            { documento_proveedor: '900092385', codigo_de_categoria_principal: 'V1.81112000', total: '900' },
            { documento_proveedor: '900092385', codigo_de_categoria_principal: 'V1.72101500', total: '100' },
            // Vende sobre todo obra: aunque tenga algo de informática, no es de Tecnología.
            { documento_proveedor: '901140525', codigo_de_categoria_principal: 'V1.43211500', total: '100' },
            { documento_proveedor: '901140525', codigo_de_categoria_principal: 'V1.72101500', total: '900' },
          ];
        }
        if (u.includes('urlproceso')) return [{ documento_proveedor: '900092385', urlproceso: { url: 'https://community.secop.gov.co/p1' } }];
        return [
          { documento_proveedor: '900092385', proveedor: 'UNE TELECOMUNICACIONES S.A', total: '1000', n: '14', ultima: '2026-09-18T00:00:00.000' },
          { documento_proveedor: '901140525', proveedor: 'INOVISEC COLOMBIA SAS', total: '1000', n: '1' },
          { documento_proveedor: '890905211', proveedor: 'ALCALDIA', total: '5', n: '1' },
        ];
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.read, 2);
    assert.equal(result.outsideIndustry, 1);
    assert.deepEqual(
      result.suppliers.map((s) => [s.taxId, s.macroIndustryKey, s.evidenceUrl, s.lastSignedAt]),
      [['900092385', 'technology', 'https://community.secop.gov.co/p1', '2026-09-18']],
    );
  });

  it('SECOP caído ⇒ el paso no corre; industria sin códigos ⇒ ni se consulta', async () => {
    let calls = 0;
    const down = await fetchCoSecopSuppliers({ buyerTaxId: '1', macroIndustryKey: 'technology', nowIso: '2026-01-01' }, async () => {
      calls += 1;
      throw new Error('timeout');
    });
    assert.deepEqual(down, { ok: false, reason: 'source_unavailable' });
    const gov = await fetchCoSecopSuppliers({ buyerTaxId: '1', macroIndustryKey: 'government_public_sector', nowIso: '2026-01-01' }, async () => {
      calls += 1;
      return [];
    });
    assert.deepEqual(gov, { ok: false, reason: 'industry_without_unspsc' });
    assert.equal(calls, 1);
  });
});

function supplier(taxId: string, name: string): PublicBuyerSupplier {
  return {
    taxId,
    name,
    totalAmount: 68_831_223_037,
    contractCount: 14,
    lastSignedAt: '2026-09-18',
    macroIndustryKey: 'technology',
    macroShare: 0.9,
    rubro: 'Servicios informáticos',
    evidenceUrl: `https://community.secop.gov.co/${taxId}`,
  };
}

function stepDeps(overrides: Partial<PublicBuyerStepDeps> = {}) {
  const written: string[][] = [];
  const recorded: string[][] = [];
  const deps: PublicBuyerStepDeps = {
    sourceKey: 'co_secop2_buyer_suppliers',
    findPublicEntities: async () => [MEDELLIN],
    listSuppliers: async () => ({
      ok: true,
      suppliers: [supplier('900092385', 'UNE'), supplier('890984761', 'ESU'), supplier('901140525', 'INOVISEC')],
      read: 5,
      outsideIndustry: 2,
      tableVersion: 'py-unspsc-dncp-macro-v1',
    }),
    listPublicOnlyTaxIds: async () => new Set(['890984761']),
    findDomainsByTaxId: async () => new Map([['900092385', 'une.com.co']]),
    writeWithWebsite: async (companies) => {
      written.push(companies.map((c) => c.taxId ?? ''));
      return { written: companies.length, failed: false };
    },
    recordWithoutWebsite: async (companies) => {
      recorded.push(companies.map((c) => c.recordIdentityKey));
      return companies.length;
    },
    ...overrides,
  };
  return { deps, written, recorded };
}

const STEP_INPUT = {
  batchId: 'b1',
  referenceCompanyName: 'Alcaldía de Medellín',
  countryCode: 'CO',
  macroIndustryKey: 'technology',
  nowIso: '2026-10-14T00:00:00Z',
};

describe('3. el paso completo', () => {
  it('con web al lote, sin web a Descartadas con su NIT; fuera las entidades públicas', async () => {
    const f = stepDeps();
    const outcome = await runPublicBuyerSupplierStep(STEP_INPUT, f.deps);
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.deepEqual(f.written, [['900092385']]);
    assert.deepEqual(f.recorded, [['tax:901140525']]);
    assert.equal(outcome.publicEntitiesExcluded, 1);
    assert.equal(outcome.offered, 2);
    assert.equal(outcome.written, 1);
    assert.equal(outcome.recordedWithoutWebsite, 1);
    assert.deepEqual(outcome.buyer, { taxId: '890905211', name: 'ALCALDIA DE MEDELLIN', matchedBy: 'exact' });
    assert.equal(outcome.relationships[0].evidenceUrl, 'https://community.secop.gov.co/900092385');
  });

  it('fuera de Colombia y Chile, o una empresa privada, no corre', async () => {
    assert.deepEqual(await runPublicBuyerSupplierStep({ ...STEP_INPUT, countryCode: 'PE' }, stepDeps().deps), {
      executed: false,
      reason: 'country_not_supported',
    });
    const privateRef = stepDeps({ findPublicEntities: async () => [] });
    assert.deepEqual(await runPublicBuyerSupplierStep({ ...STEP_INPUT, referenceCompanyName: 'Bancolombia' }, privateRef.deps), {
      executed: false,
      reason: 'not_public_entity',
    });
  });

  it('la frase de la prueba', () => {
    assert.equal(
      describePublicBuyerSupplier(supplier('900092385', 'UNE'), 'Alcaldía de Medellín', '2024'),
      '14 contratos (servicios informáticos) con Alcaldía de Medellín en compras públicas desde 2024 por $68.831 millones; el último firmado el 2026-09-18.',
    );
  });
});

describe('4. «Proveedor de X» en los candidatos', () => {
  it('etiqueta por NIT y no pisa la relación de Claude', async () => {
    const updates: Array<[string, Record<string, unknown>]> = [];
    const tagged = await tagPublicBuyerSuppliers(
      {
        batchId: 'b1',
        referenceCompanyName: 'Alcaldía de Medellín',
        relationships: [
          { taxId: '900092385', name: 'UNE', evidenceUrl: 'https://community.secop.gov.co/p1', evidence: 'e1' },
          { taxId: '901140525', name: 'INOVISEC', evidenceUrl: null, evidence: 'e2' },
        ],
      },
      {
        loadCandidates: async () => [
          { id: 'c1', taxIdentifier: '900092385-1', metadata: { keep: 1 } },
          { id: 'c2', taxIdentifier: '901140525', metadata: { relationship: { kind: 'supplier_of', evidence_url: 'x' } } },
          { id: 'c3', taxIdentifier: null, metadata: null },
        ],
        updateMetadata: async (id, metadata) => (updates.push([id, metadata]), true),
      },
    );
    assert.equal(tagged, 1);
    assert.equal(updates[0][0], 'c1');
    assert.equal(updates[0][1].keep, 1);
    assert.deepEqual(updates[0][1].relationship, {
      kind: 'supplier_of',
      reference_company_name: 'Alcaldía de Medellín',
      evidence_url: 'https://community.secop.gov.co/p1',
      evidence: 'e1',
      source: 'public_procurement',
    });
  });
});
