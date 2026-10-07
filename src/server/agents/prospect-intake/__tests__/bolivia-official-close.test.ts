/**
 * SOURCES-BO-CLOSE-1 — Bolivia: la cadena del NIT en la corrida.
 *
 *   1. lista de grandes contribuyentes cargada (`bo_large_taxpayers`), con la
 *      categoría PRICO/GRACO hacia el filtro de tamaño;
 *   2. si no da NIT seguro, el SEPREC en vivo.
 * En los dos, una marca de una palabra o una marca dentro de UNA sola razón social
 * sólo es segura si la web propia de la candidata la confirma (dueña, 06-10).
 *
 * Lecturas y fetch dobles: cero E/S. NIT y razones sociales del SEPREC (06-10).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFallbackOfficialSourceResolver } from '../resolvers/fallback-official-source-resolver';
import {
  createSnapshotNameOfficialSourceResolver,
  type SnapshotNameRow,
} from '../resolvers/snapshot-name-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '../source-enrichment';
import type { NormalizedProspectCandidate } from '../types';
import {
  buildSeprecNameLiveQuery,
  normalizeBoliviaCompanyCore,
} from '@/server/source-catalog/connectors/seprec-bolivia/seprec-name-live-query';
import { boliviaDomainConfirmsName, boliviaNameCarriesLegalForm } from '@/server/source-catalog/connectors/seprec-bolivia/bo-company-name-core';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';

const noSleep = async () => {};

const hit = (id: string, razonSocial: string) => ({
  estado: 'ACTIVO',
  id,
  matricula: id,
  razonSocial,
  codEstadoActualizacion: { id: 16, codigo: '0', nombre: 'MATRICULA RENOVADA' },
  codTipoUnidadEconomica: { id: 23, codigo: '07', nombre: 'SOCIEDAD ANONIMA' },
  idEstablecimiento: id,
});

/** SEPREC doble: cada búsqueda responde según su filtro; cada ficha según su id. */
function fakeSeprec(searches: Record<string, unknown[]>, nits: Record<string, string>) {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    if (url.includes('/buscarEmpresas?')) {
      const filas = searches[new URL(url).searchParams.get('filtro') ?? ''] ?? [];
      return { ok: true, json: async () => ({ datos: { total: filas.length, filas } }) };
    }
    const id = /informacionBasicaEmpresa\/([^/]+)\//.exec(url)?.[1] ?? '';
    return { ok: true, json: async () => ({ datos: nits[id] ? { nit: nits[id] } : {} }) };
  };
  return { fetchImpl, urls };
}

/** La cadena de Bolivia, igual que en la fábrica, con lecturas dobles. */
function boliviaChain(snapshot: Record<string, SnapshotNameRow[]>, seprec: ReturnType<typeof fakeSeprec>) {
  return createFallbackOfficialSourceResolver(
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'BO',
      sourceKey: 'bo_large_taxpayers',
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{7,13}$/,
      normalizeCore: normalizeBoliviaCompanyCore,
      querySnapshots: async (core) => snapshot[core] ?? [],
      singleWordIsSignalOnly: true,
      singleWordConfirmedByDomain: boliviaDomainConfirmsName,
      nameCarriesLegalForm: boliviaNameCarriesLegalForm,
    }),
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'BO',
      sourceKey: 'bo_seprec_live',
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{7,13}$/,
      normalizeCore: normalizeBoliviaCompanyCore,
      querySnapshots: buildSeprecNameLiveQuery({ sleep: noSleep, fetchImpl: seprec.fetchImpl }),
      singleWordIsSignalOnly: true,
      singleWordConfirmedByDomain: boliviaDomainConfirmsName,
      nameCarriesLegalForm: boliviaNameCarriesLegalForm,
      brandConfirmedByDomain: boliviaDomainConfirmsName,
    }),
  );
}

function candidate(name: string, domain: string | null): NormalizedProspectCandidate {
  return {
    sourceProvider: 'web_ai',
    canonicalName: name,
    countryCode: 'BO',
    requestedCountryCode: 'BO',
    domain,
    websiteUrl: null,
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: {},
  } as unknown as NormalizedProspectCandidate;
}

async function resolve(chain: ReturnType<typeof boliviaChain>, name: string, domain: string | null) {
  const input = { candidate: candidate(name, domain), criteria: { countryCode: 'BO' }, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY };
  return chain.resolve(input);
}

const graco = (taxId: string, legalName: string): SnapshotNameRow => ({
  taxId,
  legalName,
  normalizedLegalName: normalizeBoliviaCompanyCore(legalName),
  workforce: workforceFromRawData({ taxpayer_category: 'GRACO', metrics_year: 2025 }, 'bo_large_taxpayers'),
});

describe('cableado', () => {
  it('la fábrica pone primero la lista de grandes contribuyentes y luego el SEPREC en vivo', () => {
    const wiring = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    const block = wiring.slice(wiring.indexOf('SOURCES-BO-CLOSE-1'));
    assert.match(block, /sourceKey: BO_LARGE_TAXPAYERS_SOURCE_KEY,[\s\S]*buildSnapshotNameQuery\(snapshotClient, BO_LARGE_TAXPAYERS_SOURCE_KEY, 'BO', \{ withWorkforce: true \}\)/);
    assert.ok(block.indexOf('BO_LARGE_TAXPAYERS_SOURCE_KEY') < block.indexOf('BO_SEPREC_LIVE_SOURCE_KEY'));
    assert.match(block, /querySnapshots: buildSeprecNameLiveQuery\(\),\s*singleWordIsSignalOnly: true,\s*singleWordConfirmedByDomain: boliviaDomainConfirmsName,\s*nameCarriesLegalForm: boliviaNameCarriesLegalForm,\s*brandConfirmedByDomain: boliviaDomainConfirmsName,/);
  });
});

describe('cadena del NIT de Bolivia', () => {
  it('gran contribuyente en la lista: NIT seguro sin tocar el SEPREC', async () => {
    const seprec = fakeSeprec({}, {});
    const chain = boliviaChain({ 'BOLIVIAN EXPRESS CARGO': [graco('1004333025', 'BOLIVIAN EXPRESS CARGO S.R.L.')] }, seprec);
    const out = await resolve(chain, 'Bolivian Express Cargo', 'bec.com.bo');
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '1004333025');
    assert.equal(out.sourceKey, 'bo_large_taxpayers');
    assert.equal(seprec.urls.length, 0);
  });

  it('no está en la lista: el SEPREC en vivo da el NIT', async () => {
    const seprec = fakeSeprec({ OPECEBOL: [hit('1', 'OPECEBOL S.R.L.')] }, { '1': '138215023' });
    const out = await resolve(boliviaChain({}, seprec), 'Opecebol S.R.L.', 'opecebol.com.bo');
    assert.equal(out.status, 'matched');
    assert.equal(out.sourceKey, 'bo_seprec_live');
    assert.equal(out.taxIdentifier, '138215023');
  });

  it('marca de UNA palabra: segura sólo si su web la confirma (datec.com.bo ↔ DATEC LTDA.)', async () => {
    const snapshot = { DATEC: [graco('1023456027', 'DATEC LTDA.')] };
    const withWeb = await resolve(boliviaChain(snapshot, fakeSeprec({}, {})), 'Datec Corp', 'datec.com.bo');
    assert.equal(withWeb.status, 'matched');
    assert.equal(withWeb.safeMetadata?.singleWordConfirmedByDomain, true);
    const otherWeb = await resolve(boliviaChain(snapshot, fakeSeprec({}, {})), 'Datec Corp', 'datec-ingenieria.com');
    assert.equal(otherWeb.status, 'low_confidence_match');
  });

  it('marca dentro de UNA razón social: NIT seguro si la web es la marca, pista si no', async () => {
    const searches = { ALPASUR: [hit('7', 'ALMACENES PACIFICO SUR S.A.  ALPASUR')] };
    const confirmed = await resolve(boliviaChain({}, fakeSeprec(searches, { '7': '1018285026' })), 'Alpasur', 'alpasur.com.bo');
    assert.equal(confirmed.status, 'matched');
    assert.equal(confirmed.taxIdentifier, '1018285026');
    assert.deepEqual(confirmed.safeMetadata, { normalizedSearchName: 'ALPASUR', brandInLegalName: true, brandConfirmedByDomain: true });

    const hint = await resolve(boliviaChain({}, fakeSeprec(searches, { '7': '1018285026' })), 'Alpasur', null);
    assert.equal(hint.status, 'low_confidence_match');
    const enriched = await enrichNormalizedProspectWithOfficialSources(candidate('Alpasur', null), { country: 'Bolivia', countryCode: 'BO' }, [boliviaChain({}, fakeSeprec(searches, { '7': '1018285026' }))], DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY);
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.equal(enriched.taxIdentifier, null);
  });

  it('entidad pública: ni la lista ni el SEPREC (ni una petición)', async () => {
    const seprec = fakeSeprec({}, {});
    const out = await resolve(boliviaChain({}, seprec), 'Caja Nacional de Salud', 'cnslp.gob.bo');
    assert.equal(out.status, 'not_found');
    assert.equal(seprec.urls.length, 0);
  });
});

describe('categoría de contribuyente → filtro de tamaño', () => {
  it('GRACO llega con el NIT seguro, queda explicada y NO decide (ni aprueba ni descarta)', async () => {
    const chain = boliviaChain({ 'BOLIVIAN EXPRESS CARGO': [graco('1004333025', 'BOLIVIAN EXPRESS CARGO S.R.L.')] }, fakeSeprec({}, {}));
    const out = await resolve(chain, 'Bolivian Express Cargo', 'bec.com.bo');
    assert.deepEqual(out.workforce, { workers: 0, year: 2025, source: 'bo_large_taxpayers', maxWorkers: null, sizeBand: 'gran contribuyente (GRACO)' });

    const registry = extractOfficialRegistryWorkforce({
      officialSourceIdentity: { strongIdentityAvailable: true, officialSourceMetadata: { workforce: out.workforce } },
    });
    const resolved = resolveEmployeeSizeForIcpGate({ threshold: 200, referenceYear: 2026, officialRegistryWorkforce: registry });
    assert.equal(resolved.selectedSource, 'unknown');
    const attempt = resolved.attemptedSources.find((a) => a.source === 'official_registry_workers');
    assert.equal(attempt?.usable, false);
    assert.match(attempt?.reason ?? '', /gran contribuyente \(GRACO\).*no decide/);
  });
});
