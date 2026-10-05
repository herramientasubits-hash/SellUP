/**
 * SOURCES-HN-RTN-BY-NAME-1 — Honduras: RTN por nombre desde las publicaciones
 * OCDS de ONCAE y SEFIN. Versiones con la forma real (05-10). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildHnOcdsRtnRows,
  cleanHondurasSupplierName,
  extractHondurasSuppliers,
  normalizeHondurasCompanyCore,
  normalizeHondurasJuridicalRtn,
} from '../hn-ocds-rtn-registry-rows';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';

const party = (scheme: string, id: string, legalName: string, roles = ['supplier']) => ({
  id: `HN-${id}`,
  name: legalName,
  identifier: { scheme, id, legalName },
  roles,
});
const release = (date: string, parties: unknown[]) => ({ ocid: 'ocds-x', date, parties });

describe('RTN de persona jurídica', () => {
  it('14 dígitos con un 9 en la quinta posición; acepta el prefijo HN-RTN- y guiones', () => {
    assert.equal(normalizeHondurasJuridicalRtn('08019001210297'), '08019001210297');
    assert.equal(normalizeHondurasJuridicalRtn('HN-RTN-0801-9001-210297'), '08019001210297');
    assert.equal(normalizeHondurasJuridicalRtn('05019995123456'), '05019995123456');
  });

  it('fuera: RTN de persona natural (año de nacimiento), largo distinto, vacío', () => {
    assert.equal(normalizeHondurasJuridicalRtn('08011985123456'), null);
    assert.equal(normalizeHondurasJuridicalRtn('08012001123456'), null);
    assert.equal(normalizeHondurasJuridicalRtn('0801900121029'), null);
    assert.equal(normalizeHondurasJuridicalRtn(null), null);
  });
});

describe('nombres', () => {
  it('quita las colas de HonduCompras y la forma societaria', () => {
    assert.equal(cleanHondurasSupplierName('INDUSTRIAS QUIBA, S.A. DE C.V. * Compra Menor'), 'INDUSTRIAS QUIBA, S.A. DE C.V.');
    assert.equal(cleanHondurasSupplierName('BODEGA LA NEGRITA  *MIPYME*'), 'BODEGA LA NEGRITA');
    assert.equal(normalizeHondurasCompanyCore('INDUSTRIAS QUIBA, S.A. DE C.V. * Compra Menor'), 'INDUSTRIAS QUIBA');
    assert.equal(normalizeHondurasCompanyCore('PAPELERIA HONDURAS S. DE R. L.'), 'PAPELERIA HONDURAS');
  });
});

describe('versiones OCDS → una fila por RTN', () => {
  it('sólo proveedores u oferentes con HN-RTN jurídico; nunca cédulas ni personas naturales', () => {
    const suppliers = extractHondurasSuppliers(
      release('2025-03-01T00:00:00Z', [
        party('HN-RTN', '08019001210297', 'MEDIOS UNIDOS S.A DE C.V *CM'),
        party('HN-RTN', '08011985123456', 'JUAN PEREZ'),
        party('HND-IDCARD', '0801198512345', 'MARIA LOPEZ'),
        party('HN-RTN', '08019999000001', 'COMPRADOR PUBLICO', ['buyer']),
      ]),
    );
    assert.deepEqual(suppliers, [{ rtn: '08019001210297', name: 'MEDIOS UNIDOS S.A DE C.V', date: '2025-03-01T00:00:00Z' }]);
  });

  it('gana la versión más reciente', () => {
    const rows = buildHnOcdsRtnRows(
      [
        ...extractHondurasSuppliers(release('2019-01-01T00:00:00Z', [party('HN-RTN', '08019001210297', 'MEDIOS UNIDOS S.A.')])),
        ...extractHondurasSuppliers(release('2025-03-01T00:00:00Z', [party('HN-RTN', '08019001210297', 'MEDIOS UNIDOS S.A DE C.V')])),
      ],
      { importedAt: '2026-10-05T00:00:00.000Z' },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].legal_name, 'MEDIOS UNIDOS S.A DE C.V');
    assert.equal(rows[0].normalized_legal_name, 'MEDIOS UNIDOS');
    assert.equal(rows[0].source_year, 2025);
    assert.deepEqual(rows[0].raw_data, { last_release: '2025-03-01' });
    assert.equal(rows[0].record_identity_key, 'tax:08019001210297');
  });

  it('grano fiscal: un RTN, una fila', () => {
    assert.equal(getSourceFamily('hn_ocds_rtn_registry'), 'TAX_GRAIN');
  });
});

describe('cableado y catálogo', () => {
  it('Honduras: la carga OCDS primero y el piloto de 72 filas de respaldo', () => {
    const wiring = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    const i = wiring.indexOf('sourceKey: HN_OCDS_RTN_SOURCE_KEY');
    const j = wiring.indexOf("sourceKey: 'hn_contrataciones_abiertas'");
    assert.ok(i > 0 && j > i);
    assert.match(wiring.slice(i - 300, i), /createFallbackOfficialSourceResolver\(/);
    assert.match(wiring.slice(i, j), /validTaxId: \/\^\\d\{4\}9\\d\{9\}\$\//);
  });

  it('catálogo: conectada en código, carga pendiente, fuera de las recomendaciones', () => {
    const s = CATALOG_SOURCES.find((source) => source.key === 'hn_ocds_rtn_registry');
    assert.ok(s);
    assert.deepEqual(s.countryCodes, ['HN']);
    assert.equal(s.aiFlowStatus, 'connected_identity_in_run');
    assert.equal(s.operationalStatus, 'pending_validation');
    for (const depth of ['basic', 'standard', 'deep'] as const) {
      const ctx = getCatalogContext({ country: 'Honduras', countryCode: 'HN', industry: 'technology', searchDepth: depth });
      assert.equal(ctx.recommendedSources.some((r) => r.key === 'hn_ocds_rtn_registry'), false, depth);
    }
  });
});
