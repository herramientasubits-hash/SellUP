/**
 * AGENT1-COUNTRY-EVIDENCE-CONTRACT-X6.2-A
 *
 * El eje PAÍS adopta la doctrina de `candidate-survival.ts` (X5): los gates
 * OBLIGATORIOS deciden quién sobrevive; la evidencia COMPLETA y nunca rechaza;
 * la ausencia de evidencia es ausencia, no evidencia en contra.
 *
 * Medido en el lote `f6cad05f-570f-4791-8879-4c803932349b` (CO × Retail ×
 * target 5, Apollo forzado): 14 empresas pasaron ownership (`allowed: true` en
 * las 14) y NUEVE murieron en `evidence_policy:no_country_evidence_with_weak_fit`
 * sin una sola señal en contra — `country_rejected = 0`,
 * `gap_causes = {"evidence_policy": 9}`. Sus propias filas de descarte guardaban
 * la decisión que el writer revirtió: `original_final_disposition` =
 * `persisted_review_only_final` (7) y `provisionally_persisted_pending_writer_final` (2).
 *
 * Los DOMINIOS de las nueve son los reales de esa corrida. Cuatro llevaban el
 * ccTLD `.co`, que este gate no reconocía aunque `country-compatibility.ts` y
 * `company-ownership-gate.ts` sí; cinco llevaban `.com` y sólo las recupera la
 * separación supervivencia/completitud.
 *
 * T1–T16 + los anclajes de las mutaciones M1–M7.
 *
 * Puro salvo donde se declara: 0 llamadas a proveedor, 0 créditos, 0 Supabase
 * real, 0 escrituras, 0 migraciones, 0 banderas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  evaluateCountryEvidence,
  matchColombianHostSuffix,
  resolveCountryEvidenceHostname,
} from '../country-evidence-gate';
import {
  computeEvidencePersistencePolicy,
  isPaidCompletionBlockedByEvidencePolicy,
  type EvidencePersistencePolicyResult,
} from '../evidence-persistence-policy';
import { evaluateCountryCompatibility } from '../country-compatibility';
import { evaluateBusinessFit } from '../business-fit-gate';
import type { BusinessFitResult } from '../business-fit-gate';
import {
  evaluateCandidateTargetEligibility,
  INCOMPLETE_COUNTRY_EVIDENCE_REVIEW_FLAG,
} from '../candidate-completeness-contract';
import {
  decideCandidateSurvival,
  classifySectorEvidence,
  resolveFinalCandidateCap,
  FINAL_CANDIDATE_CAP_UNBOUNDED,
} from '../candidate-survival';
import {
  isEligibleForLinkedInSearch,
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
} from '../linkedin-company-search';
import {
  evaluateRichProfileEnrichmentEligibility,
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
} from '../rich-profile-enrichment';
import { writeProspectingCandidates } from '../candidate-writer';
import type {
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';

// ─── Fixtures: las NUEVE del lote f6cad05f, con sus dominios reales ──────────

type NineFixture = { name: string; domain: string; expected: 'strong' | 'weak' };

const NINE_BLOCKED_BY_EVIDENCE_POLICY: readonly NineFixture[] = [
  { name: 'Caribe Supermercados', domain: 'caribesupermercados.co', expected: 'strong' },
  { name: 'Sinmente. CO.', domain: 'sinmente.co', expected: 'strong' },
  { name: 'Mister Pollo MRP', domain: 'misterpollo.co', expected: 'strong' },
  { name: 'Go Domicilios', domain: 'godomicilios.co', expected: 'strong' },
  { name: 'Primavera', domain: 'tiendaprimavera.com', expected: 'weak' },
  { name: 'Cuoco', domain: 'cuocoapp.com', expected: 'weak' },
  { name: 'PRIMARIO', domain: '1primario.com', expected: 'weak' },
  { name: 'Producción y Gestión S.A.S', domain: 'produccionygestion.com', expected: 'weak' },
  { name: 'Carnes Frias', domain: 'carnesfriascalimas.com', expected: 'weak' },
] as const;

/** El snippet REAL que Apollo Organizations Search produjo: sin `País:`, sin `Ciudad:`. */
function apolloSnippet(name: string): string {
  return `Empresa: ${name} | [Fuente: Apollo Organizations]`;
}

/** La query REAL de la corrida. El país viajó como filtro server-side, no como texto. */
const REAL_QUERY_TEXT = 'Retail';

function countryEvidenceFor(fixture: NineFixture) {
  return evaluateCountryEvidence({
    website: `http://www.${fixture.domain}`,
    domain: fixture.domain,
    sourceSnippet: apolloSnippet(fixture.name),
    sourceTitle: fixture.name,
    queryText: REAL_QUERY_TEXT,
    targetCountryCode: 'CO',
  });
}

function makeBusinessFit(fit: 'high' | 'medium' | 'low' | 'reject'): BusinessFitResult {
  return { fit, rankingBonus: 0, reasons: [], matchedSignals: [], missingSignals: [] };
}

function policyFor(fixture: NineFixture): EvidencePersistencePolicyResult {
  return computeEvidencePersistencePolicy({
    countryEvidence: countryEvidenceFor(fixture),
  });
}

// ─── T1 — el ccTLD `.co`, reconocido por SUFIJO DE HOSTNAME ──────────────────

describe('T1 — `.co` reconocido como evidencia de país', () => {
  const cases: readonly string[] = [
    'empresa.co',
    'caribesupermercados.co',
    'sinmente.co',
    'misterpollo.co',
    'godomicilios.co',
    'subdominio.empresa.co',
    'www.empresa.co',
  ];

  for (const domain of cases) {
    it(`${domain} → strong con fuente url:.co`, () => {
      const result = evaluateCountryEvidence({
        website: `https://${domain}`,
        domain,
        sourceSnippet: 'Empresa | [Fuente: Apollo Organizations]',
        sourceTitle: 'Empresa',
        queryText: REAL_QUERY_TEXT,
        targetCountryCode: 'CO',
      });
      assert.equal(result.evidenceLevel, 'strong');
      assert.deepEqual(result.evidenceSources, ['url:.co']);
      assert.equal(result.warning, null);
    });
  }

  it('sólo con `domain`, sin website, también se reconoce', () => {
    const result = evaluateCountryEvidence({
      website: null,
      domain: 'caribesupermercados.co',
      sourceSnippet: apolloSnippet('Caribe Supermercados'),
      sourceTitle: 'Caribe Supermercados',
      queryText: REAL_QUERY_TEXT,
      targetCountryCode: 'CO',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.deepEqual(result.evidenceSources, ['url:.co']);
  });

  it('el TLD desnudo NO es un hostname de empresa', () => {
    assert.equal(matchColombianHostSuffix('co'), null);
    assert.equal(matchColombianHostSuffix('com.co'), null);
  });
});

// ─── T2 — las claves ya persistidas no cambian ───────────────────────────────

describe('T2 — `.com.co` y hermanos conservan su clave de evidenceSources', () => {
  const preserved: ReadonlyArray<readonly [string, string]> = [
    ['empresa.com.co', 'url:.com.co'],
    ['empresa.net.co', 'url:.net.co'],
    ['empresa.org.co', 'url:.org.co'],
    ['entidad.gov.co', 'url:.gov.co'],
    ['universidad.edu.co', 'url:.edu.co'],
    ['fuerza.mil.co', 'url:.mil.co'],
  ];

  for (const [domain, expectedSource] of preserved) {
    it(`${domain} → strong con ${expectedSource} (clave intacta, NO url:.co)`, () => {
      const result = evaluateCountryEvidence({
        website: `https://${domain}/productos`,
        domain,
        sourceSnippet: 'Empresa',
        sourceTitle: 'Empresa',
        queryText: null,
        targetCountryCode: 'CO',
      });
      assert.equal(result.evidenceLevel, 'strong');
      assert.deepEqual(result.evidenceSources, [expectedSource]);
    });
  }

  it('los fragmentos de URL conservan su clave', () => {
    const fragments: ReadonlyArray<readonly [string, string]> = [
      ['https://acme.com/colombia/tiendas', 'url:/colombia'],
      ['https://acme.com/es-co/inicio', 'url:/es-co'],
      ['https://acme.com/co-es/inicio', 'url:/co-es'],
      ['https://acme-colombia.com', 'url:-colombia'],
    ];
    for (const [website, expectedSource] of fragments) {
      const result = evaluateCountryEvidence({
        website,
        domain: null,
        sourceSnippet: 'Empresa',
        sourceTitle: 'Empresa',
        queryText: null,
        targetCountryCode: 'CO',
      });
      assert.equal(result.evidenceLevel, 'strong', website);
      assert.deepEqual(result.evidenceSources, [expectedSource], website);
    }
  });

  it('el TLD gana al fragmento, como en la lista única anterior', () => {
    const result = evaluateCountryEvidence({
      website: 'https://acme.com.co/colombia',
      domain: 'acme.com.co',
      sourceSnippet: 'Empresa',
      sourceTitle: 'Empresa',
      queryText: null,
      targetCountryCode: 'CO',
    });
    assert.deepEqual(result.evidenceSources, ['url:.com.co']);
  });
});

// ─── T3 — un `.com` NO se convierte en evidencia CO ──────────────────────────

describe('T3 — adversarios de subcadena: sólo el sufijo del hostname cuenta', () => {
  const notColombian: readonly string[] = [
    'carnesfriascalimas.com',
    'tiendaprimavera.com',
    'cuocoapp.com',
    '1primario.com',
    'produccionygestion.com',
    'empresa.com',
    'empresa.company',
    'empresa.coop',
    'empresa.college',
    'empresa.co.uk',
  ];

  for (const domain of notColombian) {
    it(`${domain} → sin evidencia por TLD`, () => {
      assert.equal(matchColombianHostSuffix(domain), null);
      const result = evaluateCountryEvidence({
        website: `https://${domain}`,
        domain,
        sourceSnippet: 'Enterprise software solutions',
        sourceTitle: 'Enterprise Software',
        queryText: 'software empresarial B2B corporativo',
        targetCountryCode: 'CO',
      });
      assert.equal(result.evidenceLevel, 'weak', domain);
      assert.deepEqual(result.evidenceSources, [], domain);
    });
  }

  it('`.com.co` dentro de un parámetro NO es evidencia (falso positivo anterior)', () => {
    const result = evaluateCountryEvidence({
      website: 'https://redirector.com/ir?u=empresa.com.co',
      domain: 'redirector.com',
      sourceSnippet: 'Redirector',
      sourceTitle: 'Redirector',
      queryText: null,
      targetCountryCode: 'CO',
    });
    assert.equal(result.evidenceLevel, 'weak');
    assert.deepEqual(result.evidenceSources, []);
  });

  it('el hostname se resuelve con precedencia website → domain', () => {
    assert.equal(resolveCountryEvidenceHostname('https://www.acme.com.co/x', 'otro.co'), 'acme.com.co');
    assert.equal(resolveCountryEvidenceHostname(null, 'acme.co'), 'acme.co');
    assert.equal(resolveCountryEvidenceHostname('no es una url', 'acme.co'), 'acme.co');
    assert.equal(resolveCountryEvidenceHostname(null, null), null);
  });
});

// ─── T4 — ausencia de evidencia ≠ rechazo ────────────────────────────────────

describe('T4 — la ausencia de evidencia de país no rechaza', () => {
  it('weak + medium → NO blocked', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: evaluateCountryEvidence({
        website: 'https://tiendaprimavera.com',
        domain: 'tiendaprimavera.com',
        sourceSnippet: apolloSnippet('Primavera'),
        sourceTitle: 'Primavera',
        queryText: REAL_QUERY_TEXT,
        targetCountryCode: 'CO',
      }),
    });
    assert.notEqual(policy.decision, 'blocked');
    assert.equal(policy.decision, 'needs_review');
    assert.equal(policy.primaryReason, 'country_evidence_absent_survives_incomplete');
    assert.equal(policy.incompletenessReason, 'country_evidence_absent');
  });

  it('weak + low tampoco bloquea (aunque `isBlockedByBusinessFit` ya lo habría parado antes)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    });
    assert.notEqual(policy.decision, 'blocked');
    assert.equal(policy.incompletenessReason, 'country_evidence_absent');
  });

  it('el warning describe un hueco NUESTRO, no un veredicto sobre la empresa', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    });
    const joined = policy.warnings.join(' ');
    assert.ok(joined.includes('Ausencia de evidencia, no evidencia en contra'));
    assert.ok(!joined.includes('no persistible'));
  });
});

// ─── T5 — la contradicción real sigue rechazando ─────────────────────────────

describe('T5 — evidencia CONTRARIA de país sigue siendo rechazo', () => {
  const foreign: readonly string[] = [
    'https://empresa.com.mx',
    'https://empresa.cl',
    'https://empresa.com.br',
    'https://empresa.com.ar',
    'https://empresa.es',
  ];

  for (const url of foreign) {
    it(`${url} → incompatible con CO`, () => {
      const compat = evaluateCountryCompatibility(url, 'CO');
      assert.equal(compat.compatible, false);
      assert.ok(compat.reason.startsWith('foreign_country_tld:'));
    });
  }

  it('dominio global con path extranjero explícito → incompatible', () => {
    const compat = evaluateCountryCompatibility('https://cosmoconsult.com/cl/consultoria', 'CO');
    assert.equal(compat.compatible, false);
    assert.equal(compat.reason, 'global_domain_with_foreign_path:CL');
  });

  it('el gate de contradicción sigue reconociendo `.co` como CO', () => {
    const compat = evaluateCountryCompatibility('https://caribesupermercados.co', 'CO');
    assert.equal(compat.compatible, true);
    assert.equal(compat.reason, 'co_national_tld');
  });
});

// ─── T6 — `organization_locations` no se sobreinterpreta ─────────────────────

describe('T6 — el filtro server-side de país no es evidencia', () => {
  it('la firma de evaluateCountryEvidence no admite el filtro de localización', () => {
    const keys = [
      'website',
      'domain',
      'sourceSnippet',
      'sourceTitle',
      'queryText',
      'targetCountryCode',
    ];
    // El contrato es estructural: si alguien añadiera `organizationLocations`
    // como entrada, tendría que cambiar la firma y esta lista.
    const input = {
      website: 'https://tiendaprimavera.com',
      domain: 'tiendaprimavera.com',
      sourceSnippet: apolloSnippet('Primavera'),
      sourceTitle: 'Primavera',
      queryText: REAL_QUERY_TEXT,
      targetCountryCode: 'CO',
    };
    assert.deepEqual(Object.keys(input).sort(), [...keys].sort());
    assert.equal(evaluateCountryEvidence(input).evidenceLevel, 'weak');
  });

  it('`targetCountryCode: CO` por sí solo no produce evidencia', () => {
    const result = evaluateCountryEvidence({
      website: 'https://acme.com',
      domain: 'acme.com',
      sourceSnippet: 'Retail company',
      sourceTitle: 'Acme',
      queryText: REAL_QUERY_TEXT,
      targetCountryCode: 'CO',
    });
    assert.equal(result.evidenceLevel, 'weak');
    assert.deepEqual(result.evidenceSources, []);
  });

  it('la query de la corrida real («Retail») no alcanza ni siquiera query_only', () => {
    for (const fixture of NINE_BLOCKED_BY_EVIDENCE_POLICY) {
      const result = countryEvidenceFor(fixture);
      assert.notEqual(result.evidenceLevel, 'query_only', fixture.domain);
    }
  });
});

// ─── T7 — `countryCompatible` no se sobreinterpreta ──────────────────────────

describe('T7 — `countryCompatible: true` significa «no contradijo», no «confirmado»', () => {
  it('un .com neutro es compatible y sigue SIN evidencia de país', () => {
    const compat = evaluateCountryCompatibility('https://tiendaprimavera.com', 'CO');
    assert.equal(compat.compatible, true);
    assert.equal(compat.confidence, 'medium');
    assert.equal(compat.reason, 'global_domain_no_country_signal');

    const evidence = evaluateCountryEvidence({
      website: 'https://tiendaprimavera.com',
      domain: 'tiendaprimavera.com',
      sourceSnippet: apolloSnippet('Primavera'),
      sourceTitle: 'Primavera',
      queryText: REAL_QUERY_TEXT,
      targetCountryCode: 'CO',
    });
    assert.equal(evidence.evidenceLevel, 'weak');
  });
});

// ─── T8 — Primavera sobrevive ────────────────────────────────────────────────

describe('T8 — ownership pass + enrichment pagado + país ausente → sobrevive', () => {
  it('Primavera (tiendaprimavera.com) no se descarta', () => {
    const policy = policyFor(NINE_BLOCKED_BY_EVIDENCE_POLICY[4]);
    assert.equal(NINE_BLOCKED_BY_EVIDENCE_POLICY[4].domain, 'tiendaprimavera.com');
    assert.notEqual(policy.decision, 'blocked');
    assert.equal(policy.incompletenessReason, 'country_evidence_absent');
    assert.equal(policy.targetAcceptanceAuthorized, false);
    assert.equal(policy.paidCompletionAuthorized, false);
  });

  it('Caribe Supermercados (.co) obtiene evidencia strong', () => {
    const fixture = NINE_BLOCKED_BY_EVIDENCE_POLICY[0];
    assert.equal(fixture.domain, 'caribesupermercados.co');
    const evidence = countryEvidenceFor(fixture);
    assert.equal(evidence.evidenceLevel, 'strong');
    assert.deepEqual(evidence.evidenceSources, ['url:.co']);
  });

  it('las NUEVE sobreviven y ninguna queda en blocked', () => {
    for (const fixture of NINE_BLOCKED_BY_EVIDENCE_POLICY) {
      const evidence = countryEvidenceFor(fixture);
      assert.equal(evidence.evidenceLevel, fixture.expected, fixture.domain);
      assert.notEqual(policyFor(fixture).decision, 'blocked', fixture.domain);
    }
  });
});

// ─── T10 — `blocked` es inalcanzable desde el eje país ───────────────────────

describe('T10 — ninguna entrada del eje país produce `blocked`', () => {
  it('barrido exhaustivo de nivel × fit', () => {
    const levels = ['strong', 'query_only', 'weak'] as const;
    const fits = ['high', 'medium', 'low', 'reject'] as const;
    for (const evidenceLevel of levels) {
      for (const fit of fits) {
        const policy = computeEvidencePersistencePolicy({
          countryEvidence: { evidenceLevel, evidenceSources: [], warning: null },
        });
        assert.notEqual(policy.decision, 'blocked', `${evidenceLevel}/${fit}`);
      }
    }
  });

  it('ningún primaryReason del eje país afirma un veredicto sobre la empresa', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    });
    assert.notEqual(policy.primaryReason, 'no_country_evidence_with_weak_fit');
  });
});

// ─── T12 — 0 gasto nuevo ─────────────────────────────────────────────────────

describe('T12 — la supervivencia no abre ni un crédito', () => {
  it('país ausente ⇒ completado pagado sigue bloqueado', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    });
    assert.equal(isPaidCompletionBlockedByEvidencePolicy(policy), true);
  });

  it('rich profile: el mismo skipReason de antes del corte', () => {
    const result = evaluateRichProfileEnrichmentEligibility(
      {
        name: 'Primavera',
        domain: 'tiendaprimavera.com',
        website: 'https://tiendaprimavera.com',
        confidenceScore: 90,
        isBlockedByEvidencePolicy: true,
      },
      { ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG, enabled: true, provider: 'mock' },
    );
    assert.equal(result.eligible, false);
    assert.equal((result as { eligible: false; reason: string }).reason, 'evidence_policy_blocked');
  });

  it('LinkedIn search: el mismo skipReason de antes del corte', () => {
    const result = isEligibleForLinkedInSearch(
      {
        name: 'Primavera',
        domain: 'tiendaprimavera.com',
        confidenceScore: 90,
        currentEnrichment: { status: 'not_found' },
        isBlockedByEvidencePolicy: true,
      } as unknown as Parameters<typeof isEligibleForLinkedInSearch>[0],
      { ...DEFAULT_LINKEDIN_SEARCH_CONFIG, enabled: true, provider: 'mock' },
    );
    assert.equal(result.eligible, false);
    assert.equal(result.skipReason, 'evidence_policy_blocked');
  });

  it('las dos rutas de gasto están APAGADAS por defecto, que es la forma que usa producción', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.provider, 'disabled');
  });
});

// ─── T13 — el objetivo no gana aceptaciones ──────────────────────────────────

describe('T13 — un superviviente sin evidencia de país NO cuenta hacia el objetivo', () => {
  it('quality_gate fail ⇒ countsTowardTarget false, con la causa listada', () => {
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'fail',
    });
    assert.equal(eligibility.countsTowardTarget, false);
    assert.ok(eligibility.failedConditions.includes('quality_gate'));
  });

  it('con TODO lo demás confirmado, sólo el país lo deja fuera', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    });
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: policy.targetAcceptanceAuthorized ? 'pass' : 'fail',
    });
    assert.equal(eligibility.countsTowardTarget, false);
  });

  /**
   * 🔴 BUSINESS-FIT-OBSERVATION-ONLY — esta invariante CAMBIÓ de oráculo, y hay
   * que decir por qué.
   *
   * X6.2-A la escribió para probar que su corte no movía ni una aceptación: el
   * conjunto no autorizado tenía que ser EXACTAMENTE el que antes salía
   * `blocked`, y ése se definía con el nivel de `business_fit`.
   *
   * La decisión de producto retira `business_fit` de la aceptación, así que el
   * oráculo ya no puede leerlo: el conjunto no autorizado pasa a ser el de
   * evidencia de país DÉBIL, sea cual sea el encaje. Lo que la invariante
   * protege es lo mismo de siempre —que las dos autorizaciones se muevan juntas
   * y sólo por evidencia de país—, y ahora además prueba que el fit no las toca.
   */
  it('🔴 sólo la evidencia de PAÍS decide las dos autorizaciones', () => {
    const levels = ['strong', 'query_only', 'weak'] as const;
    const sources = [[], ['snippet']] as const;
    for (const evidenceLevel of levels) {
      for (const evidenceSources of sources) {
        const policy = computeEvidencePersistencePolicy({
          countryEvidence: { evidenceLevel, evidenceSources: [...evidenceSources], warning: null },
        });
        const debeEstarBloqueada = evidenceLevel === 'weak';
        assert.equal(
          policy.targetAcceptanceAuthorized,
          !debeEstarBloqueada,
          `target/${evidenceLevel}/${evidenceSources.length}`,
        );
        assert.equal(
          policy.paidCompletionAuthorized,
          !debeEstarBloqueada,
          `paid/${evidenceLevel}/${evidenceSources.length}`,
        );
      }
    }
  });
});

// ─── T14 — X5 / X5.1 / X5.2 intactos ─────────────────────────────────────────

describe('T14 — la doctrina de supervivencia de X5 no se toca', () => {
  it('decideCandidateSurvival conserva su semántica', () => {
    assert.equal(
      decideCandidateSurvival({ mandatoryRejection: null, sectorEvidenceState: 'sector_evidence_confirmed' }).cohort,
      'eligible_for_target',
    );
    assert.equal(
      decideCandidateSurvival({
        mandatoryRejection: null,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      }).cohort,
      'survives_incomplete',
    );
    assert.equal(
      decideCandidateSurvival({ mandatoryRejection: 'ownership_mismatch', sectorEvidenceState: 'sector_evidence_confirmed' }).cohort,
      'rejected',
    );
  });

  it('X5.2: `sector_not_mapped` sigue siendo ausencia, no rechazo', () => {
    assert.equal(classifySectorEvidence('sector_not_mapped'), 'sector_evidence_absent');
    assert.equal(classifySectorEvidence('sector_evidence_contradictory'), 'sector_mandatory_rejection');
  });

  it('X5: el target sigue sin ser tope de existencia', () => {
    assert.equal(FINAL_CANDIDATE_CAP_UNBOUNDED, null);
    assert.equal(resolveFinalCandidateCap(null), null);
    assert.equal(resolveFinalCandidateCap(undefined), null);
    assert.equal(resolveFinalCandidateCap(7), 7);
  });

  it('la firma de decideCandidateSurvival no admite señales de país ni de gasto', () => {
    const input = { mandatoryRejection: null, sectorEvidenceState: 'sector_evidence_confirmed' };
    assert.deepEqual(Object.keys(input).sort(), ['mandatoryRejection', 'sectorEvidenceState']);
  });
});

// ─── T16 — AR pinneado: el límite declarado ──────────────────────────────────

describe('T16 — el ccTLD desnudo `.ar` sigue SIN ser evidencia (límite declarado)', () => {
  it('empresa.ar → weak; empresa.com.ar → strong', () => {
    const bare = evaluateCountryEvidence({
      website: 'https://empresa.ar',
      domain: 'empresa.ar',
      sourceSnippet: 'Empresa',
      sourceTitle: 'Empresa',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(bare.evidenceLevel, 'weak');

    const second = evaluateCountryEvidence({
      website: 'https://empresa.com.ar',
      domain: 'empresa.com.ar',
      sourceSnippet: 'Empresa',
      sourceTitle: 'Empresa',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(second.evidenceLevel, 'strong');
    assert.ok(second.evidenceSources.includes('argentina_domain_com_ar'));
  });

  it('AR con país ausente tampoco se rechaza ya', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: evaluateCountryEvidence({
        website: 'https://empresa.ar',
        domain: 'empresa.ar',
        sourceSnippet: 'Empresa',
        sourceTitle: 'Empresa',
        queryText: null,
        targetCountryCode: 'AR',
      }),
    });
    assert.notEqual(policy.decision, 'blocked');
  });

  it('un país sin reglas implementadas ya NO se penaliza, como su comentario prometía', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: evaluateCountryEvidence({
        website: 'https://empresa.com.ec',
        domain: 'empresa.com.ec',
        sourceSnippet: 'Empresa',
        sourceTitle: 'Empresa',
        queryText: null,
        targetCountryCode: 'EC',
      }),
    });
    assert.notEqual(policy.decision, 'blocked');
  });
});

// ─── Writer: T8/T9/T9b/T11/T15 ───────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<ProspectingPipelineCandidate>,
): ProspectingPipelineCandidate {
  return {
    name: 'Test Company',
    domain: 'testcompany.com',
    website: 'https://testcompany.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail',
    scoring: {
      qualityLabel: 'needs_review',
      confidenceScore: 80,
      fitScore: 60,
      dataCompletenessScore: 70,
      recommendedAction: 'approve_for_review',
      reasons: [],
      warnings: [],
      blockers: [],
    },
    websiteVerification: null,
    duplicateCheck: null,
    sourceUrl: 'https://testcompany.com',
    sourceTitle: 'Test Company',
    sourceSnippet: 'Test company snippet',
    inferredNameSource: 'title',
    searchTrace: { query_text: REAL_QUERY_TEXT },
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function makePipelineOutput(candidates: ProspectingPipelineCandidate[]): ProspectingPipelineOutput {
  return {
    candidates,
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail',
      targetCount: candidates.length,
      searchDepth: 'standard',
    },
    summary: {
      requested: candidates.length,
      returned: candidates.length,
      highQualityNew: 0,
      needsReview: candidates.length,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
    },
    metadata: { provider: 'mock', pipelineVersion: 'test', executedAt: new Date().toISOString() },
    warnings: [],
  } as unknown as ProspectingPipelineOutput;
}

type InsertedRow = Record<string, unknown>;

/**
 * Doble de Supabase que CAPTURA las filas insertadas.
 *
 * Misma forma que el doble de `canonical-identity-gate-writer.test.ts` —
 * incluida la respuesta `PGRST202` de `rpc`, que reproduce una base sin la
 * migración 126, el estado real de producción — más la captura, que esta suite
 * necesita para leer `status`, `review_flags` y `metadata` de la fila escrita.
 *
 * 0 red, 0 Supabase real, 0 escrituras.
 */
function makeCapturingAdminClient(
  captured: InsertedRow[],
  batchUpdates: InsertedRow[] = [],
): SupabaseClient {
  let insertedCandidateCount = 0;
  const chainable = (data: unknown, error: unknown = null) => {
    const obj: Record<string, unknown> = {
      data,
      error,
      select: () => obj,
      insert: () => obj,
      update: () => obj,
      eq: () => obj,
      neq: () => obj,
      in: () => obj,
      not: () => obj,
      gte: () => obj,
      single: () => ({ data, error }),
    };
    return obj;
  };

  return {
    rpc: async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function read_batch_identity_snapshot in the schema cache',
      },
    }),
    from: (table: string) => {
      const obj: Record<string, unknown> = {};

      obj.select = () => {
        if (table === 'prospect_batches') {
          return { eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }) };
        }
        if (table === 'prospect_candidates') {
          return {
            eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
            in: (col: string) => {
              if (col === 'domain') return Promise.resolve({ data: [], error: null });
              const previous = Promise.resolve({ data: [], error: null });
              return { not: () => ({ neq: () => previous }) };
            },
          };
        }
        return chainable([]);
      };

      obj.insert = (row: unknown) => {
        if (table === 'prospect_batches') {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'test-batch-id' }, error: null }),
            }),
          };
        }
        if (table === 'prospect_candidates') {
          insertedCandidateCount++;
          captured.push(row as InsertedRow);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: `cand-${insertedCandidateCount}` }, error: null }),
            }),
          };
        }
        return Promise.resolve({ data: null, error: null });
      };

      obj.update = (row: unknown) => {
        if (table === 'prospect_batches') batchUpdates.push(row as InsertedRow);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      };
      return obj;
    },
  } as unknown as SupabaseClient;
}

async function writeOne(candidates: ProspectingPipelineCandidate[]) {
  const captured: InsertedRow[] = [];
  const batchUpdates: InsertedRow[] = [];
  const result = await writeProspectingCandidates(
    {
      pipelineOutput: makePipelineOutput(candidates),
      triggeredByUserId: null,
      ownerId: null,
      batchName: null,
      source: 'agent_1',
      dryRun: false,
      extraBatchMetadata: null,
    },
    makeCapturingAdminClient(captured, batchUpdates),
  );
  return { result, captured, batchUpdates };
}

/** El `evidence_policy_gate` del ÚLTIMO update de lote que el writer emitió. */
function readEvidencePolicyGate(batchUpdates: InsertedRow[]): Record<string, unknown> | null {
  for (let i = batchUpdates.length - 1; i >= 0; i--) {
    const metadata = batchUpdates[i].metadata as Record<string, unknown> | undefined;
    const gate = metadata?.['evidence_policy_gate'] as Record<string, unknown> | undefined;
    if (gate) return gate;
  }
  return null;
}

describe('T9 / T15 — el writer persiste las NUEVE como revisión incompleta', () => {
  it('T15 — las nueve de `f6cad05f` producen fila, ninguna se descarta por evidence_policy', async () => {
    const candidates = NINE_BLOCKED_BY_EVIDENCE_POLICY.map((fixture) =>
      makeCandidate({
        name: fixture.name,
        domain: fixture.domain,
        website: `http://www.${fixture.domain}`,
        sourceUrl: `http://www.${fixture.domain}`,
        sourceTitle: fixture.name,
        sourceSnippet: apolloSnippet(fixture.name),
      }),
    );
    const { result, captured } = await writeOne(candidates);

    const evidenceSkips = result.skipped.filter((s) => s.reason.startsWith('evidence_policy:'));
    assert.deepEqual(evidenceSkips, [], JSON.stringify(result.skipped));
    assert.equal(result.candidatesCreated, 9, JSON.stringify(result.skipped));
    assert.equal(captured.length, 9);
  });

  it('T9 — la fila sin evidencia de país lleva status y causa correctos', async () => {
    const { result, captured } = await writeOne([
      makeCandidate({
        name: 'Primavera',
        domain: 'tiendaprimavera.com',
        website: 'http://www.tiendaprimavera.com',
        sourceUrl: 'http://www.tiendaprimavera.com',
        sourceTitle: 'Primavera',
        sourceSnippet: apolloSnippet('Primavera'),
      }),
    ]);
    assert.equal(result.candidatesCreated, 1);
    const row = captured[0];
    assert.equal(row.status, 'needs_review');
    assert.ok(
      (row.review_flags as string[]).includes(INCOMPLETE_COUNTRY_EVIDENCE_REVIEW_FLAG),
      JSON.stringify(row.review_flags),
    );
    const metadata = row.metadata as Record<string, unknown>;
    const policy = metadata.evidence_policy as Record<string, unknown>;
    assert.equal(policy.decision, 'needs_review');
    assert.equal(policy.incompleteness_reason, 'country_evidence_absent');
    assert.equal(policy.paid_completion_authorized, false);
    assert.equal(policy.target_acceptance_authorized, false);
    // Invariante 6: nunca llega como `high_quality_new`.
    assert.notEqual(row.status, 'high_quality_new');
  });

  it('T9b (D3) — forceReviewManually fuerza recommended_action', async () => {
    const { captured } = await writeOne([
      makeCandidate({
        name: 'Primavera',
        domain: 'tiendaprimavera.com',
        website: 'http://www.tiendaprimavera.com',
        sourceUrl: 'http://www.tiendaprimavera.com',
        sourceTitle: 'Primavera',
        sourceSnippet: apolloSnippet('Primavera'),
      }),
    ]);
    const metadata = captured[0].metadata as Record<string, unknown>;
    const scoring = metadata.scoring as Record<string, unknown>;
    assert.equal(scoring.recommended_action, 'review_manually');
    assert.equal(
      (metadata.evidence_policy as Record<string, unknown>).force_review_manually,
      true,
    );
  });

  it('T10 (writer) — `blocked_count` cae a 0 y la nueva cohorte tiene contador propio', async () => {
    const candidates = NINE_BLOCKED_BY_EVIDENCE_POLICY.map((fixture) =>
      makeCandidate({
        name: fixture.name,
        domain: fixture.domain,
        website: `http://www.${fixture.domain}`,
        sourceUrl: `http://www.${fixture.domain}`,
        sourceTitle: fixture.name,
        sourceSnippet: apolloSnippet(fixture.name),
      }),
    );
    const { batchUpdates } = await writeOne(candidates);
    const gate = readEvidencePolicyGate(batchUpdates);
    assert.ok(gate, 'el writer publica `evidence_policy_gate` en la metadata del lote');
    assert.equal(gate!.blocked_count, 0);
    // Las cinco `.com`. Las cuatro `.co` tienen evidencia y no son esta cohorte.
    assert.equal(gate!.country_evidence_absent_count, 5);
  });
});

describe('T11 — los adversarios extranjeros siguen sin llegar a la base', () => {
  const foreign: ReadonlyArray<readonly [string, string]> = [
    ['Empresa MX', 'empresa.com.mx'],
    ['Empresa CL', 'empresa.cl'],
    ['Empresa BR', 'empresa.com.br'],
  ];

  for (const [name, domain] of foreign) {
    it(`${domain} → descartada por contradicción de país`, async () => {
      const { result } = await writeOne([
        makeCandidate({
          name,
          domain,
          website: `https://${domain}`,
          sourceUrl: `https://${domain}`,
          sourceTitle: name,
          sourceSnippet: apolloSnippet(name),
        }),
      ]);
      assert.equal(result.candidatesCreated, 0);
      assert.ok(
        result.skipped.some((s) => s.reason.startsWith('country_incompatible:')),
        JSON.stringify(result.skipped),
      );
    });
  }
});
