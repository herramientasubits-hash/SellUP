/**
 * SOURCES-CO-RUES-LIVE-NIT-1 — Colombia con dos fuentes: Supersociedades primero y,
 * si no da NIT fuerte, el registro de las cámaras de comercio en vivo.
 *
 * Todo con dobles inyectados: sin red, sin DB, sin proveedores. Razones sociales
 * con la forma real del registro (c82u-588k); NIT reales de sociedades públicas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '../source-enrichment';
import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
} from '../source-enrichment';
import type { NormalizedProspectCandidate, ProspectSearchCriteria } from '../types';
import { createFallbackOfficialSourceResolver } from '../resolvers/fallback-official-source-resolver';
import {
  createSnapshotNameOfficialSourceResolver,
  type SnapshotNameRow,
} from '../resolvers/snapshot-name-official-source-resolver';
import {
  buildRuesNameLiveQuery,
  CO_RUES_LIVE_SOURCE_KEY,
  normalizeColombiaCompanyCore,
} from '@/server/source-catalog/connectors/personas-juridicas-cc-colombia/rues-name-live-query';

const criteria: ProspectSearchCriteria = { country: 'Colombia', countryCode: 'CO', sector: 'Salud' };

function makeCandidate(canonicalName: string): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-co-1',
    providerRequestId: 'req-co-1',
    canonicalName,
    normalizedName: canonicalName.toLowerCase(),
    commercialName: canonicalName,
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'Colombia',
    countryCode: 'CO',
    requestedCountryCode: 'CO',
    region: null,
    city: 'Bogotá',
    industry: 'Health',
    subindustry: null,
    industryCodes: {},
    employeeCount: 300,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-co-1', providerRequestId: 'req-co-1', sourceUrl: null },
  };
}

const input = (name: string) => ({
  candidate: makeCandidate(name),
  criteria,
  policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
});

function result(
  status: OfficialSourceEnrichmentResult['status'],
  sourceKey: string,
  confidence: number,
  taxIdentifier: string | null = null,
): OfficialSourceEnrichmentResult {
  return {
    status,
    countryCode: 'CO',
    sourceKey,
    confidence,
    matchMethod: taxIdentifier ? 'normalized_name' : null,
    taxIdentifier,
    taxIdentifierType: taxIdentifier ? 'NIT' : null,
    warnings: [],
    issues: [],
  };
}

function stub(
  sourceKey: string,
  outcome: OfficialSourceEnrichmentResult | Error,
  accepts = true,
): OfficialSourceResolver & { calls: number } {
  const resolver = {
    countryCode: 'CO',
    sourceKey,
    calls: 0,
    canResolve: () => accepts,
    async resolve() {
      resolver.calls += 1;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return resolver;
}

describe('createFallbackOfficialSourceResolver', () => {
  it('Supersociedades fuerte → nunca pregunta a la segunda fuente', async () => {
    const primary = stub('co_siis', result('matched', 'co_siis', 0.85, '860025900'));
    const secondary = stub('rues', result('matched', 'rues', 0.85, '999999999'));
    const out = await createFallbackOfficialSourceResolver(primary, secondary).resolve(input('Alpina'));
    assert.equal(out.taxIdentifier, '860025900');
    assert.equal(secondary.calls, 0);
  });

  it('Supersociedades sin nada + cámaras fuerte → gana la segunda', async () => {
    const primary = stub('co_siis', result('not_found', 'co_siis', 0));
    const secondary = stub('rues', result('matched', 'rues', 0.85, '800149384'));
    const out = await createFallbackOfficialSourceResolver(primary, secondary).resolve(input('Clínica Colsanitas'));
    assert.equal(out.sourceKey, 'rues');
    assert.equal(out.taxIdentifier, '800149384');
  });

  it('una pista de Supersociedades cede ante un NIT fuerte de las cámaras', async () => {
    const primary = stub('co_siis', result('low_confidence_match', 'co_siis', 0.6, '111111111'));
    const secondary = stub('rues', result('matched', 'rues', 0.85, '800149384'));
    const out = await createFallbackOfficialSourceResolver(primary, secondary).resolve(input('Clínica Colsanitas'));
    assert.equal(out.taxIdentifier, '800149384');
  });

  it('un «matched» por debajo de 0,85 no cuenta como fuerte: se pregunta a la segunda', async () => {
    const primary = stub('co_siis', result('matched', 'co_siis', 0.7, '111111111'));
    const secondary = stub('rues', result('matched', 'rues', 0.85, '800149384'));
    const out = await createFallbackOfficialSourceResolver(primary, secondary).resolve(input('X Y'));
    assert.equal(secondary.calls, 1);
    assert.equal(out.taxIdentifier, '800149384');
  });

  it('entre pistas, manda la de Supersociedades; si sólo hay pista de las cámaras, esa', async () => {
    const both = await createFallbackOfficialSourceResolver(
      stub('co_siis', result('low_confidence_match', 'co_siis', 0.6, '111111111')),
      stub('rues', result('low_confidence_match', 'rues', 0.6, '222222222')),
    ).resolve(input('A B'));
    assert.equal(both.taxIdentifier, '111111111');

    const keepPrimary = await createFallbackOfficialSourceResolver(
      stub('co_siis', result('low_confidence_match', 'co_siis', 0.6, '111111111')),
      stub('rues', result('not_found', 'rues', 0)),
    ).resolve(input('A B'));
    assert.equal(keepPrimary.taxIdentifier, '111111111');

    const onlySecondary = await createFallbackOfficialSourceResolver(
      stub('co_siis', result('not_found', 'co_siis', 0)),
      stub('rues', result('low_confidence_match', 'rues', 0.6, '222222222')),
    ).resolve(input('A B'));
    assert.equal(onlySecondary.taxIdentifier, '222222222');
  });

  it('nada en ninguna → el resultado de Supersociedades', async () => {
    const out = await createFallbackOfficialSourceResolver(
      stub('co_siis', result('not_found', 'co_siis', 0)),
      stub('rues', result('not_found', 'rues', 0)),
    ).resolve(input('A B'));
    assert.equal(out.sourceKey, 'co_siis');
  });

  it('si la segunda falla o no acepta el candidato, queda el de Supersociedades', async () => {
    const primaryResult = result('low_confidence_match', 'co_siis', 0.6, '111111111');
    const thrown = await createFallbackOfficialSourceResolver(
      stub('co_siis', primaryResult),
      stub('rues', new Error('caída')),
    ).resolve(input('A B'));
    assert.equal(thrown.taxIdentifier, '111111111');

    const declined = stub('rues', result('matched', 'rues', 0.85, '222222222'), false);
    const out = await createFallbackOfficialSourceResolver(stub('co_siis', primaryResult), declined).resolve(input('A B'));
    assert.equal(out.taxIdentifier, '111111111');
    assert.equal(declined.calls, 0);
  });

  it('se presenta como Supersociedades: país, fuente y aceptación son los de la primera', () => {
    const combined = createFallbackOfficialSourceResolver(
      stub('co_siis', result('not_found', 'co_siis', 0), false),
      stub('rues', result('not_found', 'rues', 0), true),
    );
    assert.equal(combined.countryCode, 'CO');
    assert.equal(combined.sourceKey, 'co_siis');
    assert.equal(combined.canResolve(input('A B')), false);
  });
});

describe('núcleo colombiano', () => {
  it('quita la forma societaria y los añadidos apilados (BIC, E.S.P.)', () => {
    assert.equal(normalizeColombiaCompanyCore('ALPINA PRODUCTOS ALIMENTICIOS S.A.S. - BIC.'), 'ALPINA PRODUCTOS ALIMENTICIOS');
    assert.equal(normalizeColombiaCompanyCore('TRANSPORTES VIGIA S.A.S E.S.P.'), 'TRANSPORTES VIGIA');
    assert.equal(normalizeColombiaCompanyCore('Transportes Vigía'), 'TRANSPORTES VIGIA');
    assert.equal(normalizeColombiaCompanyCore('CLINICA COLSANITAS S A'), 'CLINICA COLSANITAS');
    assert.equal(normalizeColombiaCompanyCore('Konecta Group S.A.S'), 'KONECTA GROUP');
    assert.equal(normalizeColombiaCompanyCore('INVERSIONES LOPEZ Y CIA LTDA'), 'INVERSIONES LOPEZ Y CIA');
  });

  it('una sociedad «en liquidación» conserva la marca: nunca se confunde con la activa', () => {
    assert.equal(normalizeColombiaCompanyCore('PSL INGENIERIA S.A.S EN LIQUIDACION'), 'PSL INGENIERIA S A S EN LIQUIDACION');
    assert.notEqual(normalizeColombiaCompanyCore('PSL INGENIERIA S.A.S EN LIQUIDACION'), normalizeColombiaCompanyCore('PSL Ingeniería'));
  });
});

/** Cámaras de comercio EN VIVO, con un fetch doble que responde por prefijo. */
function ruesResolver(registry: Array<{ razon_social: string; numero_identificacion: string }>) {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    const where = new URL(url).searchParams.get('$where') ?? '';
    const prefix = /starts_with\(razon_social,'([^']*)'\)/.exec(where)?.[1] ?? '';
    return { ok: true, json: async () => registry.filter((r) => r.razon_social.startsWith(prefix)) };
  };
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'CO',
    sourceKey: CO_RUES_LIVE_SOURCE_KEY,
    taxIdentifierType: 'NIT',
    validTaxId: /^[89]\d{8}$/,
    normalizeCore: normalizeColombiaCompanyCore,
    querySnapshots: buildRuesNameLiveQuery({ fetchImpl }),
    singleWordIsSignalOnly: true,
  });
  return { resolver, urls };
}

const REGISTRY = [
  // La misma sociedad matriculada en dos cámaras: un único NIT.
  { razon_social: 'ALPINA PRODUCTOS ALIMENTICIOS S.A.', numero_identificacion: '860025900' },
  { razon_social: 'ALPINA PRODUCTOS ALIMENTICIOS S.A.S. - BIC.', numero_identificacion: '860025900' },
  // Empieza igual pero su núcleo es otro: nunca se toma.
  { razon_social: 'CLINICA COLSANITAS S A', numero_identificacion: '800149384' },
  { razon_social: 'CLINICA COLSANITAS SEDE NORTE S.A.S.', numero_identificacion: '901000001' },
  // Una marca de una palabra que coincide con otra sociedad registrada.
  { razon_social: 'ALMAVIVA S.A.S', numero_identificacion: '901696006' },
  // Homónimos: dos NIT con el mismo núcleo.
  { razon_social: 'SOLUCIONES INTEGRALES S.A.S.', numero_identificacion: '900111111' },
  { razon_social: 'SOLUCIONES INTEGRALES LTDA', numero_identificacion: '800222222' },
  // NIT con dígito de verificación y puntos → sólo dígitos.
  { razon_social: 'KONECTA GROUP S.A.S', numero_identificacion: '901.415.070' },
];

describe('cámaras de comercio: nombre → NIT', () => {
  it('una sociedad en dos cámaras con el mismo NIT → NIT fuerte', async () => {
    const { resolver } = ruesResolver(REGISTRY);
    const out = await resolver.resolve(input('Alpina Productos Alimenticios'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '860025900');
    assert.equal(out.sourceKey, 'co_personas_juridicas_cc');
  });

  it('sólo cuenta la fila cuyo núcleo es IGUAL: el prefijo no hace coincidencias parciales', async () => {
    const { resolver } = ruesResolver(REGISTRY);
    const out = await resolver.resolve(input('Clínica Colsanitas'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '800149384');
  });

  it('un nombre de UNA palabra queda como pista, nunca como NIT fuerte', async () => {
    const { resolver } = ruesResolver(REGISTRY);
    const out = await resolver.resolve(input('Almaviva'));
    assert.equal(out.status, 'low_confidence_match');
    assert.deepEqual(out.safeMetadata, { normalizedSearchName: 'ALMAVIVA', singleWordName: true });
  });

  it('una palabra que YA trae su forma societaria es un nombre legal → NIT fuerte', async () => {
    const { resolver } = ruesResolver(REGISTRY);
    const out = await resolver.resolve(input('Almaviva S.A.S'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '901696006');
  });

  it('homónimos → pista, con el número de candidatos', async () => {
    const { resolver } = ruesResolver(REGISTRY);
    const out = await resolver.resolve(input('Soluciones Integrales Ltda'));
    assert.equal(out.status, 'low_confidence_match');
    assert.equal(out.safeMetadata?.candidateCount, 2);
  });

  it('el NIT llega limpio (sólo dígitos)', async () => {
    const { resolver } = ruesResolver(REGISTRY);
    const out = await resolver.resolve(input('Konecta Group'));
    assert.equal(out.taxIdentifier, '901415070');
  });

  it('dentro de la corrida: Supersociedades vacío → las cámaras llenan las columnas tipadas', async () => {
    const siis = stub('co_siis', result('not_found', 'co_siis', 0));
    const { resolver: rues } = ruesResolver(REGISTRY);
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate('Alpina Productos Alimenticios S.A.S.'),
      criteria,
      [createFallbackOfficialSourceResolver(siis, rues)],
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '860025900');
    assert.equal(enriched.taxIdentifierType, 'NIT');
  });

  it('una pista de una palabra NO llena las columnas tipadas', async () => {
    const siis = stub('co_siis', result('not_found', 'co_siis', 0));
    const { resolver: rues } = ruesResolver(REGISTRY);
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate('Almaviva'),
      criteria,
      [createFallbackOfficialSourceResolver(siis, rues)],
    );
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.equal(enriched.taxIdentifier, null);
  });
});

describe('resolvedor genérico: la regla de una palabra es opcional', () => {
  const rows: SnapshotNameRow[] = [{ taxId: '901696006', legalName: 'ALMAVIVA S.A.S', normalizedLegalName: 'ALMAVIVA' }];
  const build = (singleWordIsSignalOnly?: boolean) =>
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'CO',
      sourceKey: 'x',
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{9}$/,
      normalizeCore: normalizeColombiaCompanyCore,
      querySnapshots: async () => rows,
      ...(singleWordIsSignalOnly === undefined ? {} : { singleWordIsSignalOnly }),
    });

  it('sin la opción (Guatemala, Honduras, Perú) una palabra única sigue siendo fuerte', async () => {
    assert.equal((await build().resolve(input('Almaviva'))).status, 'matched');
    assert.equal((await build(false).resolve(input('Almaviva'))).status, 'matched');
  });

  it('con la opción, sólo baja a pista la de UNA palabra', async () => {
    assert.equal((await build(true).resolve(input('Almaviva'))).status, 'low_confidence_match');
  });
});

describe('cableado de Colombia', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('Supersociedades primero; detrás la web (SOURCES-CO-CLOSE-1) y por último las cámaras en vivo', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(
      wiring,
      /createFallbackOfficialSourceResolver\(\s*createColombiaOfficialSourceResolver\(\{\s*querySnapshots: buildColombiaSnapshotQuery\(snapshotClient\),\s*\}\),\s*createFallbackOfficialSourceResolver\(\s*createColombiaDomainOfficialSourceResolver\(\{\s*queryByDomain: buildColombiaDomainSnapshotQuery\(snapshotClient\),\s*\}\),\s*createSnapshotNameOfficialSourceResolver\(\{\s*countryCode: 'CO',\s*sourceKey: CO_RUES_LIVE_SOURCE_KEY,\s*taxIdentifierType: 'NIT',\s*validTaxId: \/\^\[89\]\\d\{8\}\$\/,\s*normalizeCore: normalizeColombiaCompanyCore,\s*querySnapshots: buildRuesNameLiveQuery\(\),\s*singleWordIsSignalOnly: true,\s*singleWordConfirmedByDomain: coSingleWordConfirmedByDomain,/,
    );
  });

  it('el combinador es puro', () => {
    const combinator = read('src/server/agents/prospect-intake/resolvers/fallback-official-source-resolver.ts');
    assert.doesNotMatch(combinator, /createClient|createSupabaseAdminClient|@supabase\/supabase-js|process\.env|\bfetch\s*\(/);
  });
});
