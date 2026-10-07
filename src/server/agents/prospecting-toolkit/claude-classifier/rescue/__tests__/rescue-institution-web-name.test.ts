/**
 * AGENT1-RESCUE-INSTITUTION-WEB-NAME-1 — Prod 07-10, Ecuador × Gobierno (9aa89dc3):
 * «MINISTERIO DE GOBIERNO» entró a revisión con registrocivil.gob.ec (otra entidad,
 * otro RUC) y quedó duplicado del Ministerio que ya estaba con ministeriodegobierno.gob.ec.
 * Sin red ni base: todo es un doble.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { INSTITUTION_WEB_RULE_VERSION, institutionHostLabel, institutionWebMatchesName } from '../institution-web-name-match';
import { websiteRejectedByOlderInstitutionRule } from '../domain-search';
import { rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import { needsDispositionRescue, type RescuableDispositionRow } from '../rescue-dispositions';
import type { DomainFinderOutcome } from '../../domain-finder';
import type { CompanyClassificationResult } from '../../types';

describe('A. la dirección de una web institucional lleva el nombre o la sigla', () => {
  it('casos reales de Ecuador que sí corresponden', () => {
    const ok: Array<[string, string]> = [
      ['ministeriodegobierno.gob.ec', 'MINISTERIO DE GOBIERNO'],
      ['produccion.gob.ec', 'MINISTERIO DE PRODUCCION COMERCIO EXTERIOR INVERSIONES Y PESCA'],
      ['secretariadelamazonia.gob.ec', 'SECRETARIA TECNICA DE LA CIRCUNSCRIPCION TERRITORIAL ESPECIAL AMAZONICA'],
      ['www.fiscalia.gob.ec', 'FISCALIA GENERAL DEL ESTADO'],
      ['gestionderiesgos.gob.ec', 'Secretaría Nacional de Gestión de Riesgos'],
      ['cenace.gob.ec', 'Operador Nacional de Electricidad - CENACE'],
      ['ejercitoecuatoriano.mil.ec', 'EJERCITO ECUATORIANO'],
      ['sri.gob.ec', 'SERVICIO DE RENTAS INTERNAS'],
      ['iess.gob.ec', 'INSTITUTO ECUATORIANO DE SEGURIDAD SOCIAL'],
      ['supercias.gob.ec', 'SUPERINTENDENCIA DE COMPAÑIAS VALORES Y SEGUROS'],
      ['uce.edu.ec', 'UNIVERSIDAD CENTRAL DEL ECUADOR'],
      ['loja.gob.ec', 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON LOJA'],
    ];
    for (const [domain, name] of ok) assert.equal(institutionWebMatchesName(domain, [name]), true, `${name} → ${domain}`);
  });

  it('la web de OTRA entidad no corresponde', () => {
    assert.equal(institutionWebMatchesName('registrocivil.gob.ec', ['MINISTERIO DE GOBIERNO']), false);
    assert.equal(institutionWebMatchesName('www.registrocivil.gob.ec', ['MINISTERIO DE GOBIERNO', 'Ministerio de Gobierno']), false);
    assert.equal(institutionWebMatchesName('educacion.gob.ec', ['FISCALIA GENERAL DEL ESTADO']), false);
  });

  it('basta con uno de los nombres (razón social, nombre comercial, sigla oficial)', () => {
    assert.equal(institutionWebMatchesName('registrocivil.gob.ec', ['DIRECCION GENERAL DE REGISTRO CIVIL IDENTIFICACION Y CEDULACION']), true);
    assert.equal(institutionWebMatchesName('cenace.gob.ec', ['OPERADOR NACIONAL DE ELECTRICIDAD', 'CENACE']), true);
  });

  it('webs que no son de gobierno/educación, o nombres sin palabras distintivas: no se juzga', () => {
    assert.equal(institutionWebMatchesName('polipapel.com', ['PYCCA S.A.']), true);
    assert.equal(institutionWebMatchesName(null, ['MINISTERIO DE GOBIERNO']), true);
    assert.equal(institutionWebMatchesName('loquesea.gob.ec', ['MINISTERIO NACIONAL']), true);
    assert.equal(institutionHostLabel('https://www.admision.educacion.gob.ec/'), 'admisioneducacion');
    assert.equal(institutionHostLabel('kruger.com.ec'), null);
  });
});

const MODEL = 'claude-haiku-4-5-20251001';
const USAGE = { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 };

function ministry(): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'MINISTERIO DE GOBIERNO',
    domain: null,
    country_code: 'EC',
    industry: 'Gobierno',
    reason_code: 'missing_domain_final',
    round_origin: 'free_source',
    provider_identifier: 'tax:1760000660001',
    evidence: { provider_raw_name: 'MINISTERIO DE GOBIERNO', tax_identifier_present: true, tax_identifier_type: 'RUC' },
  } as RescuableDispositionRow;
}

function fakeDeps(foundDomain: string) {
  const evidence = new Map<string, Record<string, unknown>>();
  const admitted: string[] = [];
  const dupChecks: unknown[] = [];
  const found: DomainFinderOutcome = {
    found: true,
    website: `https://${foundDomain}`,
    domain: foundDomain,
    verification: 'name_match',
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.01, pricingSource: 'table' },
  } as DomainFinderOutcome;
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'gov', industryName: 'Gobierno', industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [ministry()],
    loadBatchIndustryId: async () => 'gov',
    classify: async (company) =>
      ({
        candidateId: company.candidateId,
        outcome: 'classified',
        sector: { industryId: 'gov', industryName: 'Gobierno', subindustryId: null, subindustryName: null, matchesCurrentIndustry: true, quote: 'Ministerio', sourceUrl: `https://${foundDomain}/`, confidence: 0.9, verification: 'quote_verified' },
        employeeRange: null,
        rejected: [],
        isOperatingCompany: true,
        pageFinalUrl: `https://${foundDomain}/`,
        usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.02, pricingSource: 'table' },
        errorCode: null,
        durationMs: 10,
      }) as unknown as CompanyClassificationResult,
    logUsage: async () => true,
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? ministry().evidence);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async (id) => (admitted.push(id), `new-${id}`),
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async () => found,
      checkDuplicate: async (input) => (dupChecks.push(input), { status: 'new_candidate' as never, summary: '' }),
    },
    nowIso: () => '2026-10-07T17:00:00.000Z',
    nowMs: () => Date.parse('2026-10-07T17:00:00.000Z'),
  };
  return { deps, evidence, admitted, dupChecks };
}

describe('B. el rescate', () => {
  it('MINISTERIO DE GOBIERNO + registrocivil.gob.ec ⇒ se queda en Descartadas (web no encontrada), sin admitir', async () => {
    const f = fakeDeps('registrocivil.gob.ec');
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    assert.equal(s.ok && s.dispositionsKept, 1);
    assert.deepEqual(f.admitted, []);
    assert.deepEqual(f.dupChecks, [], 'ni siquiera se revisa duplicado con una web ajena');
    const ev = f.evidence.get('d1')!;
    assert.equal((ev.claude_rescue as { decision: string }).decision, 'website_not_found');
    assert.equal((ev.claude_domain_search as { claimed_url: string }).claimed_url, 'https://registrocivil.gob.ec');
  });

  it('con su propia web (ministeriodegobierno.gob.ec) sigue el camino normal', async () => {
    const f = fakeDeps('ministeriodegobierno.gob.ec');
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    assert.equal(f.dupChecks.length, 1);
  });
});

describe('C. v2 — nombres de uso conocidos y una vuelta más (Prod 07-10, 9fc7fc7b)', () => {
  const RREE = 'MINISTERIO DE RELACIONES EXTERIORES Y MOVILIDAD HUMANA';

  it('Relaciones Exteriores → cancilleria.gob.ec corresponde', () => {
    assert.equal(institutionWebMatchesName('cancilleria.gob.ec', [RREE]), true);
    assert.equal(institutionWebMatchesName('cancilleria.gob.ec', ['MINISTERIO DE GOBIERNO']), false, 'el alias no vale para otra entidad');
  });

  function rejected(name: string, claimedUrl: string, version?: number): RescuableDispositionRow {
    return {
      ...ministry(),
      name,
      evidence: {
        provider_raw_name: name,
        tax_identifier_present: true,
        claude_rescue: { decision: 'website_not_found', decided_at: '2026-10-07T19:01:38.510Z' },
        claude_domain_search: {
          found: false,
          reason: 'identity_not_confirmed',
          claimed_url: claimedUrl,
          attempts: 1,
          ...(version === undefined ? {} : { institution_web_rule: version }),
        },
      },
    } as RescuableDispositionRow;
  }

  it('la que la regla anterior rechazó y hoy corresponde vuelve UNA vez', () => {
    const now = Date.parse('2026-10-07T20:00:00.000Z');
    assert.equal(websiteRejectedByOlderInstitutionRule(rejected(RREE, 'https://cancilleria.gob.ec')), true);
    assert.equal(needsDispositionRescue(rejected(RREE, 'https://cancilleria.gob.ec'), now, true), true);
    // Ya buscada con la regla de hoy: no se repite.
    assert.equal(websiteRejectedByOlderInstitutionRule(rejected(RREE, 'https://cancilleria.gob.ec', INSTITUTION_WEB_RULE_VERSION)), false);
    // Sigue sin corresponder: no vuelve.
    assert.equal(websiteRejectedByOlderInstitutionRule(rejected('MINISTERIO DE GOBIERNO', 'https://registrocivil.gob.ec')), false);
    // Web privada: no es asunto de esta regla.
    assert.equal(websiteRejectedByOlderInstitutionRule(rejected('PYCCA S.A.', 'https://polipapel.com')), false);
  });

  it('toda búsqueda nueva guarda la versión de la regla (no se reabre en bucle)', async () => {
    const f = fakeDeps('registrocivil.gob.ec');
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    const search = f.evidence.get('d1')!.claude_domain_search as { institution_web_rule: number };
    assert.equal(search.institution_web_rule, INSTITUTION_WEB_RULE_VERSION);
  });
});
