/**
 * agent1-macro-industry-evidence-admission-1.test.ts — Evidencia macro,
 * admisión posterior al enrichment y las fixtures de las 12 Macro Industrias.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 9, 10, 11, 12, 13, 17, 24 y 25.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessMacroIndustryEvidence,
  toMacroIndustryEvidenceMetadata,
} from '../apollo-macro-industry-evidence';
import { resolveApolloSectorPostEnrichmentAdmission } from '../apollo-sector-post-enrichment-admission';
import {
  evaluateApolloSectorEvidenceBootstrapAuthorization,
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
} from '../apollo-sector-evidence-bootstrap';
import {
  macroIndustryBootstrapPreconditions,
  resolveApolloMacroIndustryRequest,
} from '../apollo-macro-industry-request';
import { assessApolloSubindustryPrecisionForRequest } from '../apollo-subindustry-precision';
import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import type { WebSearchResult } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Un resultado Apollo YA ENRIQUECIDO. El nombre y el dominio se rellenan pero
 * NUNCA son evidencia: las pruebas de abajo lo comprueban explícitamente.
 */
function apolloResult(input: {
  name: string;
  industry?: string | null;
  keywords?: string[];
  description?: string | null;
}): WebSearchResult {
  return {
    title: input.name,
    url: `https://${input.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      domain: `${input.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      apollo_profile: {
        ...(input.industry !== undefined ? { industry: input.industry } : {}),
        ...(input.keywords ? { keywords: input.keywords } : {}),
        ...(input.description !== undefined ? { short_description: input.description } : {}),
      },
    },
  };
}

/** Un candidato positivo y uno negativo por cada macro industria (§ 17). */
const FIXTURES: Record<
  string,
  { positive: WebSearchResult; negatives: WebSearchResult[] }
> = {
  transport_logistics: {
    positive: apolloResult({
      name: 'Operador Andino',
      industry: 'logistics and supply chain',
      keywords: ['operador logistico', 'transporte de carga'],
    }),
    negatives: [
      apolloResult({ name: 'Banco Central SA', industry: 'banking' }),
      apolloResult({ name: 'Minera del Norte', industry: 'mining & metals' }),
    ],
  },
  technology: {
    positive: apolloResult({
      name: 'Nube Latam',
      industry: 'computer software',
      keywords: ['saas', 'cloud computing'],
    }),
    negatives: [
      apolloResult({ name: 'Clinica San Juan', industry: 'hospital & health care' }),
      apolloResult({ name: 'Constructora Vial', industry: 'construction' }),
    ],
  },
  insurance_financial_services: {
    positive: apolloResult({
      name: 'Seguros Bolivar',
      industry: 'insurance',
      keywords: ['seguros generales', 'seguros de vida'],
    }),
    negatives: [
      apolloResult({ name: 'Softlab', industry: 'computer software' }),
      apolloResult({ name: 'Almacenes Exito', industry: 'retail' }),
    ],
  },
  health_pharma: {
    positive: apolloResult({
      name: 'Clinica del Country',
      industry: 'hospital & health care',
      keywords: ['clinica', 'red hospitalaria'],
    }),
    negatives: [
      apolloResult({ name: 'Consultora Global', industry: 'management consulting' }),
      apolloResult({ name: 'Tabacalera del Sur', industry: 'tobacco' }),
      apolloResult({ name: 'Transportes Rapidos', industry: 'logistics and supply chain' }),
      apolloResult({ name: 'Alimentos del Valle', industry: 'food production' }),
      apolloResult({ name: 'Banco Popular', industry: 'banking' }),
    ],
  },
  retail: {
    positive: apolloResult({
      name: 'Supermercados La Cesta',
      industry: 'retail',
      keywords: ['supermercado', 'cadena de tiendas'],
    }),
    negatives: [
      // El caso Citigroup: `retail banking` CONTIENE `retail`.
      apolloResult({ name: 'Citigroup', industry: 'retail banking' }),
      apolloResult({ name: 'Laboratorios Pharma', industry: 'pharmaceuticals' }),
    ],
  },
  property_construction: {
    positive: apolloResult({
      name: 'Constructora Bolivar',
      industry: 'construction',
      keywords: ['obra civil', 'constructora'],
    }),
    negatives: [
      apolloResult({ name: 'Seguros del Norte', industry: 'insurance' }),
      apolloResult({ name: 'Petrolera Andina', industry: 'oil & energy' }),
    ],
  },
  industry_manufacturing_chemicals_automotive: {
    positive: apolloResult({
      name: 'Metalmecanica Sur',
      industry: 'mechanical or industrial engineering',
      keywords: ['metalmecanica', 'autopartes'],
    }),
    negatives: [
      apolloResult({ name: 'Consultora Global', industry: 'management consulting' }),
      apolloResult({ name: 'Clinica Norte', industry: 'hospital & health care' }),
    ],
  },
  government: {
    positive: apolloResult({
      name: 'Alcaldia de Medellin',
      industry: 'government administration',
      keywords: ['alcaldia', 'administracion publica'],
    }),
    negatives: [
      apolloResult({ name: 'Softlab', industry: 'computer software' }),
      apolloResult({ name: 'Seguros del Norte', industry: 'insurance' }),
    ],
  },
  energy_mining_environment: {
    positive: apolloResult({
      name: 'Ecopetrol',
      industry: 'oil & energy',
      keywords: ['petroleo', 'refineria'],
    }),
    negatives: [
      apolloResult({ name: 'Banco Popular', industry: 'banking' }),
      apolloResult({ name: 'Almacenes Exito', industry: 'retail' }),
    ],
  },
  consumer_goods: {
    positive: apolloResult({
      name: 'Alimentos del Valle',
      industry: 'food production',
      keywords: ['fabricante de alimentos', 'consumo masivo'],
    }),
    negatives: [
      // La frontera con Retail: el punto de venta NO es consumo masivo.
      apolloResult({ name: 'Supermercados La Cesta', industry: 'retail' }),
      apolloResult({ name: 'Softlab', industry: 'computer software' }),
    ],
  },
  services_company: {
    positive: apolloResult({
      name: 'BPO Andino',
      industry: 'outsourcing/offshoring',
      keywords: ['contact center', 'business process outsourcing'],
    }),
    negatives: [
      apolloResult({ name: 'Clinica Norte', industry: 'hospital & health care' }),
      apolloResult({ name: 'Petrolera Andina', industry: 'oil & energy' }),
    ],
  },
  agroindustry: {
    positive: apolloResult({
      name: 'Ingenio Manuelita',
      industry: 'farming',
      keywords: ['ingenio azucarero', 'agroindustria'],
    }),
    negatives: [
      apolloResult({ name: 'Supermercados La Cesta', industry: 'retail' }),
      apolloResult({ name: 'Banco Popular', industry: 'banking' }),
    ],
  },
};

// ─── § 10 — el modelo de evidencia ────────────────────────────────────────────

describe('§ 10 — MacroIndustryEvidence', () => {
  it('confirma con evidencia declarada por el proveedor, para las 12', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const fixture = FIXTURES[definition.key];
      assert.ok(fixture, `falta fixture para ${definition.key}`);
      const assessment = assessMacroIndustryEvidence({
        result: fixture.positive,
        macroIndustryKey: definition.key,
      });
      assert.equal(assessment.verdict, 'confirmed', definition.key);
      assert.ok(assessment.matchedConfirmingTerms.length > 0, definition.key);
    }
  });

  it('NO confirma a los negativos de ninguna de las 12', () => {
    for (const definition of MACRO_INDUSTRIES) {
      for (const negative of FIXTURES[definition.key].negatives) {
        const assessment = assessMacroIndustryEvidence({
          result: negative,
          macroIndustryKey: definition.key,
        });
        assert.notEqual(
          assessment.verdict,
          'confirmed',
          `${definition.key} ← ${negative.title}`,
        );
      }
    }
  });

  it('§ 16 — distingue los cinco negativos de Salud & Farmacéuticos', () => {
    for (const negative of FIXTURES.health_pharma.negatives) {
      const assessment = assessMacroIndustryEvidence({
        result: negative,
        macroIndustryKey: 'health_pharma',
      });
      assert.equal(assessment.verdict, 'rejected', negative.title);
      assert.equal(assessment.reason, 'excluding_industry_declared');
    }
  });

  it('la exclusión gana a la confirmación por precedencia de substring', () => {
    // Citigroup declara `retail banking`, que contiene `retail`. Sin la
    // precedencia, entraría en una búsqueda de Retail.
    const assessment = assessMacroIndustryEvidence({
      result: apolloResult({ name: 'Citigroup', industry: 'retail banking' }),
      macroIndustryKey: 'retail',
    });
    assert.equal(assessment.verdict, 'rejected');
    assert.deepEqual(assessment.matchedConfirmingTerms, []);
  });

  it('la industria PADRE sola es ambigua, nunca confirmación', () => {
    const assessment = assessMacroIndustryEvidence({
      result: apolloResult({ name: 'Grupo XYZ', industry: 'consumer services' }),
      macroIndustryKey: 'retail',
    });
    assert.equal(assessment.verdict, 'ambiguous');
    assert.equal(assessment.reason, 'parent_industry_only');
  });

  it('sin evidencia del proveedor es ambigua, nunca confirmación', () => {
    const bare: WebSearchResult = {
      title: 'Clinica Sin Perfil',
      url: 'https://clinicasinperfil.com',
      rank: 1,
      provider: 'apollo_organizations',
      metadata: { domain: 'clinicasinperfil.com' },
    };
    const assessment = assessMacroIndustryEvidence({
      result: bare,
      macroIndustryKey: 'health_pharma',
    });
    assert.equal(assessment.verdict, 'ambiguous');
    assert.equal(assessment.reason, 'no_provider_evidence');
  });

  it('el NOMBRE de la empresa no es evidencia', () => {
    // «Clínica» en el nombre, y nada declarado. Si el nombre contara, esto
    // confirmaría; y entonces confirmaría también cualquier empresa que se
    // llamara así sin serlo.
    const assessment = assessMacroIndustryEvidence({
      result: {
        title: 'Clinica Hospital Farmaceutica SAS',
        url: 'https://clinica-hospital-farmaceutica.com',
        snippet: 'clinica hospital laboratorio farmaceutico',
        rank: 1,
        provider: 'apollo_organizations',
        metadata: { domain: 'clinica-hospital-farmaceutica.com' },
      },
      macroIndustryKey: 'health_pharma',
    });
    assert.notEqual(assessment.verdict, 'confirmed');
  });

  it('la macro industria PEDIDA por sí sola no confirma nada', () => {
    // No hay ninguna entrada por la que la intención pueda llegar al veredicto:
    // la función recibe el candidato y la definición, y sólo lee del candidato.
    const assessment = assessMacroIndustryEvidence({
      result: apolloResult({ name: 'Empresa Anonima', industry: null, keywords: [] }),
      macroIndustryDisplayName: 'Salud & Farmacéuticos',
    });
    assert.notEqual(assessment.verdict, 'confirmed');
  });

  it('una macro industria irresoluble falla CERRADO', () => {
    const assessment = assessMacroIndustryEvidence({
      result: FIXTURES.health_pharma.positive,
      macroIndustryKey: 'no_such_macro_industry',
    });
    assert.equal(assessment.verdict, 'ambiguous');
    assert.equal(assessment.reason, 'macro_industry_unresolved');
    assert.equal(assessment.macroIndustryKey, null);
  });

  it('proyecta metadata plana sin nombres de empresa', () => {
    const metadata = toMacroIndustryEvidenceMetadata(
      assessMacroIndustryEvidence({
        result: FIXTURES.retail.positive,
        macroIndustryKey: 'retail',
      }),
    );
    assert.equal(metadata.macro_industry_evidence_verdict, 'confirmed');
    assert.equal(metadata.macro_industry_key, 'retail');
    assert.ok(!JSON.stringify(metadata).includes('Supermercados La Cesta'));
  });
});

// ─── § 24 — separación de planos ──────────────────────────────────────────────

describe('§ 24 — evidencia macro ≠ precisión de subindustria', () => {
  it('la precisión de subindustria no se consulta en el plano macro', () => {
    // Un candidato de Salud sin NINGUNA subindustria pedida: la precisión no
    // tiene nada que decir, y sin embargo la evidencia macro sí confirma.
    const precision = assessApolloSubindustryPrecisionForRequest(
      FIXTURES.health_pharma.positive,
      [],
    );
    const macro = assessMacroIndustryEvidence({
      result: FIXTURES.health_pharma.positive,
      macroIndustryKey: 'health_pharma',
    });
    assert.equal(macro.verdict, 'confirmed');
    // La precisión sigue siendo lo que siempre fue para una petición vacía.
    assert.ok(precision !== null);
  });
});

// ─── §§ 9/12/13 — admisión ────────────────────────────────────────────────────

const AUTHORIZED = evaluateApolloSectorEvidenceBootstrapAuthorization({
  providerSearchExecuted: true,
  queryCoverageComplete: true,
  catalogVersionCoherent: true,
  catalogTermsResolved: true,
});

function macroAdmissionInput(overrides: Record<string, unknown> = {}) {
  return {
    postEnrichmentSectorState: 'sector_not_mapped' as const,
    legacySectorPolicyPresent: false,
    candidateEnriched: true,
    requestedSubindustries: [] as string[],
    precision: assessApolloSubindustryPrecisionForRequest(
      FIXTURES.health_pharma.positive,
      [],
    ),
    catalogAuthorization: AUTHORIZED,
    taxonomyMode: 'macro_industry' as const,
    macroIndustryEvidence: assessMacroIndustryEvidence({
      result: FIXTURES.health_pharma.positive,
      macroIndustryKey: 'health_pharma',
    }),
    ...overrides,
  };
}

describe('§ 12 — admisión por evidencia macro', () => {
  it('CONFIRMADA ⇒ pasa el gate sectorial', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(macroAdmissionInput());
    assert.equal(result.sectorEvidenceState, 'sector_evidence_confirmed');
    assert.equal(result.admissionSource, 'confirmed_macro_industry_evidence');
    assert.equal(result.blockReason, null);
    // La vía macro NO es la vía de subindustria.
    assert.equal(result.admittedByRequestedSubindustryPrecision, false);
    assert.equal(result.matchedRequestedSubindustry, null);
  });

  it('AMBIGUA ⇒ no hay admisión automática', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(
      macroAdmissionInput({
        macroIndustryEvidence: assessMacroIndustryEvidence({
          result: apolloResult({ name: 'Grupo XYZ', industry: 'wellness' }),
          macroIndustryKey: 'health_pharma',
        }),
      }),
    );
    assert.equal(result.sectorEvidenceState, 'sector_not_mapped');
    assert.equal(result.blockReason, 'macro_industry_evidence_not_confirmed');
  });

  it('RECHAZADA ⇒ no admite, y el estado no se degrada por esta vía', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(
      macroAdmissionInput({
        macroIndustryEvidence: assessMacroIndustryEvidence({
          result: apolloResult({ name: 'Banco Popular', industry: 'banking' }),
          macroIndustryKey: 'health_pharma',
        }),
      }),
    );
    assert.equal(result.sectorEvidenceState, 'sector_not_mapped');
    assert.equal(result.blockReason, 'macro_industry_evidence_not_confirmed');
  });

  it('sin evaluación macro falla CERRADO', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(
      macroAdmissionInput({ macroIndustryEvidence: null }),
    );
    assert.equal(result.blockReason, 'macro_industry_unresolved');
    assert.equal(result.sectorEvidenceState, 'sector_not_mapped');
  });

  it('sin autorización de catálogo no admite', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(
      macroAdmissionInput({
        catalogAuthorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
      }),
    );
    assert.equal(result.blockReason, 'catalog_criteria_unauthorized');
  });

  it('sin perfil comprado no admite — la búsqueda no es evidencia', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(
      macroAdmissionInput({ candidateEnriched: false }),
    );
    assert.equal(result.blockReason, 'candidate_not_enriched');
  });

  it('la política legacy sigue siendo autoritativa donde existe', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(
      macroAdmissionInput({ legacySectorPolicyPresent: true }),
    );
    assert.equal(result.blockReason, 'legacy_sector_policy_authoritative');
    assert.equal(result.admissionSource, 'legacy_sector_policy');
  });

  it('un estado ya MEDIDO sale intacto', () => {
    for (const state of [
      'sector_evidence_confirmed',
      'sector_evidence_contradictory',
      'sector_evidence_missing',
    ] as const) {
      const result = resolveApolloSectorPostEnrichmentAdmission(
        macroAdmissionInput({ postEnrichmentSectorState: state }),
      );
      assert.equal(result.sectorEvidenceState, state);
      assert.equal(result.blockReason, 'sector_state_not_unmapped');
    }
  });
});

describe('§ 13 — enrutado explícito por taxonomía, no por array vacío', () => {
  it('una corrida LEGACY sin subindustrias NO entra en la vía macro', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(
      macroAdmissionInput({ taxonomyMode: 'industry_subindustry' }),
    );
    // Antes de este hito, este es EXACTAMENTE el bloqueo que devolvía.
    assert.equal(result.blockReason, 'no_requested_subindustries');
    assert.equal(result.admissionSource, 'legacy_sector_policy');
  });

  it('sin `taxonomyMode` el comportamiento es el legacy', () => {
    const input = macroAdmissionInput();
    delete (input as Record<string, unknown>).taxonomyMode;
    const result = resolveApolloSectorPostEnrichmentAdmission(
      input as Parameters<typeof resolveApolloSectorPostEnrichmentAdmission>[0],
    );
    assert.equal(result.blockReason, 'no_requested_subindustries');
  });
});

// ─── § 11 — bootstrap sin subindustrias ───────────────────────────────────────

describe('§ 11 — el bootstrap sigue funcionando sin subindustrias', () => {
  it('una petición macro válida resuelve las dos precondiciones de catálogo', () => {
    const context = resolveApolloMacroIndustryRequest({
      industry: 'Salud & Farmacéuticos',
      selectionCatalogVersion: '2.0.0',
    });
    const preconditions = macroIndustryBootstrapPreconditions(context);
    assert.equal(preconditions.catalogTermsResolved, true);
    assert.equal(preconditions.queryCoverageComplete, true);

    // Y con ellas, la autorización de la corrida se concede.
    const authorization = evaluateApolloSectorEvidenceBootstrapAuthorization({
      providerSearchExecuted: true,
      catalogVersionCoherent: true,
      ...preconditions,
    });
    assert.equal(authorization.authorized, true);
  });

  it('una macro industria fuera del catálogo NO autoriza gasto', () => {
    const context = resolveApolloMacroIndustryRequest({
      industry: 'Educación',
      selectionCatalogVersion: '2.0.0',
    });
    const preconditions = macroIndustryBootstrapPreconditions(context);
    assert.equal(preconditions.catalogTermsResolved, false);
    const authorization = evaluateApolloSectorEvidenceBootstrapAuthorization({
      providerSearchExecuted: true,
      catalogVersionCoherent: true,
      ...preconditions,
    });
    assert.equal(authorization.authorized, false);
    assert.ok(
      authorization.authorized === false &&
        authorization.blockReason === 'catalog_terms_unresolved',
    );
  });

  it('una corrida legacy no produce precondiciones macro', () => {
    const context = resolveApolloMacroIndustryRequest({
      industry: 'Retail y Consumo',
      selectionCatalogVersion: '1.0.0',
    });
    const preconditions = macroIndustryBootstrapPreconditions(context);
    assert.deepEqual(preconditions, {
      catalogTermsResolved: false,
      queryCoverageComplete: false,
    });
  });
});

// ─── § 25 — el contrato de objetivo no cambia ─────────────────────────────────

describe('§ 25 — la admisión macro NO cuenta para el objetivo', () => {
  it('cruzar el gate sectorial no es un candidato persistido', () => {
    const result = resolveApolloSectorPostEnrichmentAdmission(macroAdmissionInput());
    // El resultado sólo declara un estado sectorial. No lleva ningún campo que
    // pueda hacer contar al candidato: ni `countsTowardTarget`, ni conteo, ni
    // marca de persistencia. La admisión es una condición NECESARIA aguas
    // arriba, nunca suficiente.
    assert.deepEqual(
      Object.keys(result).sort(),
      [
        'admissionSource',
        'admittedByRequestedSubindustryPrecision',
        'blockReason',
        'macroIndustryEvidence',
        'matchedRequestedSubindustry',
        'operationalConfirmation',
        'postEnrichmentSectorState',
        'sectorEvidenceState',
      ].sort(),
    );
  });
});
