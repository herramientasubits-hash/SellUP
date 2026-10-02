/**
 * SOURCES-BO-NIT-BY-NAME-LIVE-1 — Bolivia: NIT por nombre en vivo contra el SEPREC.
 * Respuestas con la forma real de la API (02-10). Fetch doble: nunca sale a la red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BO_SEPREC_MAX_CONSECUTIVE_FAILURES,
  BO_SEPREC_MAX_LOOKUPS_PER_RUN,
  BO_SEPREC_TOTAL_BUDGET_MS,
  buildSeprecDetailUrl,
  buildSeprecNameLiveQuery,
  buildSeprecSearchUrl,
  normalizeBoliviaCompanyCore,
  parseSeprecDetailNit,
  parseSeprecSearch,
} from '../seprec-name-live-query';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import { getTaxIdentifierRule, validateTaxIdentifier } from '@/modules/prospect-batches/tax-identifier-rules';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const hit = (id: string, razonSocial: string, overrides: Record<string, unknown> = {}) => ({
  estado: 'ACTIVO',
  id,
  matricula: id,
  razonSocial,
  codEstadoActualizacion: { id: 16, codigo: '0', nombre: 'MATRICULA RENOVADA' },
  codTipoUnidadEconomica: { id: 23, codigo: '07', nombre: 'SOCIEDAD ANONIMA' },
  direccion: { id: '1', codDepartamento: { id: 425, codigo: '07', nombre: 'SANTA CRUZ' } },
  idEstablecimiento: id,
  ...overrides,
});
const search = (filas: unknown[]) => ({ finalizado: true, datos: { total: filas.length, filas, tipoFiltro: 'nombre' } });
const detail = (nit: string) => ({ finalizado: true, datos: { nit, razonSocial: 'X', contactos: [{ correo: 'persona@ejemplo.bo' }] } });

/** Fetch doble: responde la búsqueda y las fichas según la URL. */
function fakeSeprec(searchBody: unknown, details: Record<string, unknown>) {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    if (url.includes('/buscarEmpresas?')) return { ok: true, json: async () => searchBody };
    const id = /informacionBasicaEmpresa\/([^/]+)\//.exec(url)?.[1] ?? '';
    return { ok: true, json: async () => details[id] ?? {} };
  };
  return { fetchImpl, urls };
}

describe('URLs y lectura de respuestas', () => {
  it('búsqueda por nombre y ficha básica', () => {
    const url = new URL(buildSeprecSearchUrl('CERVECERIA BOLIVIANA NACIONAL'));
    assert.equal(url.origin + url.pathname, 'https://servicios.seprec.gob.bo/api/empresas/buscarEmpresas');
    assert.equal(url.searchParams.get('filtro'), 'CERVECERIA BOLIVIANA NACIONAL');
    assert.equal(url.searchParams.get('tipoFiltro'), 'nombre');
    assert.equal(
      buildSeprecDetailUrl('12778', '12778'),
      'https://servicios.seprec.gob.bo/api/empresas/informacionBasicaEmpresa/12778/establecimiento/12778',
    );
  });

  it('la búsqueda descarta unipersonales (personas) y matrículas no activas', () => {
    const hits = parseSeprecSearch(
      search([
        hit('12778', 'CERVECERIA BOLIVIANA NACIONAL S.A.'),
        hit('1', 'CERVECERIA ARTESANAL', { codTipoUnidadEconomica: { codigo: '01', nombre: 'EMPRESA UNIPERSONAL' } }),
        hit('2', 'CERVECERIA VIEJA S.R.L.', { estado: 'INACTIVO' }),
      ]),
    );
    assert.deepEqual(hits.map((h) => h.id), ['12778']);
    assert.equal(hits[0].core, 'CERVECERIA BOLIVIANA NACIONAL');
    assert.deepEqual(parseSeprecSearch(null), []);
    assert.deepEqual(parseSeprecSearch({ datos: { filas: 'x' } }), []);
  });

  it('de la ficha sólo se lee el NIT (sólo dígitos, 7-13)', () => {
    assert.equal(parseSeprecDetailNit(detail('1020229024')), '1020229024');
    assert.equal(parseSeprecDetailNit(detail('123')), null);
    assert.equal(parseSeprecDetailNit({}), null);
  });

  it('regla BO: NIT de 7 a 13 dígitos, sólo de forma', () => {
    assert.equal(getTaxIdentifierRule('bo')?.validationLevel, 'format_only');
    assert.equal(validateTaxIdentifier('1020229024', 'BO').valid, true);
    assert.equal(validateTaxIdentifier('12345', 'BO').valid, false);
  });

  it('núcleo boliviano', () => {
    assert.equal(normalizeBoliviaCompanyCore('Cervecería Boliviana Nacional S.A.'), 'CERVECERIA BOLIVIANA NACIONAL');
    assert.equal(normalizeBoliviaCompanyCore('Industrias Sur S.R.L.'), 'INDUSTRIAS SUR');
    assert.equal(normalizeBoliviaCompanyCore('Empresa Minera Sociedad Anónima Mixta'), 'EMPRESA MINERA');
  });
});

describe('consulta en vivo', () => {
  it('sólo pide la ficha de las filas con el MISMO núcleo y nunca guarda contactos', async () => {
    const f = fakeSeprec(
      search([hit('12778', 'CERVECERIA BOLIVIANA NACIONAL S.A.'), hit('99', 'CERVECERIA BOLIVIANA NACIONAL DEL SUR S.A.')]),
      { '12778': detail('1020229024'), '99': detail('9999999') },
    );
    const rows = await buildSeprecNameLiveQuery({ fetchImpl: f.fetchImpl })('CERVECERIA BOLIVIANA NACIONAL');
    assert.deepEqual(rows, [
      { taxId: '1020229024', legalName: 'CERVECERIA BOLIVIANA NACIONAL S.A.', normalizedLegalName: 'CERVECERIA BOLIVIANA NACIONAL' },
    ]);
    assert.equal(f.urls.filter((u) => u.includes('informacionBasicaEmpresa')).length, 1);
    assert.equal(JSON.stringify(rows).includes('persona@'), false);
  });

  it('sin núcleo no consulta; error o excepción → vacío', async () => {
    const f = fakeSeprec(search([]), {});
    assert.deepEqual(await buildSeprecNameLiveQuery({ fetchImpl: f.fetchImpl })('  '), []);
    assert.equal(f.urls.length, 0);
    assert.deepEqual(await buildSeprecNameLiveQuery({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) })('A B'), []);
    assert.deepEqual(
      await buildSeprecNameLiveQuery({
        fetchImpl: async () => {
          throw new Error('caída');
        },
      })('A B'),
      [],
    );
  });

  it(`tras ${BO_SEPREC_MAX_CONSECUTIVE_FAILURES} fallos seguidos se apaga en la corrida`, async () => {
    let calls = 0;
    const query = buildSeprecNameLiveQuery({
      fetchImpl: async () => {
        calls += 1;
        throw new Error('caída');
      },
    });
    for (let i = 0; i < BO_SEPREC_MAX_CONSECUTIVE_FAILURES + 3; i++) await query('A B');
    assert.equal(calls, BO_SEPREC_MAX_CONSECUTIVE_FAILURES);
  });

  it(`como mucho ${BO_SEPREC_MAX_LOOKUPS_PER_RUN} empresas por corrida`, async () => {
    const f = fakeSeprec(search([]), {});
    const query = buildSeprecNameLiveQuery({ fetchImpl: f.fetchImpl });
    for (let i = 0; i < BO_SEPREC_MAX_LOOKUPS_PER_RUN + 5; i++) await query('A B');
    assert.equal(f.urls.length, BO_SEPREC_MAX_LOOKUPS_PER_RUN);
  });

  it(`como mucho ${BO_SEPREC_TOTAL_BUDGET_MS / 1000} s en total por corrida`, async () => {
    let clock = 0;
    const f = fakeSeprec(search([]), {});
    const slow = async (url: string) => {
      clock += 20_000; // cada petición «tarda» 20 s
      return f.fetchImpl(url);
    };
    const query = buildSeprecNameLiveQuery({ fetchImpl: slow, now: () => clock });
    for (let i = 0; i < 10; i++) await query('A B');
    // 20 s + 20 s = 40 s < 45 s ⇒ una tercera; después 60 s ≥ 45 s ⇒ se detiene.
    assert.equal(f.urls.length, 3);
  });

  it('dentro de la corrida: NIT fuerte en las columnas tipadas; una palabra sin forma = sólo señal', async () => {
    const f = fakeSeprec(search([hit('12778', 'CERVECERIA BOLIVIANA NACIONAL S.A.'), hit('5', 'ENTEL S.A.')]), {
      '12778': detail('1020229024'),
      '5': detail('1020703023'),
    });
    const resolver = createSnapshotNameOfficialSourceResolver({
      countryCode: 'BO',
      sourceKey: 'bo_seprec_live',
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{7,13}$/,
      normalizeCore: normalizeBoliviaCompanyCore,
      querySnapshots: buildSeprecNameLiveQuery({ fetchImpl: f.fetchImpl }),
      singleWordIsSignalOnly: true,
    });
    const candidate = (canonicalName: string) =>
      ({
        sourceProvider: 'apollo',
        canonicalName,
        countryCode: 'BO',
        requestedCountryCode: 'BO',
        domain: null,
        websiteUrl: null,
        warnings: [],
        issues: [],
        providerMetadataSafe: {},
        trace: {},
      }) as unknown as NormalizedProspectCandidate;
    const strong = await enrichNormalizedProspectWithOfficialSources(
      candidate('Cervecería Boliviana Nacional'),
      { country: 'Bolivia', countryCode: 'BO' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(strong.strongIdentityAvailable, true);
    assert.equal(strong.taxIdentifier, '1020229024');
    assert.equal(strong.taxIdentifierType, 'NIT');
    const single = await resolver.resolve({
      candidate: candidate('Entel'),
      criteria: { countryCode: 'BO' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(single.status, 'low_confidence_match');
  });
});

describe('cableado', () => {
  it('la fábrica construye Bolivia en vivo con la regla de una palabra', () => {
    const wiring = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    assert.match(
      wiring,
      /countryCode: 'BO',\s*sourceKey: BO_SEPREC_LIVE_SOURCE_KEY,\s*taxIdentifierType: 'NIT',\s*validTaxId: \/\^\\d\{7,13\}\$\/,\s*normalizeCore: normalizeBoliviaCompanyCore,\s*querySnapshots: buildSeprecNameLiveQuery\(\),\s*singleWordIsSignalOnly: true,/,
    );
  });
});
