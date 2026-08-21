/**
 * agent1-subindustry-precision-wave1-1.test.ts — la Ola 1 de reglas de precisión.
 *
 * AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2C · §§ 2–5, 7, 9–10, 19–24 y 27.
 *
 * Qué fija esta suite: que las NUEVE subindustrias nuevas confirman lo que deben,
 * NO confirman lo que no deben, y que sus ramas negativas son económicamente
 * INERTES. Lo último es la condición que hace seguro registrarlas sin calibración
 * live (§ 3, § 19, § 25).
 *
 * La asimetría que se prueba en todas: en `confirm_only` un falso NEGATIVO es gratis
 * —la regla se abstiene y la corrida queda como si no existiera— y un falso POSITIVO
 * cuesta, porque `confirmed` puede contar hacia el objetivo. Por eso las anclas se
 * prueban por lo que RECHAZAN tanto como por lo que aceptan.
 *
 * Sin llamadas a proveedor, sin red, sin reloj, sin escrituras. Todo el módulo bajo
 * prueba es puro.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assessApolloSubindustryPrecision,
  assessApolloSubindustryPrecisionForRequest,
  listSubindustryPrecisionRuleSets,
  projectOperationalSubindustryVerdict,
  toApolloSubindustryPrecisionMetadata,
  type ApolloSubindustryPrecisionAssessment,
} from '../apollo-subindustry-precision';
import { normalizeSubindustryIdentity } from '../apollo-subindustry-key-resolution';
import {
  evaluateCandidateSubindustryTargetEligibility,
  resolveCandidateSubindustryRequirement,
} from '../candidate-completeness-contract';
import { foldSubindustryPrecisionIntoSectorState } from '../apollo-two-round/production-runner.server';
import type { WebSearchResult } from '../types';
import {
  SELLUP_ACTIVE_SUBINDUSTRY_NAMES,
  SELLUP_SUBINDUSTRIES_WITH_PRECISION_CONFIRM_ONLY,
  SELLUP_SUBINDUSTRIES_WITH_PRECISION_FULL,
} from './fixtures/sellup-subindustry-catalog-names';

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

const blank = (): WebSearchResult => result('Empresa Neutra', {});

/** ¿Esta evidencia produce una contribución operativa POSITIVA? */
function confirmsOperationally(assessment: ApolloSubindustryPrecisionAssessment): boolean {
  const operational = projectOperationalSubindustryVerdict(assessment);
  return operational.subindustryMapped && operational.subindustryMatch === 'confirmed';
}

const BASE_SECTOR_STATES = [
  'sector_evidence_confirmed',
  'sector_evidence_missing_needs_enrichment',
  'sector_evidence_contradictory',
  'sector_not_mapped',
] as const;

const SUPERMARKETS = 'Supermercados e Hipermercados';
const DEPARTMENT = 'Tiendas por Departamento, Moda y Calzado';
const FORMACION = 'Formación Corporativa y Corporate Training';

// ─── Especificación de la Ola 1 ───────────────────────────────────────────────

type Fixture = { why: string; title?: string; metadata: Record<string, unknown> };

type Wave1Spec = {
  /** Nombre canónico EXACTO del catálogo activo. */
  name: string;
  /** ≥ 3 positivos, repartidos en ≥ 2 campos/fuentes del proveedor (DoD 3 y 4). */
  positives: Fixture[];
  /** ≥ 3 hermanas que NO deben confirmar (DoD 5). */
  negativeSiblings: Fixture[];
  /** Industrias PADRE/amplias que por sí solas NO confirman (DoD 6 y 17). */
  parentOnly: string[];
  /** Industria declarada que CONTRADICE (DoD 8). */
  contradictoryIndustry: string;
  /** Substring adversarial y vocabulario genérico que NO deben confirmar (DoD 9 y 16). */
  adversarial: Fixture[];
  /** Etiquetas que NO pueden resolver identidad de precisión (DoD 18, § 5). */
  unapprovedIdentityLabels: string[];
  /** Variante de caja/tilde que SÍ debe resolver a la misma regla (DoD 10). */
  identityVariants: string[];
};

const WAVE_1: readonly Wave1Spec[] = [
  {
    name: 'Banca Tradicional',
    positives: [
      { why: 'industria de proveedor `banking` (observada en Prod)', metadata: { industry: 'banking' } },
      { why: '`retail banking` declarado', metadata: { industry: 'retail banking' } },
      { why: 'entidad bancaria en keywords', metadata: { keywords: ['entidad bancaria regulada'] } },
      {
        why: 'banca comercial en descripción',
        metadata: { short_description: 'banca comercial para empresas' },
      },
      {
        why: 'banco comercial en el perfil web',
        metadata: { apollo_profile: { seo_description: 'el banco comercial lider del pais' } },
      },
    ],
    negativeSiblings: [
      { why: 'banca de inversión', metadata: { industry: 'investment banking' } },
      { why: 'mercado de capitales', metadata: { industry: 'capital markets' } },
      { why: 'gestora de activos', metadata: { industry: 'investment management' } },
      { why: 'comisionista de bolsa', metadata: { keywords: ['brokerage', 'banking'] } },
      { why: 'neobanco', metadata: { keywords: ['neobank', 'banking'] } },
      { why: 'software bancario', metadata: { keywords: ['core banking software'] } },
    ],
    parentOnly: ['financial services', 'servicios financieros', 'finance', 'banca', 'banco', 'bank'],
    contradictoryIndustry: 'insurance',
    adversarial: [
      { why: '«Banco de Alimentos» no es un banco', title: 'Banco de Alimentos', metadata: {} },
      { why: 'banco de sangre', metadata: { keywords: ['banco de sangre'] } },
    ],
    unapprovedIdentityLabels: ['banco', 'bank', 'entidad bancaria', 'banking'],
    identityVariants: ['banca tradicional', 'BANCA TRADICIONAL', '  Banca Tradicional  '],
  },
  {
    name: 'Farmacias Cadena y Retail de Salud',
    positives: [
      { why: 'cadena de farmacias en keywords', metadata: { keywords: ['cadena de farmacias'] } },
      {
        why: 'droguerías con industria retail',
        metadata: { industry: 'retail', keywords: ['droguerias'] },
      },
      {
        why: 'pharmacy chain en el perfil web',
        metadata: { apollo_profile: { seo_description: 'the largest pharmacy chain' } },
      },
      { why: 'nombre comercial de droguería', title: 'Droguerias La Rebaja', metadata: {} },
      {
        why: 'industria PADRE de salud + ancla en keywords',
        metadata: { industry: 'hospital & health care', keywords: ['cadena de farmacias'] },
      },
    ],
    negativeSiblings: [
      {
        why: 'laboratorio farmacéutico',
        metadata: { keywords: ['laboratorio farmaceutico', 'farmacia'] },
      },
      { why: 'distribuidor farmacéutico', metadata: { keywords: ['pharmaceutical distributor'] } },
      { why: 'farmacia hospitalaria', metadata: { keywords: ['farmacia hospitalaria'] } },
      { why: 'fabricante de medicamentos', metadata: { keywords: ['drug manufacturer'] } },
      { why: 'red hospitalaria', metadata: { keywords: ['red hospitalaria', 'farmacia'] } },
    ],
    parentOnly: ['retail', 'pharmaceuticals', 'health care', 'consumer goods', 'wholesale'],
    contradictoryIndustry: 'biotechnology',
    adversarial: [
      { why: '`farmacologia` no es `farmacia` (token distinto)', metadata: { keywords: ['farmacologia'] } },
      { why: '`farmaceutica` sola no confirma retail', metadata: { industry: 'farmaceutica' } },
    ],
    unapprovedIdentityLabels: ['farmacia', 'droguerias cadena retail farmacia', 'Farmacias Cadena'],
    identityVariants: ['farmacias cadena y retail de salud', 'FARMACIAS CADENA Y RETAIL DE SALUD'],
  },
  {
    name: 'Medicina Prepagada y EPS',
    positives: [
      {
        why: 'entidad promotora de salud desplegada',
        metadata: { keywords: ['entidad promotora de salud'] },
      },
      {
        why: 'medicina prepagada en descripción',
        metadata: { short_description: 'medicina prepagada y planes complementarios' },
      },
      { why: 'ISAPRE con industria seguros', metadata: { industry: 'insurance', keywords: ['isapre'] } },
      {
        why: 'operadora de saúde en el perfil web',
        metadata: { apollo_profile: { seo_description: 'operadora de saude empresarial' } },
      },
      {
        why: 'industria PADRE de salud + ancla en keywords',
        metadata: { industry: 'hospital & health care', keywords: ['medicina prepagada'] },
      },
    ],
    negativeSiblings: [
      { why: 'seguro de vida', metadata: { industry: 'life insurance' } },
      { why: 'corredor de seguros', metadata: { keywords: ['insurance broker'] } },
      {
        why: 'red hospitalaria (prestador)',
        metadata: { keywords: ['red hospitalaria', 'medicina prepagada'] },
      },
      { why: 'laboratorio clínico', metadata: { keywords: ['laboratorio clinico'] } },
      { why: 'reaseguro', metadata: { industry: 'reinsurance' } },
    ],
    parentOnly: ['insurance', 'seguros', 'hospital & health care', 'health care', 'salud'],
    contradictoryIndustry: 'life insurance',
    adversarial: [
      {
        why: 'EPS de poliestireno expandido NO es una EPS de salud',
        metadata: { industry: 'plastics', keywords: ['EPS foam manufacturing'] },
      },
      { why: 'EPS como sigla financiera', metadata: { keywords: ['EPS earnings per share'] } },
    ],
    unapprovedIdentityLabels: ['EPS', 'ISAPRE', 'plano de saúde', 'medicina prepagada'],
    identityVariants: ['medicina prepagada y eps', 'MEDICINA PREPAGADA Y EPS'],
  },
  {
    name: 'Universidades e Institutos Privados',
    positives: [
      { why: 'universidad privada en keywords', metadata: { keywords: ['universidad privada'] } },
      {
        why: 'university con industria higher education',
        metadata: { industry: 'higher education', keywords: ['university'] },
      },
      {
        why: 'instituto de educación superior en descripción',
        metadata: { short_description: 'instituto de educacion superior privado' },
      },
      { why: 'nombre comercial de universidad', title: 'Universidad de los Andes', metadata: {} },
    ],
    negativeSiblings: [
      { why: 'universidad corporativa', metadata: { keywords: ['universidad corporativa'] } },
      {
        why: 'escuela de negocios',
        metadata: { keywords: ['escuela de negocios', 'universidad'] },
      },
      { why: 'instituto técnico', metadata: { keywords: ['instituto tecnico'] } },
      { why: 'universidad pública', metadata: { keywords: ['universidad publica'] } },
      { why: 'plataforma edtech', metadata: { keywords: ['edtech'] } },
    ],
    parentOnly: ['education', 'higher education', 'education management', 'educacion', 'training'],
    contradictoryIndustry: 'primary/secondary education',
    adversarial: [
      { why: '`universo` no es `universidad`', metadata: { keywords: ['universo de datos'] } },
      { why: '`universal` no es `universidad`', metadata: { short_description: 'servicio universal' } },
    ],
    unapprovedIdentityLabels: ['universidad', 'universidad pública estatal', 'university'],
    identityVariants: [
      'universidades e institutos privados',
      'UNIVERSIDADES E INSTITUTOS PRIVADOS',
    ],
  },
  {
    name: 'Ciberseguridad',
    positives: [
      {
        why: 'industria `computer & network security` de Apollo',
        metadata: { industry: 'computer & network security' },
      },
      { why: 'ciberseguridad en keywords', metadata: { keywords: ['ciberseguridad empresas'] } },
      {
        why: 'pentesting en descripción',
        metadata: { short_description: 'servicios de pentesting y threat intelligence' },
      },
      {
        why: 'managed security services en el perfil web',
        metadata: { apollo_profile: { seo_description: 'managed security services provider' } },
      },
    ],
    negativeSiblings: [
      { why: 'vigilancia privada (seguridad física)', metadata: { keywords: ['vigilancia privada', 'seguridad'] } },
      { why: 'servicios de TI', metadata: { keywords: ['it services', 'cybersecurity'] } },
      {
        why: 'industria `security & investigations`',
        metadata: { industry: 'security & investigations' },
      },
      { why: 'antivirus de consumo', metadata: { keywords: ['consumer antivirus'] } },
      { why: 'integrador de sistemas', metadata: { keywords: ['integrador de sistemas', 'infosec'] } },
    ],
    parentOnly: ['software', 'information technology', 'security', 'seguridad', 'saas', 'internet'],
    contradictoryIndustry: 'telecommunications',
    adversarial: [
      {
        why: '«SOC 2» de un SaaS no es un SOC de seguridad',
        metadata: { industry: 'saas', keywords: ['SOC 2 compliance'] },
      },
      { why: '`seguridad social` no es ciberseguridad', metadata: { keywords: ['seguridad social'] } },
      { why: '`seguridad industrial` no es ciberseguridad', metadata: { keywords: ['seguridad industrial'] } },
    ],
    unapprovedIdentityLabels: ['cybersecurity', 'infosec', 'protección de datos', 'seguridad informática'],
    identityVariants: ['ciberseguridad', 'CIBERSEGURIDAD', 'Ciberseguridad'],
  },
  {
    name: 'Redes Hospitalarias y Clínicas',
    positives: [
      { why: 'red hospitalaria en keywords', metadata: { keywords: ['red hospitalaria privada'] } },
      {
        why: 'grupo hospitalario en descripción',
        metadata: { short_description: 'grupo hospitalario con cinco sedes' },
      },
      {
        why: 'clínica privada con industria PADRE de salud',
        metadata: { industry: 'hospital & health care', keywords: ['clinica privada'] },
      },
      { why: 'nombre comercial de centro médico', title: 'Centro Medico Imbanaco', metadata: {} },
    ],
    negativeSiblings: [
      {
        why: 'laboratorio clínico con la misma industria padre',
        metadata: { industry: 'hospital & health care', keywords: ['laboratorio clinico'] },
      },
      {
        why: 'EPS con la misma industria padre',
        metadata: { industry: 'hospital & health care', keywords: ['entidad promotora de salud'] },
      },
      {
        why: 'cadena de farmacias con la misma industria padre',
        metadata: { industry: 'hospital & health care', keywords: ['cadena de farmacias'] },
      },
      { why: 'hospital público', metadata: { keywords: ['hospital publico', 'red hospitalaria'] } },
      { why: 'software hospitalario', metadata: { keywords: ['hospital software'] } },
      { why: 'clínica veterinaria', metadata: { keywords: ['clinica veterinaria', 'clinica privada'] } },
    ],
    parentOnly: ['hospital & health care', 'health care', 'salud', 'medical practice'],
    contradictoryIndustry: 'pharmaceuticals',
    adversarial: [
      // El defecto que las anclas COMPUESTAS cierran: `hospital` a secas es token de
      // `hospital & health care`, la industria que Apollo asigna a TODA la salud.
      { why: '`hospital` suelto en el nombre no confirma', title: 'Hospital San Vicente', metadata: {} },
      { why: '`clinica` suelta en keywords no confirma', metadata: { keywords: ['clinica'] } },
      { why: '`hospitalidad` no es `hospital`', metadata: { keywords: ['hospitalidad'] } },
    ],
    unapprovedIdentityLabels: ['hospital privado', 'red hospitalaria', 'Redes Hospitalarias', 'hospital'],
    identityVariants: [
      'redes hospitalarias y clinicas',
      'Redes Hospitalarias y Clinicas',
      'REDES HOSPITALARIAS Y CLÍNICAS',
    ],
  },
  {
    name: 'Laboratorios Clínicos y Diagnóstico',
    positives: [
      { why: 'laboratorio clínico en keywords', metadata: { keywords: ['laboratorio clinico'] } },
      {
        why: 'red de laboratorios en descripción',
        metadata: { short_description: 'red de laboratorios clinicos del pais' },
      },
      {
        why: 'clinical laboratory con industria PADRE de salud',
        metadata: { industry: 'hospital & health care', keywords: ['clinical laboratory'] },
      },
      {
        why: 'medical diagnostics en el perfil web',
        metadata: { apollo_profile: { seo_description: 'medical diagnostics network' } },
      },
    ],
    negativeSiblings: [
      { why: 'laboratorio farmacéutico', metadata: { keywords: ['laboratorio farmaceutico'] } },
      {
        why: 'red hospitalaria',
        metadata: { keywords: ['red hospitalaria', 'laboratorio clinico'] },
      },
      { why: 'universidad', metadata: { keywords: ['universidad', 'laboratorio clinico'] } },
      { why: 'laboratorio de investigación', metadata: { keywords: ['research laboratory'] } },
      { why: 'laboratorio de alimentos', metadata: { keywords: ['laboratorio de alimentos'] } },
    ],
    parentOnly: ['hospital & health care', 'laboratory', 'laboratorio', 'health care', 'diagnostics'],
    contradictoryIndustry: 'pharmaceuticals',
    adversarial: [
      { why: '`laboratorio` a secas no confirma (§ 16)', metadata: { industry: 'laboratory' } },
      { why: '`laboratorio` a secas en keywords tampoco', metadata: { keywords: ['laboratorio'] } },
    ],
    unapprovedIdentityLabels: ['laboratorio', 'laboratorio clinico', 'Laboratorios Clínicos'],
    identityVariants: [
      'laboratorios clinicos y diagnostico',
      'Laboratorios Clinicos y Diagnostico',
      'LABORATORIOS CLÍNICOS Y DIAGNÓSTICO',
    ],
  },
  {
    name: 'Fabricantes de Alimentos y Bebidas (FMCG)',
    positives: [
      { why: 'industria `food production` de Apollo', metadata: { industry: 'food production' } },
      { why: 'fabricante de alimentos en keywords', metadata: { keywords: ['fabricante de alimentos'] } },
      {
        why: 'embotelladora en descripción',
        metadata: { short_description: 'embotelladora de bebidas gaseosas' },
      },
      {
        why: 'consumer packaged goods en el perfil web',
        metadata: { apollo_profile: { seo_description: 'consumer packaged goods manufacturer' } },
      },
    ],
    negativeSiblings: [
      { why: 'supermercado (canal)', metadata: { keywords: ['supermercado', 'food production'] } },
      { why: 'distribuidor de alimentos', metadata: { keywords: ['food distributor'] } },
      { why: 'cadena de restaurantes', metadata: { keywords: ['cadena de restaurantes'] } },
      { why: 'importador', metadata: { keywords: ['importador', 'fabricante de alimentos'] } },
      { why: 'agricultura', metadata: { industry: 'agriculture', keywords: ['food production'] } },
    ],
    parentOnly: [
      'food and beverages',
      'consumer goods',
      'retail',
      'manufacturing',
      'consumo masivo',
      'fmcg',
      'cpg',
      'alimentos',
      'bebidas',
    ],
    contradictoryIndustry: 'restaurants',
    adversarial: [
      {
        why: 'el alias `consumo masivo` NO se promovió a ancla',
        metadata: { industry: 'consumo masivo' },
      },
      { why: '`CPG` a secas no demuestra fabricación', metadata: { keywords: ['CPG'] } },
    ],
    unapprovedIdentityLabels: [
      'consumo masivo',
      'CPG',
      'FMCG alimentos',
      'Fabricantes de Alimentos y Bebidas',
    ],
    identityVariants: [
      'fabricantes de alimentos y bebidas (fmcg)',
      'FABRICANTES DE ALIMENTOS Y BEBIDAS (FMCG)',
    ],
  },
  {
    name: 'Escuelas de Negocios y Formación Ejecutiva',
    positives: [
      { why: 'escuela de negocios en keywords', metadata: { keywords: ['escuela de negocios'] } },
      {
        why: 'business school con la industria de proveedor observada',
        metadata: { industry: 'professional training & coaching', keywords: ['business school'] },
      },
      {
        why: 'executive MBA en descripción',
        metadata: { short_description: 'programas de executive mba y alta direccion' },
      },
      {
        why: 'executive education en el perfil web',
        metadata: { apollo_profile: { seo_description: 'executive education programs' } },
      },
    ],
    negativeSiblings: [
      {
        why: 'formación corporativa (§ 21: sigue sin mapeo)',
        metadata: { keywords: ['formacion corporativa', 'formacion ejecutiva'] },
      },
      {
        why: 'corporate training',
        metadata: { keywords: ['corporate training', 'executive education'] },
      },
      { why: 'universidad', metadata: { keywords: ['universidad', 'escuela de negocios'] } },
      { why: 'plataforma LMS', metadata: { keywords: ['learning management system'] } },
      { why: 'consultora de gestión', metadata: { keywords: ['management consulting', 'business school'] } },
    ],
    parentOnly: [
      'professional training & coaching',
      'education',
      'higher education',
      'education management',
      'training',
    ],
    contradictoryIndustry: 'staffing & recruiting',
    adversarial: [
      {
        why: '`professional training & coaching` es el único valor observado y lo comparten TRES subindustrias',
        metadata: { industry: 'professional training & coaching' },
      },
      { why: '`negocios` a secas no confirma', metadata: { keywords: ['negocios'] } },
    ],
    unapprovedIdentityLabels: [
      'formación ejecutiva',
      'escuela de negocios',
      'Escuelas de Negocios',
      'business school',
    ],
    identityVariants: [
      'escuelas de negocios y formacion ejecutiva',
      'Escuelas de Negocios y Formacion Ejecutiva',
      'ESCUELAS DE NEGOCIOS Y FORMACIÓN EJECUTIVA',
    ],
  },
];

// ─── § 23 · estructura del registro ───────────────────────────────────────────

describe('§ 23 · el registro declara 2 `full` + 9 `confirm_only`, sin colisiones', () => {
  test('la Ola 1 cubre EXACTAMENTE las nueve candidatas evaluadas', () => {
    assert.equal(WAVE_1.length, 9);
    assert.deepEqual(
      WAVE_1.map((spec) => spec.name).sort(),
      [...SELLUP_SUBINDUSTRIES_WITH_PRECISION_CONFIRM_ONLY].sort(),
    );
  });

  test('las once reglas están registradas y ninguna de las nueve es `full`', () => {
    const byName = new Map(
      listSubindustryPrecisionRuleSets().map((ruleSet) => [ruleSet.canonicalName, ruleSet]),
    );
    assert.equal(byName.size, 11);
    for (const spec of WAVE_1) {
      const ruleSet = byName.get(spec.name);
      assert.ok(ruleSet, `${spec.name} no está registrada`);
      assert.equal(ruleSet.mode, 'confirm_only', `${spec.name} debe ser confirm_only (§ 25)`);
    }
    for (const name of SELLUP_SUBINDUSTRIES_WITH_PRECISION_FULL) {
      assert.equal(byName.get(name)?.mode, 'full');
    }
  });

  test('cada regla nueva está COMPLETA: los cuatro catálogos negativos y las anclas', () => {
    const byName = new Map(
      listSubindustryPrecisionRuleSets().map((ruleSet) => [ruleSet.canonicalName, ruleSet]),
    );
    for (const spec of WAVE_1) {
      const ruleSet = byName.get(spec.name)!;
      // Un mapeo a medias no falla ruidosamente: confirma o rechaza de menos, y eso
      // decide gasto y admisión. Se exige que las cinco listas estén pobladas.
      assert.ok(ruleSet.anchors.length >= 3, `${spec.name}: anclas insuficientes`);
      assert.ok(
        ruleSet.exclusiveBusinessModels.length > 0,
        `${spec.name}: sin modelos excluyentes`,
      );
      assert.ok(
        ruleSet.conflictingBusinessModels.length > 0,
        `${spec.name}: sin modelos en conflicto`,
      );
      assert.ok(
        ruleSet.broadProviderIndustries.length > 0,
        `${spec.name}: sin industrias amplias`,
      );
      assert.ok(
        ruleSet.contradictoryProviderIndustries.length > 0,
        `${spec.name}: sin industrias contradictorias`,
      );
      // Etiqueta simple: sin familias. Las nueve lo son.
      assert.equal(ruleSet.anchorFamilies, null, `${spec.name}: no es etiqueta compuesta`);
      // § 26 — code-owned: nada de catálogo en runtime.
      assert.equal(ruleSet.subindustryId, null);
      assert.equal(ruleSet.catalogVersionId, null);
      // § 5 — ningún alias de catálogo promovido.
      assert.deepEqual(ruleSet.precisionAliases, []);
      // La clave de indexación es la normalización del nombre canónico, o el
      // resolvedor exacto de PHASE 2A no podría alcanzarla nunca.
      assert.equal(ruleSet.key, normalizeSubindustryIdentity(ruleSet.canonicalName));
      assert.ok(ruleSet.metadata?.rationale, `${spec.name}: sin rationale`);
    }
  });

  test('los nombres canónicos son los del catálogo activo, no las abreviaturas del encargo', () => {
    for (const spec of WAVE_1) {
      assert.ok(
        SELLUP_ACTIVE_SUBINDUSTRY_NAMES.includes(spec.name),
        `"${spec.name}" no es un nombre canónico del catálogo activo`,
      );
    }
  });

  test('§ 21 · «Formación Corporativa» sigue SIN mapeo y no confirma a nadie', () => {
    assert.ok(SELLUP_ACTIVE_SUBINDUSTRY_NAMES.includes(FORMACION));
    assert.equal(
      listSubindustryPrecisionRuleSets().some((ruleSet) => ruleSet.canonicalName === FORMACION),
      false,
    );
    const assessment = assessApolloSubindustryPrecision(
      result('Instituto Empresarial', {
        industry: 'professional training & coaching',
        keywords: ['corporate training', 'formacion corporativa', 'capacitacion empresarial'],
      }),
      FORMACION,
    );
    assert.equal(assessment.subindustryMapped, false);
    assert.equal(assessment.verdictReason, 'subindustry_not_mapped');
    assert.equal(confirmsOperationally(assessment), false);
  });
});

// ─── §§ 3–18 · por subindustria ───────────────────────────────────────────────

for (const spec of WAVE_1) {
  describe(`Ola 1 · ${spec.name}`, () => {
    test('DoD 3–4 · al menos 3 positivos, repartidos en ≥ 2 fuentes del proveedor', () => {
      assert.ok(spec.positives.length >= 3, 'menos de 3 positivos declarados');
      const sources = new Set<string>();
      for (const fixture of spec.positives) {
        const assessment = assessApolloSubindustryPrecision(
          result(fixture.title ?? 'Empresa Neutra', fixture.metadata),
          spec.name,
        );
        assert.equal(
          confirmsOperationally(assessment),
          true,
          `debía confirmar: ${fixture.why} · diag=${assessment.subindustryMatch}` +
            ` reason=${assessment.verdictReason}` +
            ` disq=${JSON.stringify(assessment.disqualifyingSignals)}`,
        );
        assert.equal(assessment.verdictReason, 'anchor_evidence_confirmed');
        assert.ok(assessment.subindustryEvidence.length > 0, 'confirmó sin evidencia trazable');
        sources.add(assessment.classificationSource);
      }
      assert.ok(
        sources.size >= 2,
        `los positivos deben venir de ≥ 2 fuentes distintas, hay ${sources.size}: ${[...sources]}`,
      );
    });

    test('DoD 5 · al menos 3 hermanas/negativos NO confirman', () => {
      assert.ok(spec.negativeSiblings.length >= 3, 'menos de 3 negativos declarados');
      for (const fixture of spec.negativeSiblings) {
        const assessment = assessApolloSubindustryPrecision(
          result(fixture.title ?? 'Empresa Neutra', fixture.metadata),
          spec.name,
        );
        assert.equal(
          confirmsOperationally(assessment),
          false,
          `NO debía confirmar: ${fixture.why} · diag=${assessment.subindustryMatch}` +
            ` evid=${JSON.stringify(assessment.subindustryEvidence.map((item) => item.term))}`,
        );
      }
    });

    test('DoD 6 y 17 · la industria PADRE por sí sola nunca confirma la hija', () => {
      assert.ok(spec.parentOnly.length >= 1);
      for (const industry of spec.parentOnly) {
        const assessment = assessApolloSubindustryPrecision(result('Empresa Neutra', { industry }), spec.name);
        assert.equal(
          confirmsOperationally(assessment),
          false,
          `la industria amplia "${industry}" NO puede confirmar ${spec.name}` +
            ` · diag=${assessment.subindustryMatch} reason=${assessment.verdictReason}`,
        );
        // Y sigue siendo una DUDA medida, no un rechazo: hay catálogo y la evidencia
        // no alcanzó.
        assert.equal(assessment.subindustryMapped, true);
        assert.notEqual(assessment.subindustryMatch, 'confirmed');
      }
    });

    test('DoD 7 · sin evidencia alguna el veredicto es una DUDA, nunca una confirmación', () => {
      const assessment = assessApolloSubindustryPrecision(blank(), spec.name);
      assert.equal(assessment.subindustryMapped, true);
      assert.equal(assessment.subindustryMatch, 'ambiguous');
      assert.equal(assessment.verdictReason, 'no_subindustry_evidence');
      assert.equal(confirmsOperationally(assessment), false);
    });

    test('DoD 8 · la industria declarada contradictoria RECHAZA en el diagnóstico', () => {
      const assessment = assessApolloSubindustryPrecision(
        result('Empresa Neutra', { industry: spec.contradictoryIndustry }),
        spec.name,
      );
      assert.equal(assessment.industryMatch, 'contradictory');
      assert.equal(assessment.subindustryMatch, 'rejected');
      assert.equal(assessment.verdictReason, 'declared_industry_contradicts');
      // …y en `confirm_only` ese rechazo se ABSTIENE en el plano operativo.
      assert.equal(confirmsOperationally(assessment), false);
    });

    test('DoD 9 y 16 · ningún término genérico ni substring adversarial confirma', () => {
      for (const fixture of spec.adversarial) {
        const assessment = assessApolloSubindustryPrecision(
          result(fixture.title ?? 'Empresa Neutra', fixture.metadata),
          spec.name,
        );
        assert.equal(
          confirmsOperationally(assessment),
          false,
          `falso positivo: ${fixture.why} · evid=${JSON.stringify(
            assessment.subindustryEvidence.map((item) => item.term),
          )}`,
        );
      }
    });

    test('DoD 10 · caja, espacios y tildes resuelven a la MISMA regla', () => {
      for (const variant of spec.identityVariants) {
        const assessment = assessApolloSubindustryPrecision(blank(), variant);
        assert.equal(
          assessment.subindustryMapped,
          true,
          `la variante "${variant}" debía resolver a ${spec.name}`,
        );
      }
    });

    test('DoD 11 · vocabulario de proveedor DESCONOCIDO no confirma ni rechaza', () => {
      const assessment = assessApolloSubindustryPrecision(
        result('Empresa Neutra', { industry: 'quantum yak grooming' }),
        spec.name,
      );
      assert.equal(assessment.industryMatch, 'unknown');
      assert.equal(assessment.subindustryMatch, 'ambiguous');
      assert.equal(confirmsOperationally(assessment), false);
    });

    test('DoD 18 · ninguna etiqueta no aprobada resuelve identidad de precisión (§ 5)', () => {
      for (const label of spec.unapprovedIdentityLabels) {
        const assessment = assessApolloSubindustryPrecision(blank(), label);
        assert.equal(
          assessment.subindustryMapped,
          false,
          `"${label}" NO puede resolver identidad de precisión`,
        );
        assert.equal(assessment.verdictReason, 'subindustry_not_mapped');
      }
    });

    test('§ 19 · TODA rama negativa es económicamente INERTE', () => {
      // El único cambio económico que una `confirm_only` puede producir es un
      // CONFIRMED positivo. Se recorren las ramas negativas alcanzables y se exige
      // que el estado sectorial, la persistencia y el objetivo queden EXACTAMENTE
      // como estarían sin la regla.
      const negatives: Fixture[] = [
        { why: 'sin evidencia', metadata: {} },
        { why: 'vocabulario desconocido', metadata: { industry: 'quantum yak grooming' } },
        { why: 'industria contradictoria', metadata: { industry: spec.contradictoryIndustry } },
        ...spec.negativeSiblings,
        ...spec.parentOnly.map((industry) => ({ why: `amplia ${industry}`, metadata: { industry } })),
      ];

      for (const fixture of negatives) {
        const assessment = assessApolloSubindustryPrecision(
          result(fixture.title ?? 'Empresa Neutra', fixture.metadata),
          spec.name,
        );
        if (confirmsOperationally(assessment)) continue; // rama positiva: permitida

        const operational = projectOperationalSubindustryVerdict(assessment);
        // Abstención: no contribuye. La forma es la de «sin política».
        assert.equal(operational.subindustryMapped, false, `${fixture.why}: debía abstenerse`);
        assert.equal(operational.subindustryMatch, 'ambiguous');
        assert.equal(operational.precisionMode, null);

        // El pliegue sectorial es la IDENTIDAD sobre los cuatro estados base.
        for (const base of BASE_SECTOR_STATES) {
          assert.equal(
            foldSubindustryPrecisionIntoSectorState(base, assessment),
            base,
            `${fixture.why}: el pliegue movió el estado sectorial desde ${base}`,
          );
        }

        // El contrato de completitud CUENTA con el operativo: la subindustria no
        // confirma, así que no cuenta hacia el objetivo, y tampoco contradice —el
        // rechazo no cruzó—, así que no impide persistir.
        const requirement = resolveCandidateSubindustryRequirement({
          sectorEvidenceState: 'sector_evidence_confirmed',
          requestedSubindustries: [spec.name],
          subindustryPrecision: assessment,
        });
        assert.equal(requirement.eligibilityVerdict, 'not_confirmed', fixture.why);
        assert.equal(requirement.matchedRequestedSubindustry, null);

        // El MOTIVO de revisión distingue «ambigua» de «rechazada»: es la etiqueta de
        // ficha que hace auditable una regla sin calibrar.
        assert.ok(
          ['subindustry_ambiguous', 'subindustry_rejected'].includes(
            requirement.subindustryBlockingReason ?? '',
          ),
          `${fixture.why}: motivo de bloqueo inesperado (${requirement.subindustryBlockingReason})`,
        );

        // Y REPORTA el diagnóstico, no el operativo: es lo que hace la regla
        // observable y lo que permitirá decidir su promoción a `full` (§ 24). Si esto
        // se colapsara a `unmapped`, la regla nueva sería invisible.
        assert.ok(
          ['ambiguous', 'rejected'].includes(requirement.subindustryMatch),
          `${fixture.why}: el reporte perdió la rama diagnóstica (${requirement.subindustryMatch})`,
        );
        assert.equal(requirement.subindustryMatch, assessment.subindustryMatch);

        // La condición de subindustria del contrato de objetivo NO queda satisfecha.
        const eligibility = evaluateCandidateSubindustryTargetEligibility({
          persistenceSuccess: true,
          sectorEvidenceState: 'sector_evidence_confirmed',
          requestedSubindustries: [spec.name],
          subindustryPrecision: assessment,
          employeeCountStatus: 'confirmed',
          linkedinStatus: 'confirmed',
          duplicateStatus: null,
          ownershipGate: 'pass',
          qualityGate: 'pass',
        });
        assert.notEqual(
          eligibility.conditionStates.subindustry_match,
          'satisfied',
          `${fixture.why}: una rama negativa satisfizo la condición de subindustria`,
        );
      }
    });

    test('§ 19 · un CONFIRMED positivo sí puede contar hacia el objetivo', () => {
      const assessment = assessApolloSubindustryPrecision(
        result(spec.positives[0].title ?? 'Empresa Neutra', spec.positives[0].metadata),
        spec.name,
      );
      const operational = projectOperationalSubindustryVerdict(assessment);
      assert.equal(operational.subindustryMapped, true);
      assert.equal(operational.subindustryMatch, 'confirmed');
      assert.equal(operational.precisionMode, 'confirm_only');

      const requirement = resolveCandidateSubindustryRequirement({
        sectorEvidenceState: 'sector_evidence_confirmed',
        requestedSubindustries: [spec.name],
        subindustryPrecision: assessment,
      });
      assert.equal(requirement.subindustryMatch, 'confirmed');
      assert.equal(requirement.matchedRequestedSubindustry, spec.name);
      assert.equal(requirement.subindustryBlockingReason, null);

      const eligibility = evaluateCandidateSubindustryTargetEligibility({
        persistenceSuccess: true,
        sectorEvidenceState: 'sector_evidence_confirmed',
        requestedSubindustries: [spec.name],
        subindustryPrecision: assessment,
        employeeCountStatus: 'confirmed',
        linkedinStatus: 'confirmed',
        duplicateStatus: null,
        ownershipGate: 'pass',
        qualityGate: 'pass',
      });
      // Sólo la condición de SUBINDUSTRIA: las demás (empleados, LinkedIn,
      // duplicados) las deciden gates ajenos a esta fase, y fijar aquí un candidato
      // completo ataría la suite a su vocabulario.
      assert.equal(eligibility.conditionStates.subindustry_match, 'satisfied');
      assert.equal(eligibility.failedConditions.includes('subindustry_match'), false);
    });
  });
}

// ─── § 20 · ANY-OF mixto e invariancia de orden ───────────────────────────────

describe('§ 20 · ANY-OF mixto `full` + `confirm_only`', () => {
  /** Un fabricante de alimentos: `full` (Tiendas por Departamento) lo RECHAZA. */
  const FOOD_MANUFACTURER = (): WebSearchResult =>
    result('Alimentos del Valle', { industry: 'food production' });

  /** Un supermercado: `full` (Supermercados) lo CONFIRMA. */
  const SUPERMARKET = (): WebSearchResult =>
    result('Empresa Neutra', { industry: 'retail', keywords: ['supermercado'] });

  const FMCG = 'Fabricantes de Alimentos y Bebidas (FMCG)';

  test('FULL rechazada + NUEVA confirmada ⇒ confirmada (gana el ANY-OF)', () => {
    const soloFull = assessApolloSubindustryPrecisionForRequest(FOOD_MANUFACTURER(), [DEPARTMENT]);
    assert.equal(soloFull.subindustryMatch, 'rejected');
    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', soloFull),
      'sector_evidence_contradictory',
    );

    const mixed = assessApolloSubindustryPrecisionForRequest(FOOD_MANUFACTURER(), [DEPARTMENT, FMCG]);
    assert.equal(mixed.subindustryMatch, 'confirmed');
    assert.equal(mixed.matchedRequestedSubindustry, FMCG);
    const operational = projectOperationalSubindustryVerdict(mixed);
    assert.equal(operational.subindustryMatch, 'confirmed');
    assert.equal(operational.precisionMode, 'confirm_only');
  });

  test('FULL confirmada + NUEVA ambigua ⇒ confirmada, y la ambigua no resta', () => {
    const soloFull = assessApolloSubindustryPrecisionForRequest(SUPERMARKET(), [SUPERMARKETS]);
    const mixed = assessApolloSubindustryPrecisionForRequest(SUPERMARKET(), [SUPERMARKETS, FMCG]);
    assert.equal(mixed.subindustryMatch, 'confirmed');
    assert.equal(mixed.matchedRequestedSubindustry, SUPERMARKETS);

    for (const base of BASE_SECTOR_STATES) {
      assert.equal(
        foldSubindustryPrecisionIntoSectorState(base, mixed),
        foldSubindustryPrecisionIntoSectorState(base, soloFull),
        `la confirm_only ambigua cambió el pliegue desde ${base}`,
      );
    }
  });

  test('FULL rechazada + NUEVA ambigua ⇒ IDÉNTICO a la FULL sola (§ 19)', () => {
    // Es el defecto que el MIXED-MODE PREFLIGHT de PHASE 2B encontró: la rama
    // negativa de una `confirm_only` rescataba del rechazo de una `full`. Con nueve
    // reglas nuevas registradas, se vuelve a exigir sobre cada una.
    const contradicts = (): WebSearchResult =>
      result('Empresa Neutra', { industry: 'banking', keywords: ['banking'] });

    const soloFull = assessApolloSubindustryPrecisionForRequest(contradicts(), [SUPERMARKETS]);
    assert.equal(soloFull.subindustryMatch, 'rejected');

    for (const spec of WAVE_1) {
      if (spec.name === 'Banca Tradicional') continue; // ahí la nueva CONFIRMA, no duda
      const mixed = assessApolloSubindustryPrecisionForRequest(contradicts(), [
        SUPERMARKETS,
        spec.name,
      ]);
      const mixedOperational = projectOperationalSubindustryVerdict(mixed);
      const fullOperational = projectOperationalSubindustryVerdict(soloFull);
      assert.equal(
        mixedOperational.subindustryMatch,
        fullOperational.subindustryMatch,
        `${spec.name} alteró el veredicto operativo de una full rechazada`,
      );
      assert.equal(mixedOperational.subindustryMapped, fullOperational.subindustryMapped);
      for (const base of BASE_SECTOR_STATES) {
        assert.equal(
          foldSubindustryPrecisionIntoSectorState(base, mixed),
          foldSubindustryPrecisionIntoSectorState(base, soloFull),
          `${spec.name} movió el pliegue de una full rechazada desde ${base}`,
        );
      }
    }
  });

  test('NUEVA rechazada + SIN MAPEO ⇒ el comportamiento base, sin rama nueva', () => {
    const assessment = assessApolloSubindustryPrecisionForRequest(
      result('Empresa Neutra', { industry: 'insurance' }),
      ['Banca Tradicional', FORMACION],
    );
    const operational = projectOperationalSubindustryVerdict(assessment);
    assert.equal(operational.subindustryMapped, false);
    assert.equal(operational.subindustryMatch, 'ambiguous');
    assert.equal(operational.precisionMode, null);
    for (const base of BASE_SECTOR_STATES) {
      assert.equal(foldSubindustryPrecisionIntoSectorState(base, assessment), base);
    }
  });

  test('§ 20 · AB == BA: la economía es invariante al orden en TODOS los pares', () => {
    const fixtures: WebSearchResult[] = [
      FOOD_MANUFACTURER(),
      SUPERMARKET(),
      result('Empresa Neutra', { industry: 'banking' }),
      result('Empresa Neutra', { industry: 'hospital & health care', keywords: ['laboratorio clinico'] }),
      result('Empresa Neutra', { keywords: ['escuela de negocios'] }),
      result('Empresa Neutra', {}),
    ];
    const labels = [SUPERMARKETS, DEPARTMENT, FORMACION, ...WAVE_1.map((spec) => spec.name)];

    for (const fixture of fixtures) {
      for (const a of labels) {
        for (const b of labels) {
          if (a === b) continue;
          const ab = assessApolloSubindustryPrecisionForRequest(fixture, [a, b]);
          const ba = assessApolloSubindustryPrecisionForRequest(fixture, [b, a]);

          // El VEREDICTO es invariante al orden…
          assert.equal(ab.subindustryMatch, ba.subindustryMatch, `${a}|${b}`);
          assert.equal(ab.subindustryMapped, ba.subindustryMapped, `${a}|${b}`);

          const abOp = projectOperationalSubindustryVerdict(ab);
          const baOp = projectOperationalSubindustryVerdict(ba);
          assert.equal(abOp.subindustryMatch, baOp.subindustryMatch, `operativo ${a}|${b}`);
          assert.equal(abOp.subindustryMapped, baOp.subindustryMapped, `operativo ${a}|${b}`);

          for (const base of BASE_SECTOR_STATES) {
            assert.equal(
              foldSubindustryPrecisionIntoSectorState(base, ab),
              foldSubindustryPrecisionIntoSectorState(base, ba),
              `pliegue ${a}|${b} desde ${base}`,
            );
          }

          const subindustryConditionOf = (assessment: ApolloSubindustryPrecisionAssessment) =>
            evaluateCandidateSubindustryTargetEligibility({
              persistenceSuccess: true,
              sectorEvidenceState: 'sector_evidence_confirmed',
              requestedSubindustries: [a, b],
              subindustryPrecision: assessment,
              employeeCountStatus: 'confirmed',
              linkedinStatus: 'confirmed',
              duplicateStatus: null,
              ownershipGate: 'pass',
              qualityGate: 'pass',
            }).conditionStates.subindustry_match;
          assert.equal(
            subindustryConditionOf(ab),
            subindustryConditionOf(ba),
            `objetivo ${a}|${b}`,
          );
        }
      }
    }
  });

  test('§ 20 · el ORDEN del registro no decide nada', () => {
    const forward = listSubindustryPrecisionRuleSets();
    const reversed = [...forward].reverse();
    const fixture = result('Empresa Neutra', { industry: 'food production' });

    for (const spec of WAVE_1) {
      const a = assessApolloSubindustryPrecision(fixture, spec.name, { ruleSets: forward });
      const b = assessApolloSubindustryPrecision(fixture, spec.name, { ruleSets: reversed });
      assert.equal(a.subindustryMatch, b.subindustryMatch, spec.name);
      assert.equal(
        projectOperationalSubindustryVerdict(a, { ruleSets: forward }).subindustryMatch,
        projectOperationalSubindustryVerdict(b, { ruleSets: reversed }).subindustryMatch,
        spec.name,
      );
    }
  });
});

// ─── § 22 · las dos reglas `full` no se movieron ──────────────────────────────

describe('§ 22 · las dos reglas históricas conservan sus decisiones', () => {
  test('Supermercados: confirma, rechaza y duda exactamente como antes', () => {
    const confirmed = assessApolloSubindustryPrecision(
      result('Empresa Neutra', { industry: 'retail', keywords: ['supermercado'] }),
      SUPERMARKETS,
    );
    assert.equal(confirmed.subindustryMatch, 'confirmed');
    assert.equal(confirmed.verdictReason, 'anchor_evidence_confirmed');

    const wholesale = assessApolloSubindustryPrecision(
      result('Empresa Neutra', { keywords: ['wholesale distributor', 'supermercado'] }),
      SUPERMARKETS,
    );
    assert.equal(wholesale.subindustryMatch, 'rejected');
    assert.equal(wholesale.verdictReason, 'excluded_business_model');

    const delivery = assessApolloSubindustryPrecision(
      result('Empresa Neutra', { keywords: ['grocery delivery', 'supermercado'] }),
      SUPERMARKETS,
    );
    assert.equal(delivery.subindustryMatch, 'ambiguous');
    assert.equal(delivery.verdictReason, 'conflicting_business_model_with_anchor');

    const broad = assessApolloSubindustryPrecision(
      result('Empresa Neutra', { industry: 'retail' }),
      SUPERMARKETS,
    );
    assert.equal(broad.subindustryMatch, 'ambiguous');
    assert.equal(broad.verdictReason, 'broad_industry_only');
  });

  test('Tiendas por Departamento: las tres familias y la contradicción', () => {
    for (const [keyword, family] of [
      ['department store', 'department_store'],
      ['moda', 'fashion_apparel'],
      ['tienda de calzado', 'footwear'],
    ] as const) {
      const assessment = assessApolloSubindustryPrecision(
        result('Empresa Neutra', { keywords: [keyword] }),
        DEPARTMENT,
      );
      assert.equal(assessment.subindustryMatch, 'confirmed', keyword);
      assert.equal(assessment.subindustryMatchFamily, family, keyword);
    }

    const contradicted = assessApolloSubindustryPrecision(
      result('Empresa Neutra', { industry: 'food production' }),
      DEPARTMENT,
    );
    assert.equal(contradicted.subindustryMatch, 'rejected');
    assert.equal(contradicted.verdictReason, 'declared_industry_contradicts');
  });

  test('en `full` el veredicto operativo sigue siendo el diagnóstico', () => {
    for (const name of SELLUP_SUBINDUSTRIES_WITH_PRECISION_FULL) {
      for (const metadata of [
        {},
        { industry: 'retail' },
        { keywords: ['supermercado'] },
        { keywords: ['department store'] },
        { industry: 'banking' },
        { industry: 'food production' },
      ]) {
        const assessment = assessApolloSubindustryPrecision(result('Empresa Neutra', metadata), name);
        const operational = projectOperationalSubindustryVerdict(assessment);
        assert.equal(operational.subindustryMapped, assessment.subindustryMapped);
        assert.equal(operational.subindustryMatch, assessment.subindustryMatch);
        assert.equal(operational.precisionMode, 'full');
      }
    }
  });
});

// ─── § 24 · observabilidad ────────────────────────────────────────────────────

describe('§ 24 · una corrida live se podrá analizar para decidir la promoción a `full`', () => {
  test('el metadata persistido conserva diagnóstico, evidencia, fuente y motivo', () => {
    const assessment = assessApolloSubindustryPrecisionForRequest(
      result('Empresa Neutra', { industry: 'banking' }),
      ['Banca Tradicional', SUPERMARKETS],
    );
    const metadata = toApolloSubindustryPrecisionMetadata(assessment);

    // Qué subindustria ganó y qué la confirmó.
    assert.equal(metadata.matched_requested_subindustry, 'Banca Tradicional');
    assert.equal(metadata.subindustry_match, 'confirmed');
    assert.equal(metadata.verdict_reason, 'anchor_evidence_confirmed');
    assert.equal(metadata.classification_source, 'provider_industry');
    // La SEÑAL exacta y el campo donde se leyó: es lo que permite auditar un
    // confirmado sin volver a llamar al proveedor.
    assert.deepEqual(metadata.subindustry_evidence, [
      { term: 'banking', field: 'industry', source: 'provider_industry' },
    ]);

    // El veredicto de CADA subindustria pedida, no sólo el ganador: sin esto no se
    // puede saber por qué una selección quedó fuera.
    const perRequested = metadata.per_requested_subindustry_evaluations as {
      requested_subindustry: string;
      subindustry_match: string;
      subindustry_mapped: boolean;
      verdict_reason: string;
    }[];
    assert.equal(perRequested.length, 2);
    const byName = new Map(perRequested.map((item) => [item.requested_subindustry, item]));
    assert.equal(byName.get('Banca Tradicional')?.subindustry_match, 'confirmed');
    // La `full` de al lado quedó RECHAZADA y el diagnóstico lo conserva.
    assert.equal(byName.get(SUPERMARKETS)?.subindustry_match, 'rejected');
    assert.equal(byName.get(SUPERMARKETS)?.verdict_reason, 'declared_industry_contradicts');
  });

  test('las tres ramas del DIAGNÓSTICO siguen distinguibles en una `confirm_only`', () => {
    const branches: [string, Record<string, unknown>][] = [
      ['confirmed', { industry: 'banking' }],
      ['ambiguous', { industry: 'financial services' }],
      ['rejected', { industry: 'insurance' }],
    ];
    for (const [expected, metadata] of branches) {
      const assessment = assessApolloSubindustryPrecision(
        result('Empresa Neutra', metadata),
        'Banca Tradicional',
      );
      // Si el diagnóstico se colapsara a `unmapped`, la regla sería inobservable y no
      // habría forma de decidir su promoción.
      assert.equal(assessment.subindustryMatch, expected);
      assert.equal(
        toApolloSubindustryPrecisionMetadata(assessment).subindustry_match,
        expected,
      );
      assert.equal(assessment.subindustryMapped, true);
    }
  });

  test('contribución OPERATIVA y modo son legibles por el productor del veredicto', () => {
    const confirmed = assessApolloSubindustryPrecision(
      result('Empresa Neutra', { industry: 'banking' }),
      'Banca Tradicional',
    );
    const abstained = assessApolloSubindustryPrecision(
      result('Empresa Neutra', { industry: 'financial services' }),
      'Banca Tradicional',
    );
    assert.equal(projectOperationalSubindustryVerdict(confirmed).precisionMode, 'confirm_only');
    // Abstención: no contribuye, y el modo es `null` porque ninguna regla contribuyó.
    assert.equal(projectOperationalSubindustryVerdict(abstained).precisionMode, null);
  });

  test('§ 24 · `precision_mode` NO se persiste, y es deliberado', () => {
    // El modo de una regla es code-owned y vive en el registro versionado en git.
    // Persistirlo en el metadata crearía un SEGUNDO source of truth que podría
    // divergir del registro tras una promoción a `full`, y además rompería la
    // paridad byte a byte que el § 22 exige de las dos reglas históricas.
    //
    // No hace falta para analizar una corrida: el metadata ya nombra la regla que
    // confirmó (`matched_requested_subindustry`) y su veredicto diagnóstico, y el
    // modo se lee del registro.
    const metadata = toApolloSubindustryPrecisionMetadata(
      assessApolloSubindustryPrecision(result('Empresa Neutra', { industry: 'banking' }), 'Banca Tradicional'),
    );
    assert.equal('precision_mode' in metadata, false);
    assert.equal('precisionMode' in metadata, false);
  });
});
