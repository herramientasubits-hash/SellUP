/**
 * Tests — arreglos de la auditoría de «Proveedores de una empresa»:
 *  - SECOP II: el mismo proveedor escrito con puntos o con dígito de verificación
 *    («900.123.456-7», «9001234567») se junta en un NIT y sus filas sí se encuentran.
 *  - SECOP II: fuera los contratos cancelados.
 *  - Paso común: fuera consorcios y uniones temporales en todos los países.
 *  - Paso común: si la búsqueda de la entidad llegó al tope, no se elige (ambigua).
 * Sin red: la llamada HTTP y las consultas se inyectan.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nitCheckDigit } from '@/server/source-catalog/connectors/co-public-entities/co-public-entity-rows';
import {
  buildCoSecopAggregateUrl,
  buildCoSecopEvidenceUrl,
  buildCoSecopFamiliesUrl,
  fetchCoSecopSuppliers,
  parseCoSecopAggregate,
} from '../co-secop-suppliers';
import {
  isConsortiumSupplierName,
  runPublicBuyerSupplierStep,
  type PublicBuyerStepDeps,
  type PublicBuyerSupplier,
  type PublicEntityRow,
} from '../public-buyer-suppliers';

const NIT = '900123456';
const DV = nitCheckDigit(NIT);
const DOTTED = `900.123.456-${DV}`;
const GLUED = `${NIT}${DV}`;

describe('1. SECOP II — NIT con puntos o dígito de verificación', () => {
  it('las formas crudas del mismo NIT se juntan: montos y contratos sumados, última firma, nombre de la de más monto', () => {
    const rows = parseCoSecopAggregate([
      { documento_proveedor: NIT, proveedor: 'SOFTWARE ANDINO SAS', total: '700', n: '3', ultima: '2025-05-01T00:00:00.000' },
      { documento_proveedor: '800111222', proveedor: 'OTRA SAS', total: '900', n: '1' },
      { documento_proveedor: DOTTED, proveedor: 'SOFTWARE ANDINO S.A.S.', total: '400', n: '2', ultima: '2026-02-10T00:00:00.000' },
      { documento_proveedor: GLUED, proveedor: 'SOFTWARE ANDINO', total: '100', n: '1' },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.taxId, r.name, r.totalAmount, r.contractCount, r.lastSignedAt, r.rawTaxIds]),
      [
        [NIT, 'SOFTWARE ANDINO SAS', 1200, 6, '2026-02-10', [NIT, DOTTED, GLUED]],
        ['800111222', 'OTRA SAS', 900, 1, null, ['800111222']],
      ],
    );
  });

  it('las consultas siguientes piden las formas crudas y el proveedor no se pierde como «otra industria»', async () => {
    const urls: string[] = [];
    const result = await fetchCoSecopSuppliers({ buyerTaxId: '890905211', macroIndustryKey: 'technology', nowIso: '2026-10-14T00:00:00Z' }, async (url) => {
      urls.push(url);
      const u = decodeURIComponent(url);
      if (u.includes('$group=documento_proveedor,codigo')) {
        // SECOP responde con la forma cruda de cada contrato: sólo la que tiene puntos trae la informática.
        return [
          { documento_proveedor: DOTTED, codigo_de_categoria_principal: 'V1.81112000', total: '900' },
          { documento_proveedor: GLUED, codigo_de_categoria_principal: 'V1.43211500', total: '200' },
        ];
      }
      if (u.includes('urlproceso')) return [{ documento_proveedor: GLUED, urlproceso: { url: 'https://community.secop.gov.co/p9' } }];
      return [
        { documento_proveedor: DOTTED, proveedor: 'SOFTWARE ANDINO SAS', total: '900', n: '2' },
        { documento_proveedor: GLUED, proveedor: 'SOFTWARE ANDINO SAS', total: '200', n: '1' },
      ];
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.read, 1, 'un solo proveedor, no dos');
    assert.equal(result.outsideIndustry, 0);
    assert.deepEqual(
      result.suppliers.map((s) => [s.taxId, s.totalAmount, s.contractCount, s.macroIndustryKey, s.evidenceUrl]),
      [[NIT, 1100, 3, 'technology', 'https://community.secop.gov.co/p9']],
    );
    assert.equal(Object.hasOwn(result.suppliers[0], 'rawTaxIds'), false, 'las formas crudas no salen del módulo');
    const families = new URL(urls.find((u) => decodeURIComponent(u).includes('$group=documento_proveedor,codigo'))!).searchParams.get('$where') ?? '';
    assert.match(families, new RegExp(`documento_proveedor in\\('${DOTTED.replace(/\./g, '\\.')}','${GLUED}'\\)`));
  });
});

describe('2. SECOP II — sin contratos cancelados', () => {
  it('las tres consultas excluyen estado «Cancelado» (sin estado cuenta)', () => {
    const input = { buyerTaxId: '890905211', sinceDate: '2024-01-01' };
    const wheres = [
      buildCoSecopAggregateUrl({ ...input, prefixes: ['43'] }),
      buildCoSecopFamiliesUrl({ ...input, supplierTaxIds: [NIT] }),
      buildCoSecopEvidenceUrl({ ...input, supplierTaxIds: [NIT] }),
    ].map((url) => new URL(url).searchParams.get('$where') ?? '');
    for (const where of wheres) assert.match(where, /\(estado_contrato IS NULL OR upper\(estado_contrato\) != 'CANCELADO'\)/);
  });
});

function supplier(taxId: string, name: string): PublicBuyerSupplier {
  return {
    taxId,
    name,
    totalAmount: 1_000_000_000,
    contractCount: 3,
    lastSignedAt: '2026-09-18',
    macroIndustryKey: 'technology',
    macroShare: 1,
    rubro: null,
    evidenceUrl: null,
  };
}

const BUYER: PublicEntityRow = { taxId: '890905211', normalizedLegalName: 'ALCALDIA DE MEDELLIN', shortName: null, isHead: true };
const INPUT = { batchId: 'b1', referenceCompanyName: 'Alcaldía de Medellín', countryCode: 'CO', macroIndustryKey: 'technology', nowIso: '2026-10-14T00:00:00Z' };

function deps(overrides: Partial<PublicBuyerStepDeps> = {}): PublicBuyerStepDeps & { askedPublic: string[][]; listed: number } {
  const state = { askedPublic: [] as string[][], listed: 0 };
  return Object.assign(state, {
    sourceKey: 'co_secop2_buyer_suppliers',
    findPublicEntities: async () => [BUYER],
    listSuppliers: async () => {
      state.listed += 1;
      return {
        ok: true as const,
        suppliers: [
          supplier('900000001', 'CONSORCIO VIAL MEDELLIN 2025'),
          supplier('900000002', 'Unión Temporal Salud Digital'),
          supplier('900000003', 'SOFTWARE ANDINO SAS'),
          supplier('900000004', '"CONSORCIO" TIC'),
          supplier('900000005', 'CONSORCIOS ASOCIADOS SAS'),
        ],
        read: 5,
        outsideIndustry: 0,
        tableVersion: 'v',
      };
    },
    listPublicOnlyTaxIds: async (taxIds: readonly string[]) => (state.askedPublic.push([...taxIds]), new Set<string>()),
    findDomainsByTaxId: async () => new Map<string, string>(),
    writeWithWebsite: async (companies: readonly unknown[]) => ({ written: companies.length, failed: false }),
    recordWithoutWebsite: async (companies: readonly unknown[]) => companies.length,
    ...overrides,
  });
}

describe('3. paso común — consorcios y uniones temporales', () => {
  it('reconoce consorcios y uniones temporales por el nombre (con tildes, comillas o al final)', () => {
    for (const name of ['CONSORCIO VIAL 2025', 'Consórcio Saúde', '"CONSORCIO" TIC', 'Unión Temporal Salud 2024', 'REDES DEL NORTE UNION TEMPORAL', 'UTE Obras Norte']) {
      assert.equal(isConsortiumSupplierName(name), true, name);
    }
    for (const name of ['CONSORCIOS ASOCIADOS SAS', 'TEMPORALES UNIDOS SAS', 'UTEC SOLUCIONES', 'SOFTWARE ANDINO SAS', null]) {
      assert.equal(isConsortiumSupplierName(name), false, String(name));
    }
  });

  it('no se ofrecen, se cuentan aparte y ni se consultan como entidades públicas', async () => {
    const d = deps();
    const outcome = await runPublicBuyerSupplierStep(INPUT, d);
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.consortiaExcluded, 3);
    assert.deepEqual(outcome.relationships.map((r) => r.taxId), ['900000003', '900000005']);
    assert.deepEqual(d.askedPublic, [['900000003', '900000005']]);
  });
});

describe('4. paso común — búsqueda de la entidad con tope', () => {
  it('lista cortada ⇒ ambigua: no corre ni pide proveedores', async () => {
    const d = deps({ findPublicEntities: async () => ({ rows: [BUYER], truncated: true }) });
    assert.deepEqual(await runPublicBuyerSupplierStep(INPUT, d), { executed: false, reason: 'ambiguous_entity' });
    assert.equal(d.listed, 0);
  });

  it('lista completa con aviso ⇒ corre como con la lista simple', async () => {
    const d = deps({ findPublicEntities: async () => ({ rows: [BUYER], truncated: false }) });
    const outcome = await runPublicBuyerSupplierStep(INPUT, d);
    assert.equal(outcome.executed && outcome.buyer.taxId, '890905211');
  });
});
