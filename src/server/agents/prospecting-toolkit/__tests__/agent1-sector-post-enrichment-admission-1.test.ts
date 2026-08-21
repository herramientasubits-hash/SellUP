/**
 * agent1-sector-post-enrichment-admission-1.test.ts
 *
 * AGENT1-SECTOR-POST-ENRICHMENT-ADMISSION-1 — P0 · CATALOG-VALID CHILD-PRECISION
 * ADMISSION.
 *
 * Qué fija esta suite:
 *
 *   1. que una subindustria PEDIDA y confirmada OPERATIVAMENTE tras el enrichment
 *      satisface la admisión sectorial cuando el sector padre no tiene política
 *      legacy — sin hardcodes de Salud, Banca ni Tecnología;
 *   2. que la implicación NO se invierte: evidencia de la industria PADRE, sola,
 *      sigue sin admitir a nadie;
 *   3. que las ramas NEGATIVAS de `confirm_only` siguen siendo económicamente
 *      inertes: se abstienen, no admiten y tampoco rechazan de más;
 *   4. que las políticas legacy existentes —Retail, Educación— conservan sus
 *      decisiones EXACTAS: la vía nueva no puede cambiar ninguna;
 *   5. que cruzar el gate sectorial NO es contar hacia el objetivo.
 *
 * Todo el módulo bajo prueba es puro: sin proveedor, sin red, sin reloj, sin
 * escrituras, sin créditos.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  APOLLO_SECTOR_POST_ENRICHMENT_ADMISSION_VERSION,
  resolveApolloSectorPostEnrichmentAdmission,
  type ApolloSectorPostEnrichmentAdmissionInput,
} from '../apollo-sector-post-enrichment-admission';
import {
  evaluateApolloSectorEvidenceBootstrapAuthorization,
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
  type ApolloSectorEvidenceBootstrapAuthorization,
} from '../apollo-sector-evidence-bootstrap';
import {
  assessApolloSubindustryPrecisionForRequest,
  listSubindustryPrecisionRuleSets,
  projectOperationalSubindustryVerdict,
  resolveOperationalConfirmedRequestedSubindustry,
  toOperationalConfirmedRequestedSubindustryMetadata,
  type ApolloSubindustryPrecisionAssessment,
} from '../apollo-subindustry-precision';
import type { SubindustryPrecisionRuleSet } from '../apollo-subindustry-precision-rule-sets';
import { evaluateApolloSectorRelevanceForPaidOperationAnyOf } from '../apollo-sector-relevance-gate';
import {
  foldSubindustryPrecisionIntoSectorState,
  toSectorEvidenceState,
} from '../apollo-two-round/production-runner.server';
import {
  evaluateCandidateSubindustryTargetEligibility,
  resolveCandidateSubindustryRequirement,
} from '../candidate-completeness-contract';
import type { CandidateSectorEvidenceState } from '../apollo-two-round/enrichment-ranking';
import type { WebSearchResult } from '../types';

// ─── Utilidades ───────────────────────────────────────────────────────────────

function result(title: string, metadata: Record<string, unknown>): WebSearchResult {
  return {
    title,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata,
  } as unknown as WebSearchResult;
}

/** Perfil ENRIQUECIDO: lo que `organization_enrichment` deja en `apollo_profile`. */
function enrichedProfile(
  title: string,
  profile: { industry?: string; keywords?: string[] },
): WebSearchResult {
  return result(title, { apollo_profile: { ...profile } });
}

/** El payload de `search` de RUN 1: `accounts[]` sin ningún campo clasificatorio. */
const SEARCH_ONLY = (title: string): WebSearchResult => result(title, {});

const AUTHORIZED: ApolloSectorEvidenceBootstrapAuthorization =
  evaluateApolloSectorEvidenceBootstrapAuthorization({
    providerSearchExecuted: true,
    queryCoverageComplete: true,
    catalogVersionCoherent: true,
    catalogTermsResolved: true,
  });

const REDES = 'Redes Hospitalarias y Clínicas';
const LABS = 'Laboratorios Clínicos y Diagnóstico';
const EPS = 'Medicina Prepagada y EPS';
const BANCA = 'Banca Tradicional';
const CIBER = 'Ciberseguridad';
const UNIVERSIDADES = 'Universidades e Institutos Privados';
const SUPERMERCADOS = 'Supermercados e Hipermercados';
const DEPARTAMENTO = 'Tiendas por Departamento, Moda y Calzado';

/**
 * El CÓDIGO del módulo de admisión, sin comentarios ni cadenas de documentación.
 *
 * Los ratchets de abajo comprueban lo que el módulo HACE, no lo que explica: su
 * cabecera describe a propósito el bloqueo de Salud que cierra, y leer eso como
 * un hardcode confundiría documentación con dependencia.
 */
const ADMISSION_MODULE_CODE = readFileSync(
  new URL('../apollo-sector-post-enrichment-admission.ts', import.meta.url),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

/**
 * Reglas de precisión SINTÉTICAS, con vocabulario disjunto y ningún solapamiento
 * con las de producción.
 *
 * Existen porque hoy las dos únicas reglas `full` —Supermercados y Tiendas por
 * Departamento— tienen ADEMÁS política legacy de sector, así que por el camino de
 * producción una regla `full` nunca llega a la vía nueva. Sin estas fixtures no se
 * podría comprobar que la admisión es indiferente al modo de la regla, ni que la
 * elección de etiqueta es estable cuando DOS hijas confirman a la vez.
 */
const SYNTHETIC_FULL: SubindustryPrecisionRuleSet = {
  key: 'alfa modo completo',
  canonicalName: 'Alfa Modo Completo',
  subindustryId: null,
  precisionAliases: [],
  mode: 'full',
  catalogVersionId: null,
  anchors: ['ancla alfa'],
  anchorFamilies: null,
  exclusiveBusinessModels: ['excluyente alfa'],
  conflictingBusinessModels: ['conflicto alfa'],
  broadProviderIndustries: ['amplia alfa'],
  contradictoryProviderIndustries: ['contradice alfa'],
};

const SYNTHETIC_CONFIRM_ONLY: SubindustryPrecisionRuleSet = {
  ...SYNTHETIC_FULL,
  key: 'beta solo confirma',
  canonicalName: 'Beta Solo Confirma',
  mode: 'confirm_only',
  anchors: ['ancla beta'],
  exclusiveBusinessModels: ['excluyente beta'],
  conflictingBusinessModels: ['conflicto beta'],
  broadProviderIndustries: ['amplia beta'],
  contradictoryProviderIndustries: ['contradice beta'],
};

const ALFA = SYNTHETIC_FULL.canonicalName;
const BETA = SYNTHETIC_CONFIRM_ONLY.canonicalName;
const SYNTHETIC_OPTIONS = {
  ruleSets: [...listSubindustryPrecisionRuleSets(), SYNTHETIC_FULL, SYNTHETIC_CONFIRM_ONLY],
};

/**
 * La cadena REAL de producción, tal cual corre en `enrichCandidate`:
 *
 *   gate sectorial pagado (ANY-OF) → estado → pliegue con la precisión → admisión.
 *
 * Se reproduce entera y no sólo el módulo nuevo porque el defecto vivía en la
 * COMPOSICIÓN: cada pieza era correcta y el resultado conjunto perdía al candidato.
 */
function runPostEnrichmentChain(input: {
  candidate: WebSearchResult;
  sector: string | null;
  requested: string[];
  candidateEnriched?: boolean;
  authorization?: ApolloSectorEvidenceBootstrapAuthorization;
}): {
  precision: ApolloSubindustryPrecisionAssessment;
  foldedState: CandidateSectorEvidenceState;
  legacySectorPolicyPresent: boolean;
  admission: ReturnType<typeof resolveApolloSectorPostEnrichmentAdmission>;
} {
  const sector = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
    input.candidate,
    input.sector,
    input.requested,
    // Igual que producción tras el enrichment: la adquisición ya ocurrió.
    { sectorEvidenceBootstrap: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED },
  );
  const precision = assessApolloSubindustryPrecisionForRequest(input.candidate, input.requested);
  const foldedState = foldSubindustryPrecisionIntoSectorState(
    toSectorEvidenceState(sector.decision),
    precision,
  );
  const admission = resolveApolloSectorPostEnrichmentAdmission({
    postEnrichmentSectorState: foldedState,
    legacySectorPolicyPresent: sector.sectorPolicyPresent,
    candidateEnriched: input.candidateEnriched ?? true,
    requestedSubindustries: input.requested,
    precision,
    catalogAuthorization: input.authorization ?? AUTHORIZED,
  });
  return {
    precision,
    foldedState,
    legacySectorPolicyPresent: sector.sectorPolicyPresent,
    admission,
  };
}

// ─── § 1 · la causa raíz, reproducida ─────────────────────────────────────────

describe('§ 1 · ROOT CAUSE — el confirmed child ignorado', () => {
  test('sin este hito, una hija CONFIRMADA seguía terminando en `sector_not_mapped`', () => {
    const redHospitalaria = enrichedProfile('Red Hospitalaria del Norte', {
      industry: 'hospital & health care',
      keywords: ['red hospitalaria', 'grupo hospitalario'],
    });

    // La precisión SÍ confirma la hija pedida…
    const precision = assessApolloSubindustryPrecisionForRequest(redHospitalaria, [REDES]);
    assert.equal(precision.subindustryMatch, 'confirmed');
    const operational = projectOperationalSubindustryVerdict(precision);
    assert.equal(operational.subindustryMatch, 'confirmed');

    // …y el gate sectorial pagado dice `sector_not_mapped`, porque no hay política.
    const sector = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
      redHospitalaria,
      'Salud',
      [REDES],
      { sectorEvidenceBootstrap: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED },
    );
    assert.equal(sector.decision, 'sector_not_mapped');
    assert.equal(sector.sectorPolicyPresent, false);

    // El pliegue SÓLO degrada: la confirmación no rescata. Ésta es la línea exacta
    // que producía el rechazo terminal antes de este hito.
    const folded = foldSubindustryPrecisionIntoSectorState(
      toSectorEvidenceState(sector.decision),
      precision,
    );
    assert.equal(folded, 'sector_not_mapped');
    // Y `sector_not_mapped` NO es elegible: `isEligible` exige `sector_evidence_confirmed`.
    assert.notEqual(folded, 'sector_evidence_confirmed');
  });

  test('el pliegue conserva su invariante de sólo degradar — este hito no lo toca', () => {
    const redHospitalaria = enrichedProfile('Red Hospitalaria del Norte', {
      industry: 'hospital & health care',
      keywords: ['red hospitalaria'],
    });
    const precision = assessApolloSubindustryPrecisionForRequest(redHospitalaria, [REDES]);
    for (const base of [
      'sector_evidence_confirmed',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_contradictory',
      'sector_not_mapped',
    ] as const) {
      assert.equal(foldSubindustryPrecisionIntoSectorState(base, precision), base);
    }
  });
});

// ─── §§ 3, 12 · las fixtures de Salud de RUN 1 ────────────────────────────────

describe('§ 12 · Salud — las tres fixtures post-enrichment', () => {
  test('A · RED HOSPITALARIA · Redes confirma, Labs y EPS no ⇒ admisión PASS por Redes', () => {
    const candidate = enrichedProfile('Red Hospitalaria del Norte', {
      industry: 'hospital & health care',
      keywords: ['red hospitalaria', 'grupo hospitalario'],
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Salud',
      requested: [REDES, LABS, EPS],
    });

    // Sólo Redes confirma.
    const byLabel = new Map(
      chain.precision.perRequestedSubindustryEvaluations.map((e) => [
        e.requestedSubindustry,
        e.subindustryMatch,
      ]),
    );
    assert.equal(byLabel.get(REDES), 'confirmed');
    assert.notEqual(byLabel.get(LABS), 'confirmed');
    assert.notEqual(byLabel.get(EPS), 'confirmed');

    assert.equal(chain.foldedState, 'sector_not_mapped');
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, true);
    assert.equal(chain.admission.sectorEvidenceState, 'sector_evidence_confirmed');
    assert.equal(chain.admission.admissionSource, 'confirmed_requested_subindustry_precision');
    assert.equal(chain.admission.matchedRequestedSubindustry, REDES);
    assert.equal(chain.admission.blockReason, null);
    // § 21 — el estado previo no se pierde.
    assert.equal(chain.admission.postEnrichmentSectorState, 'sector_not_mapped');
  });

  test('B · LAB CLÍNICO · Labs confirma ⇒ admisión PASS', () => {
    const candidate = enrichedProfile('Laboratorio Clínico Andino', {
      industry: 'hospital & health care',
      keywords: ['laboratorio clinico', 'diagnostico medico'],
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Salud',
      requested: [REDES, LABS, EPS],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, true);
    assert.equal(chain.admission.matchedRequestedSubindustry, LABS);
  });

  test('C · EPS · la forma DESPLEGADA confirma ⇒ admisión PASS', () => {
    const candidate = enrichedProfile('Entidad Promotora de Salud del Valle', {
      industry: 'hospital & health care',
      keywords: ['entidad promotora de salud', 'medicina prepagada'],
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Salud',
      requested: [REDES, LABS, EPS],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, true);
    assert.equal(chain.admission.matchedRequestedSubindustry, EPS);
  });
});

// ─── § 13 · PARENT ONLY ───────────────────────────────────────────────────────

describe('§ 13 · sólo la industria PADRE nunca admite', () => {
  test('`hospital & health care` sin evidencia de hija ⇒ FAIL, sin writer por esta vía', () => {
    const candidate = enrichedProfile('Institución de Salud Genérica', {
      industry: 'hospital & health care',
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Salud',
      requested: [REDES, LABS, EPS],
    });

    for (const evaluation of chain.precision.perRequestedSubindustryEvaluations) {
      assert.notEqual(evaluation.subindustryMatch, 'confirmed');
    }
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(chain.admission.blockReason, 'no_confirmed_requested_subindustry');
    assert.equal(chain.admission.sectorEvidenceState, 'sector_not_mapped');
    assert.notEqual(chain.admission.sectorEvidenceState, 'sector_evidence_confirmed');
  });

  test('la implicación NO se invierte: pedir el padre jamás demuestra la hija', () => {
    // Pedir «Salud» con el candidato más vacío posible: el nombre de la industria
    // PEDIDA no es evidencia de nada.
    const chain = runPostEnrichmentChain({
      candidate: SEARCH_ONLY('Empresa Sin Clasificación'),
      sector: 'Salud',
      requested: [REDES],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
  });
});

// ─── § 14 · SIBLING SAFETY ────────────────────────────────────────────────────

describe('§ 14 · sólo admite una subindustria SOLICITADA', () => {
  const lab = enrichedProfile('Laboratorio Clínico Andino', {
    industry: 'hospital & health care',
    keywords: ['laboratorio clinico'],
  });

  test('Labs PEDIDA y confirmada ⇒ admisión, aunque Redes y EPS no confirmen', () => {
    const chain = runPostEnrichmentChain({
      candidate: lab,
      sector: 'Salud',
      requested: [REDES, LABS, EPS],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, true);
    assert.equal(chain.admission.matchedRequestedSubindustry, LABS);
  });

  test('el MISMO laboratorio con `requested = [Redes]` ⇒ NO admisión', () => {
    const chain = runPostEnrichmentChain({
      candidate: lab,
      sector: 'Salud',
      requested: [REDES],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(chain.admission.blockReason, 'no_confirmed_requested_subindustry');
    assert.equal(chain.admission.matchedRequestedSubindustry, null);
  });

  test('la etiqueta admitida SIEMPRE pertenece a la petición', () => {
    for (const requested of [[REDES], [LABS], [EPS], [REDES, LABS], [LABS, EPS, REDES]]) {
      const chain = runPostEnrichmentChain({ candidate: lab, sector: 'Salud', requested });
      const matched = chain.admission.matchedRequestedSubindustry;
      if (matched !== null) assert.ok(requested.includes(matched), `${matched} ∉ ${requested}`);
    }
  });
});

// ─── § 15 · el mecanismo es GENÉRICO ──────────────────────────────────────────

describe('§ 15 · Banca, Ciberseguridad y Educación con el mismo mecanismo', () => {
  test('BANCA · `banking` confirma ⇒ admisión PASS, sin hardcode de sector', () => {
    const candidate = enrichedProfile('Banco Regional', { industry: 'banking' });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Servicios Financieros',
      requested: [BANCA],
    });
    assert.equal(chain.legacySectorPolicyPresent, false);
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, true);
    assert.equal(chain.admission.matchedRequestedSubindustry, BANCA);
  });

  test('CIBERSEGURIDAD · `computer & network security` confirma ⇒ admisión PASS', () => {
    const candidate = enrichedProfile('SecureOps', {
      industry: 'computer & network security',
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Tecnología',
      requested: [CIBER],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, true);
    assert.equal(chain.admission.matchedRequestedSubindustry, CIBER);
  });

  test('EDUCACIÓN · la política legacy ya resuelve el sector ⇒ la vía nueva NO se activa', () => {
    const candidate = enrichedProfile('Universidad Privada del Norte', {
      industry: 'higher education',
      keywords: ['universidad privada'],
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Educación',
      requested: [UNIVERSIDADES],
    });
    // `educacion` SÍ está en SECTOR_SIGNAL_TERMS: la legacy manda.
    assert.equal(chain.legacySectorPolicyPresent, true);
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(chain.admission.blockReason, 'legacy_sector_policy_authoritative');
    assert.equal(chain.admission.admissionSource, 'legacy_sector_policy');
    // Y el estado resuelto es EXACTAMENTE el que la cadena legacy produjo.
    assert.equal(chain.admission.sectorEvidenceState, chain.foldedState);
  });

  test('el CÓDIGO del módulo no nombra ningún sector ni el catálogo legacy', () => {
    // El § 2 prohíbe resolver esto añadiendo sectores. La vía es genérica: el módulo
    // no puede mirar el nombre del sector padre ni consultar `SECTOR_SIGNAL_TERMS`.
    // Se comprueba sobre el CÓDIGO, no sobre la prosa: los comentarios sí explican
    // de qué catálogo se habla, y eso es documentación, no una dependencia.
    for (const forbidden of [
      'SECTOR_SIGNAL_TERMS',
      'salud',
      'banca',
      'tecnolog',
      'hospital',
      'health',
      'banking',
      'security',
    ]) {
      assert.ok(
        !new RegExp(forbidden, 'i').test(ADMISSION_MODULE_CODE),
        `el código del módulo nombra ${forbidden}`,
      );
    }
    // Y no importa el gate de relevancia sectorial en ningún punto.
    assert.ok(!/apollo-sector-relevance-gate/.test(ADMISSION_MODULE_CODE));
  });
});

// ─── § 16 · RETAIL ZERO DRIFT ─────────────────────────────────────────────────

describe('§ 16 · las políticas legacy conservan sus decisiones EXACTAS', () => {
  const RETAIL_FIXTURES: { why: string; candidate: WebSearchResult; requested: string[] }[] = [
    {
      why: 'supermercado real, industria amplia `retail`',
      candidate: enrichedProfile('Supermercados La Canasta', {
        industry: 'retail',
        keywords: ['supermercado', 'cadena de supermercados'],
      }),
      requested: [SUPERMERCADOS],
    },
    {
      why: 'Citigroup: `retail banking` contradice supermercados',
      candidate: enrichedProfile('Citigroup', { industry: 'retail banking' }),
      requested: [SUPERMERCADOS],
    },
    {
      why: 'tienda por departamento',
      candidate: enrichedProfile('Almacenes Éxito Moda', {
        industry: 'retail',
        keywords: ['tienda por departamento', 'moda'],
      }),
      requested: [DEPARTAMENTO],
    },
    {
      why: 'grocery genérico sin subindustria demostrada',
      candidate: enrichedProfile('Grocery App', { industry: 'retail', keywords: ['grocery'] }),
      requested: [SUPERMERCADOS],
    },
    {
      why: 'ANY-OF de las dos reglas `full`',
      candidate: enrichedProfile('Cadena Mixta', {
        industry: 'retail',
        keywords: ['supermercado'],
      }),
      requested: [SUPERMERCADOS, DEPARTAMENTO],
    },
  ];

  test('before/after: 0 diferencias de decisión en las fixtures de Retail', () => {
    for (const fixture of RETAIL_FIXTURES) {
      const chain = runPostEnrichmentChain({
        candidate: fixture.candidate,
        sector: 'Retail y Consumo',
        requested: fixture.requested,
      });
      assert.equal(chain.legacySectorPolicyPresent, true, fixture.why);
      // El estado DESPUÉS de la admisión es idéntico al de ANTES: la vía nueva no
      // tocó nada. Ésta es la aserción de deriva cero.
      assert.equal(chain.admission.sectorEvidenceState, chain.foldedState, fixture.why);
      assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false, fixture.why);
      assert.equal(chain.admission.admissionSource, 'legacy_sector_policy', fixture.why);
    }
  });

  test('una hija confirmada NO puede cambiar una decisión legacy ya definida', () => {
    // Supermercado confirmado por precisión, pero con industria declarada que el
    // gate legacy trata como CONTRADICTORIA. Antes de este hito el resultado era
    // `sector_evidence_contradictory`; tiene que seguir siéndolo.
    const candidate = enrichedProfile('Banco con línea de mercado', {
      industry: 'retail banking',
      keywords: ['supermercado'],
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Supermercados e Hipermercados',
      requested: [SUPERMERCADOS],
    });
    assert.equal(chain.admission.sectorEvidenceState, chain.foldedState);
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
  });
});

// ─── §§ 5, 6 · semántica de `confirm_only` y de `full` ────────────────────────

describe('§ 5/§ 6 · confirm_only positivo contribuye; sus ramas negativas ABSTIENEN', () => {
  test('confirm_only CONFIRMED ⇒ satisface la vía nueva', () => {
    const chain = runPostEnrichmentChain({
      candidate: enrichedProfile('Clínica Privada Andina', {
        industry: 'hospital & health care',
        keywords: ['clinica privada'],
      }),
      sector: 'Salud',
      requested: [REDES],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, true);
  });

  test('confirm_only AMBIGUOUS ⇒ ABSTIENE: ni admisión ni rechazo adicional', () => {
    const candidate = enrichedProfile('Prestador de Salud', {
      industry: 'hospital & health care',
    });
    const chain = runPostEnrichmentChain({ candidate, sector: 'Salud', requested: [REDES] });
    const evaluation = chain.precision.perRequestedSubindustryEvaluations[0]!;
    assert.notEqual(evaluation.subindustryMatch, 'confirmed');
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    // No añade rechazo: el estado sale EXACTAMENTE como entró.
    assert.equal(chain.admission.sectorEvidenceState, chain.foldedState);
    assert.notEqual(chain.admission.sectorEvidenceState, 'sector_evidence_contradictory');
  });

  test('confirm_only REJECTED ⇒ ABSTIENE: sin admisión y sin rechazo adicional', () => {
    // Modelo de negocio excluido por la regla de Redes: hospital público.
    const candidate = enrichedProfile('Hospital Público Municipal', {
      industry: 'hospital & health care',
      keywords: ['red hospitalaria', 'hospital publico', 'secretaria de salud'],
    });
    const chain = runPostEnrichmentChain({ candidate, sector: 'Salud', requested: [REDES] });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(chain.admission.sectorEvidenceState, chain.foldedState);
  });

  test('una `confirm_only` negativa deja el resultado como si no se hubiera pedido', () => {
    const lab = enrichedProfile('Laboratorio Clínico Andino', {
      industry: 'hospital & health care',
      keywords: ['laboratorio clinico'],
    });
    const alone = runPostEnrichmentChain({ candidate: lab, sector: 'Salud', requested: [LABS] });
    const withNegatives = runPostEnrichmentChain({
      candidate: lab,
      sector: 'Salud',
      requested: [LABS, REDES, EPS],
    });
    assert.equal(
      withNegatives.admission.sectorEvidenceState,
      alone.admission.sectorEvidenceState,
    );
    assert.equal(
      withNegatives.admission.admittedByRequestedSubindustryPrecision,
      alone.admission.admittedByRequestedSubindustryPrecision,
    );
    assert.equal(withNegatives.admission.matchedRequestedSubindustry, LABS);
  });

  test('la ADMISIÓN no depende del modo de la regla que confirmó', () => {
    // Con reglas sintéticas, porque las dos `full` de producción tienen ADEMÁS
    // política legacy de sector y nunca llegan a esta vía. `confirmed` es
    // `confirmed`: el modo es diagnóstico y no puede decidir la admisión.
    const admit = (label: string, anchor: string): boolean =>
      resolveApolloSectorPostEnrichmentAdmission({
        postEnrichmentSectorState: 'sector_not_mapped',
        legacySectorPolicyPresent: false,
        candidateEnriched: true,
        requestedSubindustries: [label],
        precision: assessApolloSubindustryPrecisionForRequest(
          enrichedProfile('Empresa', { keywords: [anchor] }),
          [label],
          SYNTHETIC_OPTIONS,
        ),
        catalogAuthorization: AUTHORIZED,
        precisionOptions: SYNTHETIC_OPTIONS,
      }).admittedByRequestedSubindustryPrecision;

    assert.equal(admit(ALFA, 'ancla alfa'), true, 'regla `full` confirmada');
    assert.equal(admit(BETA, 'ancla beta'), true, 'regla `confirm_only` confirmada');
  });

  test('una regla `full` que RECHAZA sí degrada — el pliegue, no esta vía', () => {
    // La asimetría del § 6: en `full` las ramas negativas siguen decidiendo, y lo
    // hacen ANTES de llegar aquí. El estado ya no es `sector_not_mapped`.
    const precision = assessApolloSubindustryPrecisionForRequest(
      enrichedProfile('Empresa', { keywords: ['excluyente alfa'] }),
      [ALFA],
      SYNTHETIC_OPTIONS,
    );
    const folded = foldSubindustryPrecisionIntoSectorState(
      'sector_not_mapped',
      precision,
      SYNTHETIC_OPTIONS,
    );
    assert.equal(folded, 'sector_evidence_contradictory');
    const admission = resolveApolloSectorPostEnrichmentAdmission({
      postEnrichmentSectorState: folded,
      legacySectorPolicyPresent: false,
      candidateEnriched: true,
      requestedSubindustries: [ALFA],
      precision,
      catalogAuthorization: AUTHORIZED,
      precisionOptions: SYNTHETIC_OPTIONS,
    });
    assert.equal(admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(admission.sectorEvidenceState, 'sector_evidence_contradictory');
  });
});

// ─── §§ 10, 11 · alcance declarado ────────────────────────────────────────────

describe('§ 10/§ 11 · sin subindustria pedida y con hija sin regla', () => {
  test('§ 10 · `requested = []` ⇒ la vía NO aplica, comportamiento existente', () => {
    const chain = runPostEnrichmentChain({
      candidate: enrichedProfile('Red Hospitalaria del Norte', {
        industry: 'hospital & health care',
        keywords: ['red hospitalaria'],
      }),
      sector: 'Salud',
      requested: [],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(chain.admission.blockReason, 'no_requested_subindustries');
    assert.equal(chain.admission.sectorEvidenceState, chain.foldedState);
  });

  test('§ 11 · hija SIN regla de precisión ⇒ `unmapped`, sin admisión (fail-closed)', () => {
    const chain = runPostEnrichmentChain({
      // Evidencia abundante y perfectamente alineada con la etiqueta pedida…
      candidate: enrichedProfile('Aseguradora de Riesgos Laborales', {
        industry: 'insurance',
        keywords: ['riesgos laborales', 'arl'],
      }),
      sector: 'Salud',
      // …pero la subindustria no tiene regla de precisión registrada.
      requested: ['Administradoras de Riesgos Laborales'],
    });
    assert.equal(chain.precision.subindustryMapped, false);
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(chain.admission.blockReason, 'no_confirmed_requested_subindustry');
  });

  test('§ 23 · la cobertura de BÚSQUEDA no sustituye a la precisión', () => {
    // El payload de `search` de RUN 1: cero campos clasificatorios. La consulta sí
    // cubría las tres subindustrias, y eso no admite a nadie.
    const chain = runPostEnrichmentChain({
      candidate: SEARCH_ONLY('Organización de RUN 1'),
      sector: 'Salud',
      requested: [REDES, LABS, EPS],
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
  });
});

// ─── § 8 · identidad y versión del catálogo ───────────────────────────────────

describe('§ 8 · catálogo incoherente ⇒ fail-closed', () => {
  const candidate = enrichedProfile('Red Hospitalaria del Norte', {
    industry: 'hospital & health care',
    keywords: ['red hospitalaria'],
  });

  const INCOHERENT: {
    why: string;
    authorization: ApolloSectorEvidenceBootstrapAuthorization;
  }[] = [
    {
      why: 'versión de catálogo incoherente',
      authorization: evaluateApolloSectorEvidenceBootstrapAuthorization({
        providerSearchExecuted: true,
        queryCoverageComplete: true,
        catalogVersionCoherent: false,
        catalogTermsResolved: true,
      }),
    },
    {
      why: 'criterios no resueltos contra el catálogo activo',
      authorization: evaluateApolloSectorEvidenceBootstrapAuthorization({
        providerSearchExecuted: true,
        queryCoverageComplete: true,
        catalogVersionCoherent: true,
        catalogTermsResolved: false,
      }),
    },
    {
      why: 'cobertura de consulta incompleta',
      authorization: evaluateApolloSectorEvidenceBootstrapAuthorization({
        providerSearchExecuted: true,
        queryCoverageComplete: false,
        catalogVersionCoherent: true,
        catalogTermsResolved: true,
      }),
    },
    {
      why: 'ninguna precondición evaluada (el fail-closed por defecto)',
      authorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
    },
  ];

  for (const { why, authorization } of INCOHERENT) {
    test(`${why} ⇒ NO admisión aunque la hija confirme`, () => {
      const chain = runPostEnrichmentChain({
        candidate,
        sector: 'Salud',
        requested: [REDES],
        authorization,
      });
      assert.equal(chain.precision.subindustryMatch, 'confirmed');
      assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
      assert.equal(chain.admission.blockReason, 'catalog_criteria_unauthorized');
    });
  }
});

// ─── § 9 · precedencia ────────────────────────────────────────────────────────

describe('§ 9 · precedencia de admisión', () => {
  test('la legacy autoritativa se comprueba ANTES que todo lo demás', () => {
    // Todo lo demás fallaría (sin enriquecer, sin subindustrias, sin autorización) y
    // el motivo reportado sigue siendo el de la legacy: es el primer escalón.
    const admission = resolveApolloSectorPostEnrichmentAdmission({
      postEnrichmentSectorState: 'sector_not_mapped',
      legacySectorPolicyPresent: true,
      candidateEnriched: false,
      requestedSubindustries: [],
      precision: assessApolloSubindustryPrecisionForRequest(SEARCH_ONLY('X'), []),
      catalogAuthorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
    });
    assert.equal(admission.blockReason, 'legacy_sector_policy_authoritative');
  });

  test('un estado ya MEDIDO no se rescata — ni confirmado, ni contradicho, ni pendiente', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(
      enrichedProfile('Red Hospitalaria', {
        industry: 'hospital & health care',
        keywords: ['red hospitalaria'],
      }),
      [REDES],
    );
    const measured: CandidateSectorEvidenceState[] = [
      'sector_evidence_confirmed',
      'sector_evidence_contradictory',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_missing_bootstrap_eligible',
    ];
    for (const state of measured) {
      const admission = resolveApolloSectorPostEnrichmentAdmission({
        postEnrichmentSectorState: state,
        legacySectorPolicyPresent: false,
        candidateEnriched: true,
        requestedSubindustries: [REDES],
        precision,
        catalogAuthorization: AUTHORIZED,
      });
      assert.equal(admission.sectorEvidenceState, state, state);
      assert.equal(admission.blockReason, 'sector_state_not_unmapped', state);
    }
  });

  test('sin enrichment REAL no hay admisión, por confirmada que esté la hija', () => {
    const chain = runPostEnrichmentChain({
      candidate: enrichedProfile('Red Hospitalaria del Norte', {
        industry: 'hospital & health care',
        keywords: ['red hospitalaria'],
      }),
      sector: 'Salud',
      requested: [REDES],
      candidateEnriched: false,
    });
    assert.equal(chain.admission.admittedByRequestedSubindustryPrecision, false);
    assert.equal(chain.admission.blockReason, 'candidate_not_enriched');
  });

  test('la vía nueva NO puede rescatar ningún bloqueo duro previo', () => {
    // Los bloqueos duros —país, duplicado, plataforma externa, cooldown, ownership—
    // no viajan en `postEnrichmentSectorState` y la firma no los recibe: el módulo
    // no tiene forma de tocarlos. El ratchet lo fija sobre el código fuente.
    const source = readFileSync(
      new URL('../apollo-sector-post-enrichment-admission.ts', import.meta.url),
      'utf8',
    );
    for (const hardBlock of [
      'country_mismatch',
      'duplicate_in_sellup',
      'duplicate_in_hubspot',
      'external_platform_domain',
      'cooldown',
      'ownership_mismatch',
    ]) {
      assert.ok(
        !new RegExp(`\\b${hardBlock}\\b`).test(source.replace(/^\s*\*.*$/gm, '')),
        `el módulo manipula ${hardBlock}`,
      );
    }
  });
});

// ─── § 18 · el contrato de objetivo NO cambia ─────────────────────────────────

describe('§ 18 · admisión ≠ contar hacia el objetivo', () => {
  test('cruzar el gate sectorial no basta: el contrato de subindustria decide aparte', () => {
    const candidate = enrichedProfile('Red Hospitalaria del Norte', {
      industry: 'hospital & health care',
      keywords: ['red hospitalaria'],
    });
    const chain = runPostEnrichmentChain({
      candidate,
      sector: 'Salud',
      requested: [REDES],
    });
    assert.equal(chain.admission.sectorEvidenceState, 'sector_evidence_confirmed');

    // El contrato de completitud sigue leyendo la PRECISIÓN, no el estado sectorial.
    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: chain.admission.sectorEvidenceState,
      requestedSubindustries: [REDES],
      subindustryPrecision: chain.precision,
    });
    assert.equal(requirement.subindustryMatch, 'confirmed');
    assert.equal(requirement.eligibilityVerdict, 'confirmed');

    // Y aun así NO cuenta mientras falten las demás condiciones del contrato.
    const withoutFields = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: false,
      sectorEvidenceState: chain.admission.sectorEvidenceState,
      requestedSubindustries: [REDES],
      subindustryPrecision: chain.precision,
      employeeCountStatus: 'not_returned',
      linkedinStatus: 'not_returned',
      duplicateStatus: null,
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(withoutFields.countsTowardTarget, false);
    assert.equal(withoutFields.eligibleForTarget, false);
  });

  test('un candidato admitido pero AMBIGUO en su subindustria pedida no cuenta', () => {
    // El estado sectorial dice `sector_evidence_confirmed` —lo dejaría pasar el gate—
    // y la precisión sobre la subindustria pedida es ambigua. El contrato manda.
    const lab = enrichedProfile('Laboratorio Clínico Andino', {
      industry: 'hospital & health care',
      keywords: ['laboratorio clinico'],
    });
    const onlyRedes = assessApolloSubindustryPrecisionForRequest(lab, [REDES]);
    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REDES],
      subindustryPrecision: onlyRedes,
    });
    assert.notEqual(requirement.subindustryMatch, 'confirmed');
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
  });
});

// ─── § 20 · observabilidad ────────────────────────────────────────────────────

describe('§ 20 · la traza de por qué cruzó', () => {
  test('el registro nombra la fuente, la hija y el veredicto operativo', () => {
    const chain = runPostEnrichmentChain({
      candidate: enrichedProfile('Entidad Promotora de Salud del Valle', {
        industry: 'hospital & health care',
        keywords: ['entidad promotora de salud'],
      }),
      sector: 'Salud',
      requested: [REDES, EPS],
    });

    assert.equal(chain.admission.admissionSource, 'confirmed_requested_subindustry_precision');
    assert.equal(chain.admission.matchedRequestedSubindustry, EPS);
    assert.equal(chain.admission.postEnrichmentSectorState, 'sector_not_mapped');

    const metadata = toOperationalConfirmedRequestedSubindustryMetadata(
      chain.admission.operationalConfirmation,
    );
    assert.deepEqual(metadata, { requested_subindustry: EPS, precision_mode: 'confirm_only' });
  });

  test('sin confirmación no se inventa registro operativo', () => {
    const chain = runPostEnrichmentChain({
      candidate: enrichedProfile('Prestador Genérico', { industry: 'hospital & health care' }),
      sector: 'Salud',
      requested: [REDES],
    });
    assert.equal(chain.admission.operationalConfirmation, null);
    assert.equal(toOperationalConfirmedRequestedSubindustryMetadata(null), null);
  });

  test('la versión del módulo viaja como código estático', () => {
    assert.equal(APOLLO_SECTOR_POST_ENRICHMENT_ADMISSION_VERSION, 'v1.SPEA-1');
  });
});

// ─── El resolutor de la hija confirmada ───────────────────────────────────────

describe('resolveOperationalConfirmedRequestedSubindustry', () => {
  test('devuelve la PRIMERA confirmada en el orden pedido; la existencia es invariante', () => {
    // Candidato que confirma DOS hijas a la vez. Con reglas sintéticas de
    // vocabulario disjunto: las hermanas de Salud se declaran en conflicto entre sí
    // a propósito, así que en producción una sola empresa no confirma dos.
    const both = enrichedProfile('Empresa Alfa y Beta', {
      keywords: ['ancla alfa', 'ancla beta'],
    });
    const ab = resolveOperationalConfirmedRequestedSubindustry(
      assessApolloSubindustryPrecisionForRequest(both, [ALFA, BETA], SYNTHETIC_OPTIONS),
      SYNTHETIC_OPTIONS,
    );
    const ba = resolveOperationalConfirmedRequestedSubindustry(
      assessApolloSubindustryPrecisionForRequest(both, [BETA, ALFA], SYNTHETIC_OPTIONS),
      SYNTHETIC_OPTIONS,
    );
    // La EXISTENCIA —lo único que decide— no depende del orden…
    assert.ok(ab !== null && ba !== null);
    // …y la etiqueta reportada es la primera pedida, que es diagnóstico.
    assert.equal(ab.requestedSubindustry, ALFA);
    assert.equal(ba.requestedSubindustry, BETA);
  });

  test('la ADMISIÓN es invariante al orden aunque la etiqueta reportada cambie', () => {
    const both = enrichedProfile('Empresa Alfa y Beta', {
      keywords: ['ancla alfa', 'ancla beta'],
    });
    const admit = (requested: string[]) =>
      resolveApolloSectorPostEnrichmentAdmission({
        postEnrichmentSectorState: 'sector_not_mapped',
        legacySectorPolicyPresent: false,
        candidateEnriched: true,
        requestedSubindustries: requested,
        precision: assessApolloSubindustryPrecisionForRequest(
          both,
          requested,
          SYNTHETIC_OPTIONS,
        ),
        catalogAuthorization: AUTHORIZED,
        precisionOptions: SYNTHETIC_OPTIONS,
      });
    assert.equal(admit([ALFA, BETA]).sectorEvidenceState, 'sector_evidence_confirmed');
    assert.equal(admit([BETA, ALFA]).sectorEvidenceState, 'sector_evidence_confirmed');
  });

  test('sin evaluaciones por subindustria devuelve `null` (fail-closed)', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(SEARCH_ONLY('X'), []);
    assert.equal(precision.perRequestedSubindustryEvaluations.length, 0);
    assert.equal(resolveOperationalConfirmedRequestedSubindustry(precision), null);
  });

  test('coincide con `projectOperationalSubindustryVerdict` sobre toda la matriz', () => {
    const candidates: WebSearchResult[] = [
      SEARCH_ONLY('vacío'),
      enrichedProfile('padre', { industry: 'hospital & health care' }),
      enrichedProfile('redes', {
        industry: 'hospital & health care',
        keywords: ['red hospitalaria'],
      }),
      enrichedProfile('labs', {
        industry: 'hospital & health care',
        keywords: ['laboratorio clinico'],
      }),
      enrichedProfile('eps', {
        industry: 'hospital & health care',
        keywords: ['entidad promotora de salud'],
      }),
      enrichedProfile('publico', {
        industry: 'hospital & health care',
        keywords: ['red hospitalaria', 'hospital publico'],
      }),
      enrichedProfile('banca', { industry: 'banking' }),
      enrichedProfile('super', { industry: 'retail', keywords: ['supermercado'] }),
    ];
    const requests = [[REDES], [LABS], [EPS], [BANCA], [SUPERMERCADOS], [REDES, LABS, EPS]];

    for (const candidate of candidates) {
      for (const requested of requests) {
        const precision = assessApolloSubindustryPrecisionForRequest(candidate, requested);
        const operational = projectOperationalSubindustryVerdict(precision);
        const confirms =
          operational.subindustryMapped && operational.subindustryMatch === 'confirmed';
        const resolved = resolveOperationalConfirmedRequestedSubindustry(precision);
        assert.equal(resolved !== null, confirms, `${candidate.title} × ${requested}`);
        if (resolved !== null) {
          assert.ok(requested.includes(resolved.requestedSubindustry));
        }
      }
    }
  });
});

// ─── § 24 · `sector_not_mapped` sigue existiendo ──────────────────────────────

describe('§ 24 · el estado `sector_not_mapped` NO desaparece', () => {
  test('sigue siendo el desenlace en todos los casos que no cambia este hito', () => {
    const cases: { why: string; input: ApolloSectorPostEnrichmentAdmissionInput }[] = [];
    const precisionConfirmed = assessApolloSubindustryPrecisionForRequest(
      enrichedProfile('Red Hospitalaria', {
        industry: 'hospital & health care',
        keywords: ['red hospitalaria'],
      }),
      [REDES],
    );
    const precisionAmbiguous = assessApolloSubindustryPrecisionForRequest(
      enrichedProfile('Prestador', { industry: 'hospital & health care' }),
      [REDES],
    );
    const base = {
      postEnrichmentSectorState: 'sector_not_mapped' as const,
      legacySectorPolicyPresent: false,
      candidateEnriched: true,
      requestedSubindustries: [REDES],
      precision: precisionConfirmed,
      catalogAuthorization: AUTHORIZED,
    };
    cases.push({ why: 'hija pedida no confirmada', input: { ...base, precision: precisionAmbiguous } });
    cases.push({ why: 'catálogo incoherente', input: { ...base, catalogAuthorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED } });
    cases.push({ why: 'sin enrichment', input: { ...base, candidateEnriched: false } });
    cases.push({ why: 'sin subindustrias pedidas', input: { ...base, requestedSubindustries: [] } });

    for (const { why, input } of cases) {
      const admission = resolveApolloSectorPostEnrichmentAdmission(input);
      assert.equal(admission.sectorEvidenceState, 'sector_not_mapped', why);
      assert.equal(admission.admittedByRequestedSubindustryPrecision, false, why);
    }
  });
});