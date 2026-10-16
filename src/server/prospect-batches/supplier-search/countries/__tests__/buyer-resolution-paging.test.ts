/**
 * Tests — arreglos de la auditoría en las consultas de «Proveedores de una empresa»:
 *  - Países «loaded»: la entidad se reconoce entre compradores DISTINTOS (una entidad con
 *    miles de filas ya no tapa a las demás); más candidatas que el tope ⇒ ambigua.
 *  - Países «loaded»: los proveedores se leen por páginas hasta llenar la industria pedida
 *    (antes: 200 filas por monto y la industria se filtraba después ⇒ resultados vacíos).
 *  - Colombia: el nombre de la referencia se normaliza como `normalized_legal_name` de
 *    co_public_entities; lista con tope alcanzado ⇒ ambigua.
 * Doble de Supabase con filtros, orden y cortes reales (sin red, sin Producción).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeColombiaCompanyNameCore } from '@/server/source-catalog/connectors/personas-juridicas-cc-colombia/co-company-name-core';
import type { ProcurementLinkRow } from '../../procurement-links';
import { normalizePublicEntityName, pickPublicBuyer, type PublicEntityLookup, type PublicEntityRow } from '../../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER } from '../../unspsc-classifier';
import { CO_COUNTRY } from '../co';
import { buildCoLookups, CO_ENTITY_QUERY_LIMIT } from '../co.server';
import {
  BUYER_CANDIDATE_LIMIT,
  buildLoadedLinksLookups,
  SUPPLIER_PAGE_SIZE,
  SUPPLIER_TARGET_IN_INDUSTRY,
} from '../loaded-lookups.server';
import type { LoadedCountrySource } from '../types';
import { fakeClient, runStep } from './loaded-country-harness';

const COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'PE',
  sourceKey: 'pe_test',
  taxIdentifierType: 'RUC',
  currency: 'PEN',
  minPairAmount: 1,
  normalizeBuyerName: normalizePublicEntityName,
  classifier: UNSPSC_CLASSIFIER,
  domainSourceKeys: [],
  workersSourceKeys: [],
};

/** Fila cargada entidad × proveedor; `family` decide la industria (4321 = informática). */
function link(buyerCode: string, buyerName: string, supplierTaxId: string, amount: number, family: string): ProcurementLinkRow {
  return {
    country_code: COUNTRY.countryCode,
    source_key: COUNTRY.sourceKey,
    buyer_code: buyerCode,
    buyer_tax_id: null,
    buyer_name: buyerName,
    buyer_name_normalized: buyerName,
    buyer_sector: null,
    supplier_tax_id: supplierTaxId,
    supplier_name: `PROVEEDOR ${supplierTaxId} SAC`,
    total_amount: amount,
    currency: 'PEN',
    order_count: 1,
    amount_by_family: { [family]: amount },
    first_order_on: null,
    last_order_on: '2026-09-01',
    top_order_code: null,
    top_order_url: null,
    top_order_amount: null,
    window_start: '2025-10-01',
    window_end: '2026-09-30',
  };
}

/** `n` proveedores de una entidad, de más a menos monto. */
function manyLinks(buyerCode: string, buyerName: string, n: number, family: string, startAmount = 1_000_000): ProcurementLinkRow[] {
  return Array.from({ length: n }, (_, i) => link(buyerCode, buyerName, `${buyerCode}-${String(i).padStart(4, '0')}`, startAmount - i, family));
}

const asLookup = (found: PublicEntityRow[] | PublicEntityLookup): PublicEntityLookup => (Array.isArray(found) ? { rows: found, truncated: false } : found);

describe('1. «loaded» — la entidad entre compradores distintos', () => {
  it('una entidad con 450 filas no tapa a la otra que empieza igual ⇒ ambigua (antes elegía la primera)', async () => {
    const links = [...manyLinks('A1', 'HOSPITAL CENTRAL NORTE', 450, '4321'), ...manyLinks('B2', 'HOSPITAL CENTRAL SUR', 3, '4321')];
    const lookups = buildLoadedLinksLookups(COUNTRY, fakeClient({ public_procurement_supplier_links: links as unknown as Array<Record<string, unknown>> }));
    const found = asLookup(await lookups.findPublicEntities('HOSPITAL CENTRAL'));
    assert.equal(found.truncated, false);
    assert.deepEqual(found.rows.map((r) => r.taxId), ['A1', 'B2']);
    assert.deepEqual(pickPublicBuyer('Hospital Central', found.rows), { entity: null, reason: 'ambiguous_entity' });
  });

  it('el nombre exacto decide aunque haya muchas que empiezan igual', async () => {
    const links = [
      ...manyLinks('M0', 'MINISTERIO DE SALUD', 300, '4321'),
      ...Array.from({ length: BUYER_CANDIDATE_LIMIT + 5 }, (_, i) => link(`M${i + 1}`, `MINISTERIO DE SALUD REGION ${i + 1}`, `S${i}`, 50_000, '4321')),
    ];
    const { outcome } = await runStep(COUNTRY, links, [], { referenceCompanyName: 'Ministerio de Salud', macroIndustryKey: 'technology' });
    assert.equal(outcome.executed && outcome.buyer.taxId, 'M0');
    assert.equal(outcome.executed && outcome.buyer.matchedBy, 'exact');
  });

  it('más entidades candidatas que el tope ⇒ lista cortada ⇒ el paso no corre', async () => {
    const links = Array.from({ length: BUYER_CANDIDATE_LIMIT + 1 }, (_, i) =>
      link(`C${String(i).padStart(3, '0')}`, `MUNICIPALIDAD DISTRITAL ${String(i).padStart(3, '0')}`, `S${i}`, 50_000, '4321'),
    );
    const lookups = buildLoadedLinksLookups(COUNTRY, fakeClient({ public_procurement_supplier_links: links as unknown as Array<Record<string, unknown>> }));
    const found = asLookup(await lookups.findPublicEntities('MUNICIPALIDAD DISTRITAL'));
    assert.equal(found.truncated, true);
    const { outcome } = await runStep(COUNTRY, links, [], { referenceCompanyName: 'Municipalidad Distrital', macroIndustryKey: 'technology' });
    assert.deepEqual(outcome, { executed: false, reason: 'ambiguous_entity' });
  });
});

describe('2. «loaded» — proveedores por páginas hasta llenar la industria', () => {
  it('250 de obra con más monto y 10 de informática al final: salen las 10 (antes 0)', async () => {
    assert.notEqual(UNSPSC_CLASSIFIER.classify({ '7210': 1 })?.macroIndustryKey, 'technology');
    const links = [...manyLinks('B1', 'MINISTERIO DE OBRAS', 250, '7210', 9_000_000), ...manyLinks('B1', 'MINISTERIO DE OBRAS', 10, '4321', 10_000).map((l, i) => ({ ...l, supplier_tax_id: `T${i}` }))];
    const lookups = buildLoadedLinksLookups(COUNTRY, fakeClient({ public_procurement_supplier_links: links as unknown as Array<Record<string, unknown>> }));
    const r = await lookups.listSuppliers({ buyerTaxId: 'B1', macroIndustryKey: 'technology', nowIso: '2026-10-15' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.suppliers.length, 10);
    assert.equal(r.read, 260);
    assert.equal(r.outsideIndustry, 250);
    assert.deepEqual(r.suppliers.slice(0, 2).map((s) => s.taxId), ['T0', 'T1'], 'de más a menos monto');
  });

  it('con la industria ya llena en la primera página no se sigue leyendo', async () => {
    assert.ok(SUPPLIER_PAGE_SIZE >= SUPPLIER_TARGET_IN_INDUSTRY);
    const links = manyLinks('B1', 'MINISTERIO DE TIC', 700, '4321');
    const queries: Record<string, number> = {};
    const lookups = buildLoadedLinksLookups(COUNTRY, fakeClient({ public_procurement_supplier_links: links as unknown as Array<Record<string, unknown>> }, queries));
    const r = await lookups.listSuppliers({ buyerTaxId: 'B1', macroIndustryKey: 'technology', nowIso: '2026-10-15' });
    assert.equal(r.ok && r.read, SUPPLIER_PAGE_SIZE);
    assert.equal(queries.public_procurement_supplier_links, 1);
  });
});

describe('3. Colombia — mismo normalizador en los dos lados y tope', () => {
  const entity = (taxId: string, legalName: string, head = false) => ({
    source_key: 'co_public_entities',
    tax_id: taxId,
    normalized_legal_name: normalizeColombiaCompanyNameCore(legalName),
    raw_data: { chip_name: null, entity_head: head },
  });

  it('«Empresas Públicas de Medellín E.S.P.» coincide con el nombre cargado (sin «ESP»)', async () => {
    const lookups = buildCoLookups(fakeClient({ source_company_snapshots: [entity('890904996', 'EMPRESAS PUBLICAS DE MEDELLIN E.S.P.')] }));
    const normalize = lookups.normalizeName!;
    assert.equal(normalize, CO_COUNTRY.normalizeBuyerName);
    const wanted = normalize('Empresas Públicas de Medellín E.S.P.');
    assert.equal(wanted, 'EMPRESAS PUBLICAS DE MEDELLIN');
    assert.notEqual(normalizePublicEntityName('Empresas Públicas de Medellín E.S.P.'), wanted, 'el normalizador anterior no coincidía');
    const found = asLookup(await lookups.findPublicEntities(wanted));
    const picked = pickPublicBuyer('Empresas Públicas de Medellín E.S.P.', found.rows, normalize);
    assert.equal(picked.entity?.taxId, '890904996');
  });

  it('más filas que el tope ⇒ lista cortada (orden fijo, nunca un trozo cualquiera)', async () => {
    const rows = Array.from({ length: CO_ENTITY_QUERY_LIMIT + 1 }, (_, i) => entity(String(800000000 + i), `HOSPITAL SAN JOSE ${String(i).padStart(3, '0')}`));
    const lookups = buildCoLookups(fakeClient({ source_company_snapshots: rows }));
    const found = asLookup(await lookups.findPublicEntities('HOSPITAL SAN JOSE'));
    assert.equal(found.truncated, true);
    assert.equal(found.rows.length, CO_ENTITY_QUERY_LIMIT);
    assert.equal(found.rows[0].taxId, '800000000');
    const complete = asLookup(await buildCoLookups(fakeClient({ source_company_snapshots: rows.slice(0, 3) })).findPublicEntities('HOSPITAL SAN JOSE'));
    assert.equal(complete.truncated, false);
  });
});
