/**
 * AGENT1-TAVILY-OFFICIAL-IDENTITY-1 + AGENT1-TAVILY-FIRST-5 — identificador
 * fiscal oficial para las empresas de Tavily y su sitio como portada.
 *
 * Prod 02-10 (Bolivia 26c12524): 9 empresas de Tavily, 0 con NIT, mientras el
 * SEPREC en vivo sí lo devolvía. Prod 02-10 (PE×Energía 2fc07f4a): Engie guardó
 * una nota de prensa como sitio web.
 * Sin Supabase, sin proveedores, sin red: fuentes oficiales y duplicados dobles.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  enrichTavilyCandidatesWithOfficialIdentity,
  shouldLookUpOfficialIdentity,
} from '../tavily-official-identity';
import { runIncrementalProspectingSearch } from '../incremental-search';
import { toHomepageUrl } from '../prospecting-pipeline';
import { normalizeProspectCompanyName, stripDomainSuffix } from '../company-name-normalizer';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake/source-enrichment';
import type { DuplicateCheckResult, ProspectingPipelineCandidate } from '../types';

const CRITERIA = { country: 'Bolivia', countryCode: 'BO', sector: 'Logística' };

function candidate(name: string, overrides: Partial<ProspectingPipelineCandidate> = {}): ProspectingPipelineCandidate {
  return {
    name,
    website: `https://${name.toLowerCase().replace(/\s+/g, '')}.com.bo/`,
    domain: `${name.toLowerCase().replace(/\s+/g, '')}.com.bo`,
    country: 'Bolivia',
    countryCode: 'BO',
    industry: 'Logística',
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate', confidence: 1, input: { name }, checkedSources: ['sellup'], summary: 'ok', matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new', confidenceScore: 0.9, fitScore: 0.8, dataCompletenessScore: 0.8,
      recommendedAction: 'approve_for_review',
      breakdown: { existenceSignals: 1, websiteSignals: 1, duplicateSignals: 1, sourceSignals: 1, fitSignals: 1, completenessSignals: 1, penalties: 0 },
      reasons: [], warnings: [], blockers: [],
    },
    ...overrides,
  } as ProspectingPipelineCandidate;
}

/** Fuente oficial doble (forma real de `OfficialSourceResolver`): NIT para los nombres conocidos. */
function seprecDouble(nits: Record<string, string>, calls: string[] = []): OfficialSourceResolver {
  return {
    countryCode: 'BO',
    sourceKey: 'bo_seprec_test',
    canResolve: () => true,
    resolve: async ({ candidate: c }) => {
      const name = c.canonicalName ?? c.commercialName ?? '';
      calls.push(name);
      const nit = nits[name];
      return nit
        ? {
            status: 'matched', countryCode: 'BO', sourceKey: 'bo_seprec_test', confidence: 0.95,
            matchMethod: 'normalized_name', taxIdentifier: nit, taxIdentifierType: 'NIT',
            legalName: `${name} S.R.L.`, warnings: [], issues: [],
          }
        : { status: 'not_found', countryCode: 'BO', sourceKey: 'bo_seprec_test', warnings: [], issues: [] };
    },
  };
}

const newCandidateDup = async (): Promise<DuplicateCheckResult> => ({
  status: 'new_candidate', confidence: 1, input: { name: 'x' }, checkedSources: ['sellup'], summary: 'ok', matches: [],
});

describe('identificador oficial para Tavily (AGENT1-TAVILY-OFFICIAL-IDENTITY-1)', () => {
  it('sin fuentes oficiales para el país: las candidatas quedan iguales', async () => {
    const input = [candidate('Opecebol')];
    const out = await enrichTavilyCandidatesWithOfficialIdentity(input, CRITERIA, { resolvers: [], checkDuplicate: newCandidateDup });
    assert.deepEqual(out, input);
  });

  it('no busca lo que el vendedor no va a ver: duplicadas y descartadas', () => {
    assert.equal(shouldLookUpOfficialIdentity(candidate('A')), true);
    assert.equal(shouldLookUpOfficialIdentity(candidate('B', {
      duplicateCheck: { status: 'existing_in_hubspot', confidence: 1, input: { name: 'B' }, checkedSources: ['hubspot'], summary: '', matches: [] },
    })), false);
    assert.equal(shouldLookUpOfficialIdentity(candidate('C', {
      scoring: { ...candidate('C').scoring, recommendedAction: 'discard' },
    })), false);
  });

  it('Bolivia: el NIT del registro oficial llega a las columnas y se re-chequea el duplicado por NIT', async () => {
    const calls: string[] = [];
    const dupInputs: Array<{ taxIdentifier?: string | null }> = [];
    const out = await enrichTavilyCandidatesWithOfficialIdentity(
      [candidate('Opecebol'), candidate('Sin Registro')],
      CRITERIA,
      {
        resolvers: [seprecDouble({ Opecebol: '138215023' }, calls)],
        checkDuplicate: async (input) => {
          dupInputs.push(input);
          return { status: 'existing_in_hubspot', confidence: 1, input, checkedSources: ['hubspot'], summary: 'NIT ya en HubSpot', matches: [] };
        },
      },
    );
    assert.deepEqual(calls.sort(), ['Opecebol', 'Sin Registro']);
    const opecebol = out[0];
    assert.equal(opecebol.officialSourceIdentity?.strongIdentityAvailable, true);
    assert.equal(JSON.stringify(opecebol.officialSourceIdentity?.typedColumns).includes('138215023'), true);
    assert.equal(dupInputs[0]?.taxIdentifier, '138215023');
    assert.equal(opecebol.duplicateCheck?.status, 'existing_in_hubspot', 'con NIT ya en HubSpot deja de verse nueva');
    const other = out[1];
    assert.equal(other.officialSourceIdentity?.strongIdentityAvailable, false);
    assert.equal(other.duplicateCheck?.status, 'new_candidate', 'sin identidad fuerte el duplicado no cambia');
  });

  it('el plazo corta las búsquedas NUEVAS; lo que no alcanzó queda como estaba', async () => {
    let t = 0;
    const calls: string[] = [];
    const resolver = seprecDouble({}, calls);
    const out = await enrichTavilyCandidatesWithOfficialIdentity(
      [candidate('A'), candidate('B'), candidate('C')],
      CRITERIA,
      { resolvers: [resolver], checkDuplicate: newCandidateDup, nowMs: () => (t += 10_000), deadlineMs: 15_000, concurrency: 1 },
    );
    assert.ok(calls.length < 3, `se cortó por plazo (${calls.length} búsquedas)`);
    assert.equal(out.length, 3);
    assert.equal(out[2].officialSourceIdentity, undefined);
  });

  it('una fuente que lanza no rompe la corrida', async () => {
    const broken = {
      key: 'broken', canResolve: () => true, resolve: async () => { throw new Error('seprec caído'); },
    } as unknown as OfficialSourceResolver;
    const input = [candidate('Opecebol')];
    const out = await enrichTavilyCandidatesWithOfficialIdentity(input, CRITERIA, { resolvers: [broken], checkDuplicate: newCandidateDup });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Opecebol');
  });

  it('el writer recibe las candidatas enriquecidas (costura de la búsqueda incremental)', async () => {
    let received: ProspectingPipelineCandidate[] | null = null;
    const enriched = { officialSourceMetadata: { marker: 'ok' }, typedColumns: {}, strongIdentityAvailable: true };
    await runIncrementalProspectingSearch(
      {
        country: 'Bolivia', countryCode: 'BO', industry: 'Logística', webSearchProvider: 'mock',
        targetInternal: 5, maxRounds: 1, targetPersistibleCandidates: 1, dryRun: false,
        enrichCandidatesBeforeWrite: async (cands: readonly ProspectingPipelineCandidate[]) => cands.map((c) => ({ ...c, officialSourceIdentity: enriched as never })),
      } as never,
      (async (writerInput: { pipelineOutput: { candidates: ProspectingPipelineCandidate[] } }) => {
        received = writerInput.pipelineOutput.candidates;
        return { dryRun: false, batchId: 'b1', candidatesCreated: 0, candidatesSkipped: 0, createdCandidateIds: [], skipped: [], status: 'ready_for_review', errors: [] };
      }) as never,
      (async () => ({
        input: {}, catalogContext: { country: 'Bolivia', countryCode: 'BO', industry: 'Logística', searchDepth: 'standard', fiscalIdentifierLabel: null, recommendedSources: [], sectorSources: [], risks: [], operatingRules: [], coverageNotes: [], promptContext: '' },
        searchQuery: 'q', webSearch: { provider: 'mock', query: 'q', results: [], resultsCount: 1, skipped: false, estimatedCostUsd: null, metadata: {} },
        candidates: [candidate('Opecebol')],
        summary: { requested: 1, searched: 1, returned: 1, highQualityNew: 1, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
        warnings: [], metadata: {},
      })) as never,
    ).catch(() => undefined);
    assert.ok(received, 'el writer se llamó');
    const first = (received as unknown as ProspectingPipelineCandidate[])[0];
    assert.deepEqual(first.officialSourceIdentity, enriched);
  });
});

describe('el sitio de una empresa de Tavily es su portada (AGENT1-TAVILY-FIRST-5)', () => {
  it('una nota de prensa se guarda como la portada del mismo sitio', () => {
    assert.equal(
      toHomepageUrl('https://engie-energia.pe/notas-de-prensa/central-eolica-punta-lomitas'),
      'https://engie-energia.pe/',
    );
  });
  it('conserva subdominio y protocolo; sin protocolo asume https', () => {
    assert.equal(toHomepageUrl('http://peru.isaenergia.com/es/nosotros'), 'http://peru.isaenergia.com/');
    assert.equal(toHomepageUrl('cmh.com.pe/nosotros'), 'https://cmh.com.pe/');
  });
  it('null y lo que no es URL quedan iguales', () => {
    assert.equal(toHomepageUrl(null), null);
    assert.equal(toHomepageUrl('no es una url'), 'no es una url');
  });
});

describe('el segundo constructor de candidatas también guarda la portada (AGENT1-TAVILY-HOMEPAGE-2)', () => {
  // Prod 02-10 (BO 8c3b2db5): `buildProspectingPipelineCandidate` —que Tavily
  // también usa— seguía guardando la página interior. Hace I/O real y no se
  // puede ejecutar offline: se ancla sobre el fuente, sin comentarios.
  const src = fs
    .readFileSync(path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/prospecting-pipeline.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const body = src.slice(src.indexOf('export async function buildProspectingPipelineCandidate'));

  it('fuera de Apollo el sitio es la portada; Apollo conserva lo declarado', () => {
    assert.match(body, /const website = isApolloResult \? declaredWebsite : toHomepageUrl\(declaredWebsite\);/);
  });
  it('la página encontrada sigue como fuente', () => {
    assert.match(body, /sourceUrl: result\.url,/);
  });
});

// ── AGENT1-TAVILY-DOMAIN-NAME-1 — el nombre inferido del dominio, sin terminación ──
//
// Prod 02-10: 26/190 nombres de Tavily eran el dominio entero («Cognos.com.bo»,
// «Volcan.com.pe», «Minsal.cl») porque sólo se quitaban terminaciones de Colombia
// y genéricas; los registros oficiales no los encontraban (SEPREC Bolivia).

describe('nombre desde el dominio en cualquier país (AGENT1-TAVILY-DOMAIN-NAME-1)', () => {
  it('stripDomainSuffix quita segundo nivel + ccTLD de cualquier país', () => {
    assert.equal(stripDomainSuffix('cognos.com.bo'), 'cognos');
    assert.equal(stripDomainSuffix('www.volcan.com.pe'), 'volcan');
    assert.equal(stripDomainSuffix('esan.edu.pe'), 'esan');
    assert.equal(stripDomainSuffix('transparencia.gob.pe'), 'transparencia');
    assert.equal(stripDomainSuffix('minsal.cl'), 'minsal');
    assert.equal(stripDomainSuffix('kio.tech'), 'kio');
    assert.equal(stripDomainSuffix('empresa.com.co'), 'empresa');
    assert.equal(stripDomainSuffix('peru.isaenergia.com'), 'peru.isaenergia', 'un subdominio no se toca');
  });
  it('el nombre de respaldo desde el dominio ya no lleva la terminación', () => {
    const r = normalizeProspectCompanyName('Empresas de software en Bolivia', 'cognos.com.bo');
    assert.equal(r.name, 'Cognos');
  });
});
