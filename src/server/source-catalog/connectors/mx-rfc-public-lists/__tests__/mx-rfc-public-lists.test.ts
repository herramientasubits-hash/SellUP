/**
 * SOURCES-MX-RFC-PUBLIC-LISTS-1 — RFC de personas morales de listas públicas
 * (SAT importadores y donatarias, proveedores de Nuevo León) y su uso como
 * respaldo de CompraNet en el RFC por nombre. Datos sintéticos; cero red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMxRfcPublicListsRows,
  normalizeMxStratification,
  MX_RFC_PUBLIC_LISTS_SOURCE_KEY,
  type MxRfcPublicListEntry,
} from '../mx-rfc-public-lists-rows';
import { normalizeMexicoCompanyCore } from '@/server/source-catalog/connectors/compranet-mexico/mx-compranet-rfc-rows';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { createFallbackOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/fallback-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const params = { importedAt: '2026-10-06T00:00:00.000Z', sourceYear: 2026 };
const entry = (rfc: string, name: string, list: string, extra = ''): MxRfcPublicListEntry => ({ rfc, name, list, extra });

describe('filas de las listas públicas', () => {
  it('una fila por RFC moral; gana el nombre de la lista preferida; guarda listas, tipo y tamaño', () => {
    const rows = buildMxRfcPublicListsRows(
      [
        entry('USI060201AB2', 'UNIV SINTETICA AC', 'sat_importadores'),
        entry('USI060201AB2', 'UNIVERSIDAD SINTETICA, A.C.', 'sat_donatarias', 'B'),
        entry('USI060201AB2', 'UNIVERSIDAD SINTETICA AC', 'nl_proveedores', 'grande'),
      ],
      params,
    );
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.source_key, MX_RFC_PUBLIC_LISTS_SOURCE_KEY);
    assert.equal(row.legal_name, 'UNIVERSIDAD SINTETICA, A.C.');
    assert.equal(row.normalized_legal_name, 'UNIVERSIDAD SINTETICA');
    assert.deepEqual(row.raw_data, {
      lists: ['sat_donatarias', 'nl_proveedores', 'sat_importadores'],
      donataria_type: 'B',
      stratification: 'GRANDE',
    });
    assert.ok(row.record_identity_key);
  });

  it('fuera: personas físicas (13), RFC imposibles, listas desconocidas, nombres vacíos o sin núcleo', () => {
    const rows = buildMxRfcPublicListsRows(
      [
        entry('PEMJ800101AB1', 'JUAN PEREZ', 'sat_importadores'),
        entry('AAA931321IJ4', 'MES IMPOSIBLE SA DE CV', 'sat_importadores'),
        entry('AAA930521IJ4', 'LISTA RARA SA DE CV', 'otra_lista'),
        entry('BBB930521IJ4', '   ', 'sat_importadores'),
        entry('CCC930521IJ4', 'X.', 'sat_importadores'),
      ],
      params,
    );
    assert.deepEqual(rows, []);
  });

  it('extras sólo cuando tienen sentido (letra de donataria, estrato conocido)', () => {
    const [row] = buildMxRfcPublicListsRows(
      [entry('DDD930521IJ4', 'EMPRESA SINTETICA SA DE CV', 'nl_proveedores', 'ESTRATIFICACIÓN'), entry('DDD930521IJ4', 'EMPRESA SINTETICA AC', 'sat_donatarias', 'educativa')],
      params,
    );
    assert.deepEqual(row.raw_data, { lists: ['sat_donatarias', 'nl_proveedores'] });
  });

  it('estratificación de CDMX: «Micro», «Grande», «No es MyPIME» (sic) → tramo conocido', () => {
    assert.equal(normalizeMxStratification('Micro'), 'MICRO');
    assert.equal(normalizeMxStratification('Grande'), 'GRANDE');
    assert.equal(normalizeMxStratification('No es MyPIME'), 'GRANDE');
    assert.equal(normalizeMxStratification('No es MIPYME'), 'GRANDE');
    assert.equal(normalizeMxStratification('PEQUENA'), 'PEQUEÑA');
    assert.equal(normalizeMxStratification('Ver nota aclaratoria'), null);
    assert.equal(normalizeMxStratification('No se cuenta con el dato'), null);
  });

  it('CDMX: el primer tamaño declarado gana (el extractor entrega del año más nuevo al más viejo)', () => {
    const [row] = buildMxRfcPublicListsRows(
      [
        entry('EEE930521IJ4', 'EMPRESA SINTETICA SA DE CV', 'cdmx_proveedores', 'Micro'),
        entry('EEE930521IJ4', 'EMPRESA SINTETICA SA DE CV', 'cdmx_proveedores', 'MEDIANA'),
        entry('EEE930521IJ4', 'EMPRESA SINTETICA SA DE CV', 'cdmx_proveedores_datos', ''),
      ],
      params,
    );
    assert.deepEqual(row.raw_data, { lists: ['cdmx_proveedores', 'cdmx_proveedores_datos'], stratification: 'MICRO' });
  });

  it('la familia de la fuente es TAX_GRAIN', () => {
    assert.equal(getSourceFamily(MX_RFC_PUBLIC_LISTS_SOURCE_KEY), 'TAX_GRAIN');
  });
});

describe('respaldo de CompraNet en el RFC por nombre', () => {
  const COMPRANET = [{ taxId: 'TEL840315KT6', name: 'TELEFONOS DE MEXICO SAB DE CV' }];
  const LISTS = [
    { taxId: 'USI060201AB2', name: 'UNIVERSIDAD SINTETICA, A.C.' },
    { taxId: 'TEX010101AA1', name: 'TELEFONOS DE MEXICO SA DE CV' },
    { taxId: 'AMB010101AA1', name: 'AMBIGUA SINTETICA SA DE CV' },
    { taxId: 'AMB020202BB2', name: 'AMBIGUA SINTETICA SC' },
  ];
  const resolver = (sourceKey: string, rows: { taxId: string; name: string }[]) =>
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'MX',
      sourceKey,
      taxIdentifierType: 'RFC',
      validTaxId: /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/,
      normalizeCore: normalizeMexicoCompanyCore,
      querySnapshots: async (core) =>
        rows
          .map((row) => ({ taxId: row.taxId, legalName: row.name, normalizedLegalName: normalizeMexicoCompanyCore(row.name) }))
          .filter((row) => row.normalizedLegalName === core),
      singleWordIsSignalOnly: true,
    });
  const mx = createFallbackOfficialSourceResolver(
    resolver('mx_compranet_rfc_registry', COMPRANET),
    resolver(MX_RFC_PUBLIC_LISTS_SOURCE_KEY, LISTS),
  );
  const enrich = (canonicalName: string) =>
    enrichNormalizedProspectWithOfficialSources(
      { sourceProvider: 'apollo', canonicalName, countryCode: 'MX', requestedCountryCode: 'MX', domain: null, websiteUrl: null, warnings: [], issues: [], providerMetadataSafe: {}, trace: {} } as unknown as NormalizedProspectCandidate,
      { country: 'México', countryCode: 'MX' },
      [mx],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );

  it('CompraNet sin coincidencia → la lista da el RFC fuerte y dice de dónde salió', async () => {
    const enriched = await enrich('Universidad Sintética AC');
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, 'USI060201AB2');
    assert.equal(enriched.officialSource.sourceKey, MX_RFC_PUBLIC_LISTS_SOURCE_KEY);
  });

  it('CompraNet manda cuando tiene coincidencia segura', async () => {
    const enriched = await enrich('Teléfonos de México, S.A.B. de C.V.');
    assert.equal(enriched.taxIdentifier, 'TEL840315KT6');
    assert.equal(enriched.officialSource.sourceKey, 'mx_compranet_rfc_registry');
  });

  it('dos RFC con el mismo núcleo en la lista → nunca fuerte', async () => {
    const enriched = await enrich('Ambigua Sintética SA de CV');
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.equal(enriched.taxIdentifier, null);
  });
});
