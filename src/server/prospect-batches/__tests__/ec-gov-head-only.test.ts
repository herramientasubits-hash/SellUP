/**
 * SOURCES-EC-GOV-HEAD-ONLY-1 (dueña 07-10: «adelante la A») — en Ecuador × Gobierno,
 * una fila de Tavily sólo entra si su RUC es de una entidad CABEZA. Prod 07-10
 * (b24a558b, 063ec0b1): con RUC entraron Morona, Loja, Manabí, Azuay y El Oro
 * (cabezas); sin RUC o chicas entraron Quito Informa (agencia de noticias del
 * Municipio), Guayas Estratégica, Acess, Itecsur, Antonio Ante, Pedro Vicente
 * Maldonado. Sin red ni base: fuentes oficiales dobles y el filtro de tamaño real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EC_INSTITUTION_NOT_HEAD_SIZE,
  ecPublicEntityWorkforce,
  isEcTavilyInstitutionNotHead,
  withEcPublicEntitySize,
} from '../ec-public-entity-size';
import { enrichTavilyCandidatesWithOfficialIdentity } from '@/server/agents/prospecting-toolkit/tavily-official-identity';
import {
  extractCandidateCompanySize,
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';
import { evaluateIcpSizeGate, resolveIcpSizeGateWriterAction } from '@/server/agents/prospecting-toolkit/icp-size-gate';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake/source-enrichment';
import type { DuplicateCheckResult, ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';

const YEAR = 2026;
const CRITERIA = { country: 'Ecuador', countryCode: 'EC', sector: 'Gobierno' };

describe('A. reglas', () => {
  it('cabeza con RUC público ⇒ «200+»; no cabeza, privada o sin RUC ⇒ nada', () => {
    assert.deepEqual(ecPublicEntityWorkforce('1460000290001', 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON MORONA', YEAR), {
      workers: 200,
      year: YEAR,
      source: 'SRI · regla por tipo de entidad pública',
      maxWorkers: null,
      sizeBand: 'entidad cabeza',
    });
    assert.equal(ecPublicEntityWorkforce('1760000660001', 'MINISTERIO DE GOBIERNO', YEAR)?.workers, 200);
    assert.equal(ecPublicEntityWorkforce('1060000340001', 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DE ANTONIO ANTE', YEAR), null);
    assert.equal(ecPublicEntityWorkforce('1790016919001', 'CORPORACION FAVORITA C.A.', YEAR), null);
    assert.equal(ecPublicEntityWorkforce(null, 'MINISTERIO DE GOBIERNO', YEAR), null);
  });

  it('Tavily: web institucional de Ecuador que no es cabeza', () => {
    const base = { countryCode: 'EC', domain: 'antonioante.gob.ec' };
    assert.equal(isEcTavilyInstitutionNotHead({ ...base, taxId: '1060000340001', legalName: 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DE ANTONIO ANTE' }), true);
    assert.equal(isEcTavilyInstitutionNotHead({ countryCode: 'EC', domain: 'quitoinforma.gob.ec', taxId: null, legalName: null }), true);
    assert.equal(isEcTavilyInstitutionNotHead({ countryCode: 'EC', domain: 'www.morona.gob.ec', taxId: '1460000290001', legalName: 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON MORONA' }), false);
    // Universidad privada con .edu.ec y RUC privado: la decide la Superintendencia, no esta regla.
    assert.equal(isEcTavilyInstitutionNotHead({ countryCode: 'EC', domain: 'uees.edu.ec', taxId: '0991311269001', legalName: 'UNIVERSIDAD DE ESPECIALIDADES ESPIRITU SANTO' }), false);
    // Fuera de Ecuador o fuera de .gob/.edu/.mil: nada.
    assert.equal(isEcTavilyInstitutionNotHead({ countryCode: 'PE', domain: 'muniate.gob.pe', taxId: null, legalName: null }), false);
    assert.equal(isEcTavilyInstitutionNotHead({ countryCode: 'EC', domain: 'kruger.com.ec', taxId: null, legalName: null }), false);
  });

  it('la envoltura del resolvedor sólo completa un RUC cabeza sin tamaño', async () => {
    const answer = (taxIdentifier: string, legalName: string, workforce: unknown = undefined): OfficialSourceResolver => ({
      countryCode: 'EC',
      sourceKey: 'ec_sri_registry',
      canResolve: () => true,
      resolve: async () => ({
        status: 'matched', countryCode: 'EC', sourceKey: 'ec_sri_registry', confidence: 0.95, matchMethod: 'normalized_name',
        taxIdentifier, taxIdentifierType: 'RUC', legalName, warnings: [], issues: [],
        ...(workforce ? { workforce: workforce as never } : {}),
      }),
    });
    const input = {} as never;
    const head = await withEcPublicEntitySize(answer('1760000660001', 'MINISTERIO DE GOBIERNO'), () => YEAR).resolve(input);
    assert.equal(head.workforce?.workers, 200);
    const small = await withEcPublicEntitySize(answer('1060000340001', 'GAD MUNICIPAL DE ANTONIO ANTE'), () => YEAR).resolve(input);
    assert.equal(small.workforce, undefined);
    const own = { workers: 900, year: 2024, source: 'SCVS' };
    const kept = await withEcPublicEntitySize(answer('1790016919001', 'CORPORACION FAVORITA C.A.', own), () => YEAR).resolve(input);
    assert.deepEqual(kept.workforce, own);
  });
});

function tavily(name: string, domain: string): ProspectingPipelineCandidate {
  return {
    name,
    website: `https://${domain}/`,
    domain,
    country: 'Ecuador',
    countryCode: 'EC',
    industry: 'Gobierno',
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: { status: 'new_candidate', confidence: 1, input: { name }, checkedSources: ['sellup'], summary: 'ok', matches: [] },
    scoring: {
      qualityLabel: 'high_quality_new', confidenceScore: 0.9, fitScore: 0.8, dataCompletenessScore: 0.8,
      recommendedAction: 'approve_for_review',
      breakdown: { existenceSignals: 1, websiteSignals: 1, duplicateSignals: 1, sourceSignals: 1, fitSignals: 1, completenessSignals: 1, penalties: 0 },
      reasons: [], warnings: [], blockers: [],
    },
  } as ProspectingPipelineCandidate;
}

/** El SRI doble: RUC y razón social para los nombres conocidos, con la envoltura real. */
function sri(known: Record<string, [string, string]>): OfficialSourceResolver {
  return withEcPublicEntitySize(
    {
      countryCode: 'EC',
      sourceKey: 'ec_sri_registry',
      canResolve: () => true,
      resolve: async ({ candidate: c }) => {
        const hit = known[c.canonicalName ?? ''];
        return hit
          ? {
              status: 'matched', countryCode: 'EC', sourceKey: 'ec_sri_registry', confidence: 0.95, matchMethod: 'normalized_name',
              taxIdentifier: hit[0], taxIdentifierType: 'RUC', legalName: hit[1], warnings: [], issues: [],
            }
          : { status: 'not_found', countryCode: 'EC', sourceKey: 'ec_sri_registry', warnings: [], issues: [] };
      },
    },
    () => YEAR,
  );
}

const newCandidate = async (): Promise<DuplicateCheckResult> => ({
  status: 'new_candidate', confidence: 1, input: { name: 'x' }, checkedSources: ['sellup'], summary: 'ok', matches: [],
});

function gateAction(candidate: ProspectingPipelineCandidate): 'skip' | 'write' {
  const resolved = resolveEmployeeSizeForIcpGate({
    candidateCompanySize: extractCandidateCompanySize(candidate),
    officialRegistryWorkforce: extractOfficialRegistryWorkforce(candidate),
    referenceYear: YEAR,
    threshold: 200,
  });
  return resolveIcpSizeGateWriterAction(evaluateIcpSizeGate(resolved.icpInput)).action === 'skip' ? 'skip' : 'write';
}

describe('B. Tavily en Ecuador × Gobierno + el filtro de tamaño real', () => {
  it('cabezas entran; portal sin RUC y municipio chico salen por tamaño', async () => {
    const out = await enrichTavilyCandidatesWithOfficialIdentity(
      [
        tavily('Gobierno Municipal del Cantón Morona', 'morona.gob.ec'),
        tavily('Quito Informa', 'quitoinforma.gob.ec'),
        tavily('Antonio Ante', 'antonioante.gob.ec'),
      ],
      CRITERIA,
      {
        resolvers: [
          sri({
            'Gobierno Municipal del Cantón Morona': ['1460000290001', 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON MORONA'],
            'Antonio Ante': ['1060000340001', 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DE ANTONIO ANTE'],
          }),
        ],
        checkDuplicate: newCandidate,
      },
    );
    const [morona, quitoInforma, antonioAnte] = out;
    assert.equal(morona.companySize, undefined);
    assert.equal(extractOfficialRegistryWorkforce(morona)?.workers, 200, 'Morona lleva el tramo de cabeza');
    assert.equal(
      resolveEmployeeSizeForIcpGate({ officialRegistryWorkforce: extractOfficialRegistryWorkforce(morona), referenceYear: YEAR, threshold: 200 }).selectedValue,
      '200+',
    );
    assert.equal(gateAction(morona), 'write', 'Morona: cabeza ⇒ «200+»');
    assert.equal(quitoInforma.companySize, EC_INSTITUTION_NOT_HEAD_SIZE);
    assert.equal(gateAction(quitoInforma), 'skip');
    assert.equal(antonioAnte.companySize, EC_INSTITUTION_NOT_HEAD_SIZE);
    assert.equal(gateAction(antonioAnte), 'skip');
  });

  it('una web privada (.com.ec) no se toca aunque no tenga RUC', async () => {
    const [kruger] = await enrichTavilyCandidatesWithOfficialIdentity([tavily('Kruger', 'kruger.com.ec')], CRITERIA, {
      resolvers: [sri({})],
      checkDuplicate: newCandidate,
    });
    assert.equal(kruger.companySize, undefined);
  });
});
