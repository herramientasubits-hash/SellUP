/**
 * Tests — web por NOMBRE para proveedores de compras públicas (AGENT1-SUPPLIER-WEB-BY-NAME-1,
 * auditoría 21-10, bloque «Próximo»).
 *
 * Por número fiscal ya no había más webs; los directorios del país sí tienen webs pero sin
 * número fiscal. Por nombre exacto (sin forma societaria), con una sola web por nombre,
 * entran gratis sin pasar por el rescate de Claude. Prod 21-10 (proveedores con 3 o más
 * entidades): México 14, Panamá 26, Costa Rica 21. Sin red, sin Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { companyNameKey, indexWebsitesByName, matchWebsitesByName } from '../website-by-name';
import { runPublicBuyerSupplierStep, type PublicBuyerStepDeps, type PublicBuyerSupplier } from '../public-buyer-suppliers';
import { buildLoadedLinksLookups, NAMED_WEBSITE_PAGE_SIZE } from '../countries/loaded-lookups.server';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import type { LoadedCountrySource } from '../countries/types';

describe('1. la llave del nombre', () => {
  it('quita forma societaria, tildes, puntuación y artículos (casos reales de Prod)', () => {
    assert.equal(companyNameKey('Cable & Wireless Panamá, S. A.'), 'CABLE WIRELESS PANAMA');
    assert.equal(companyNameKey('EDENRED MEXICO SA DE CV'), 'EDENRED MEXICO');
    assert.equal(companyNameKey('Edenred México, S.A. de C.V.'), 'EDENRED MEXICO');
    assert.equal(companyNameKey('GBM DE COSTA RICA SOCIEDAD ANONIMA'), 'GBM COSTA RICA');
    assert.equal(companyNameKey('AUTOMEKANO CIA. LTDA.'), 'AUTOMEKANO');
    assert.equal(companyNameKey('GILEAD SCIENCES MEXICO S DE RL DE CV'), 'GILEAD SCIENCES MEXICO');
  });

  it('muy corto ⇒ sin llave (no se arriesga)', () => {
    assert.equal(companyNameKey('ABC S.A.'), null);
    assert.equal(companyNameKey(''), null);
    assert.equal(companyNameKey(null), null);
  });
});

describe('2. índice y cruce', () => {
  it('un nombre con dos webs distintas no da ninguna; con la misma web repetida, sí', () => {
    const index = indexWebsitesByName([
      { legalName: 'Durman Esquivel S.A.', host: 'durman.com' },
      { legalName: 'DURMAN ESQUIVEL SOCIEDAD ANONIMA', host: 'durman.com' },
      { legalName: 'Grupo Andino SA', host: 'grupoandino.com' },
      { legalName: 'GRUPO ANDINO S.A.C.', host: 'andinogroup.pe' },
    ]);
    assert.equal(index.get('DURMAN ESQUIVEL'), 'durman.com');
    assert.equal(index.has('GRUPO ANDINO'), false);
  });

  it('cruza por número fiscal del proveedor; nada parecido, sólo idéntico', () => {
    const index = indexWebsitesByName([{ legalName: 'Holcim (Costa Rica) S. A.', host: 'holcim.cr' }]);
    const matched = matchWebsitesByName(
      [
        { taxId: '3101012345', name: 'HOLCIM COSTA RICA SOCIEDAD ANONIMA' },
        { taxId: '3101099999', name: 'HOLCIM COSTA RICA LOGISTICA SOCIEDAD ANONIMA' },
      ],
      index,
    );
    assert.deepEqual([...matched], [['3101012345', 'holcim.cr']]);
  });
});

describe('3. el paso de compras públicas la usa sólo para los que siguen sin web', () => {
  const supplier = (taxId: string, name: string): PublicBuyerSupplier => ({
    taxId,
    name,
    totalAmount: 1_000_000,
    contractCount: 2,
    lastSignedAt: '2026-09-01',
    macroIndustryKey: 'technology',
    macroShare: 1,
    rubro: null,
    evidenceUrl: null,
  });

  function deps(overrides: Partial<PublicBuyerStepDeps> = {}) {
    const asked: string[][] = [];
    const written: Array<[string, string | null]> = [];
    const d: PublicBuyerStepDeps = {
      sourceKey: 'cr_sicop_awards',
      findPublicEntities: async () => [{ taxId: 'CCSS', normalizedLegalName: 'CAJA COSTARRICENSE DE SEGURO SOCIAL', shortName: null, isHead: true }],
      listSuppliers: async () => ({
        ok: true,
        suppliers: [supplier('3101000001', 'GBM DE COSTA RICA SA'), supplier('3101000002', 'DURMAN ESQUIVEL SA'), supplier('3101000003', 'SIN WEB SA')],
        read: 3,
        outsideIndustry: 0,
        tableVersion: 't1',
      }),
      listPublicOnlyTaxIds: async () => new Set<string>(),
      findDomainsByTaxId: async () => new Map([['3101000001', 'gbm.net']]),
      findDomainsByName: async (companies) => {
        asked.push(companies.map((c) => c.taxId));
        return new Map([['3101000002', 'durman.com']]);
      },
      writeWithWebsite: async (companies) => {
        written.push(...companies.map((c): [string, string | null] => [c.taxId ?? '', c.domain]));
        return { written: companies.length, failed: false };
      },
      recordWithoutWebsite: async (companies) => companies.length,
      ...overrides,
    };
    return { d, asked, written };
  }

  const INPUT = {
    batchId: 'b1',
    referenceCompanyName: 'Caja Costarricense de Seguro Social',
    countryCode: 'CR',
    macroIndustryKey: 'technology',
    nowIso: '2026-10-21T00:00:00.000Z',
  };

  it('por nombre sólo pregunta por las que el número fiscal no resolvió; esas se escriben con web', async () => {
    const f = deps();
    const outcome = await runPublicBuyerSupplierStep(INPUT, f.d);
    assert.deepEqual(f.asked, [['3101000002', '3101000003']]);
    assert.deepEqual(f.written, [
      ['3101000001', 'gbm.net'],
      ['3101000002', 'durman.com'],
    ]);
    assert.equal(outcome.executed && outcome.websitesByName, 1);
    assert.equal(outcome.executed && outcome.recordedWithoutWebsite, 1);
  });

  it('si la búsqueda por nombre falla, siguen sin web (al rescate) y la corrida no cae', async () => {
    const f = deps({
      findDomainsByName: async () => {
        throw new Error('timeout');
      },
    });
    const outcome = await runPublicBuyerSupplierStep(INPUT, f.d);
    assert.equal(outcome.executed && outcome.written, 1);
    assert.equal(outcome.executed && outcome.recordedWithoutWebsite, 2);
    assert.equal(outcome.executed && outcome.websitesByName, 0);
  });
});

describe('4. países cargados: lee las fichas con web del país una vez por corrida', () => {
  const COUNTRY: LoadedCountrySource = {
    kind: 'loaded',
    countryCode: 'MX',
    sourceKey: 'mx_test',
    taxIdentifierType: 'RFC',
    currency: 'MXN',
    minPairAmount: 1,
    normalizeBuyerName: normalizePublicEntityName,
    classifier: UNSPSC_CLASSIFIER,
    domainSourceKeys: [],
    workersSourceKeys: [],
  };

  function client(rows: Array<Record<string, unknown>>, calls: Array<Record<string, unknown>>, fail = false): SupabaseClient {
    return {
      from: (table: string) => {
        const call: Record<string, unknown> = { table };
        calls.push(call);
        const builder: Record<string, unknown> = {};
        builder.select = (cols: string) => ((call.select = cols), builder);
        builder.eq = (col: string, value: unknown) => ((call[`eq:${col}`] = value), builder);
        builder.not = (col: string, op: string, value: unknown) => ((call[`not:${col}`] = `${op} ${value}`), builder);
        builder.or = (filter: string) => ((call.or = filter), builder);
        builder.order = () => builder;
        builder.range = (from: number, to: number) => ((call.range = [from, to]), builder);
        builder.then = (resolve: (v: unknown) => unknown) =>
          resolve(fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null });
        return builder;
      },
    } as unknown as SupabaseClient;
  }

  it('consulta del país sin entidades públicas, y cruza', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const lookups = buildLoadedLinksLookups(
      COUNTRY,
      client(
        [
          { legal_name: 'Edenred México, S.A. de C.V.', website_domain: 'https://www.edenred.mx/', website: null },
          { legal_name: 'Compucad SA de CV', website_domain: null, website: 'compucad.com.mx' },
        ],
        calls,
      ),
    );
    const found = await lookups.findDomainsByName!([
      { taxId: 'EME0101', name: 'EDENRED MEXICO SA DE CV' },
      { taxId: 'COM0202', name: 'COMPUCAD SA DE CV' },
      { taxId: 'OTR0303', name: 'OTRA EMPRESA SA DE CV' },
    ]);
    assert.deepEqual([...found].sort(), [
      ['COM0202', 'compucad.com.mx'],
      ['EME0101', 'edenred.mx'],
    ]);
    // Segunda llamada en la misma corrida: no vuelve a leer.
    await lookups.findDomainsByName!([{ taxId: 'EME0101', name: 'EDENRED MEXICO SA DE CV' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, 'source_company_snapshots');
    assert.equal(calls[0]['eq:country_code'], 'MX');
    assert.equal(calls[0]['not:source_key'], 'like %public_entities');
    assert.deepEqual(calls[0].range, [0, NAMED_WEBSITE_PAGE_SIZE - 1]);
  });

  it('un error de lectura se lanza (el paso lo registra) y la próxima vez se reintenta', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const lookups = buildLoadedLinksLookups(COUNTRY, client([], calls, true));
    await assert.rejects(() => lookups.findDomainsByName!([{ taxId: 'X', name: 'EDENRED MEXICO SA' }]), /named_websites_failed/);
    await assert.rejects(() => lookups.findDomainsByName!([{ taxId: 'X', name: 'EDENRED MEXICO SA' }]), /named_websites_failed/);
    assert.equal(calls.length, 2);
  });
});
