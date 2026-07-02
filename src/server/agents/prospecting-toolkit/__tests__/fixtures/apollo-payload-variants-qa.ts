/**
 * Fixtures — Payload variants para QA real Apollo Organization Search
 *
 * Los 3 variants se enviarán en el próximo QA real para comparar
 * precision y recall de Apollo según los keyword tags usados.
 *
 * Contexto:
 *   - Apollo indexa keywords bajo q_organization_keyword_tags[] (L2.11-A).
 *   - Tags largos ("learning management system") son más específicos pero
 *     Apollo puede no tenerlos indexados exactamente → menos resultados.
 *   - Tags cortos ("lms", "edtech") tienen mayor cobertura en Apollo pero
 *     más ruido potencial → el sector gate filtra el ruido post-API.
 *   - Tags corporativos ("corporate training", "training platform") apuntan
 *     al buyer de SellUp (empresa que entrena a sus empleados), no al
 *     proveedor de formación.
 *
 * Caso de uso: Búsqueda para sector Educación / subindustria "educacion corporativa"
 *             en Colombia, empresas de 100-10000 empleados.
 *
 * Metadata:
 *   Cada variant incluye `qa_variant_id` para identificarlo en los logs de
 *   la búsqueda. El runner debe propagar este campo en apollo_search_metadata
 *   para poder comparar resultados entre variants en post-análisis.
 */

import type { SearchOrganizationsParams } from '@/server/integrations/apollo-client';

// ─── Constantes comunes ───────────────────────────────────────────────────────

const COLOMBIA_LOCATION = 'Colombia';
const TARGET_EMPLOYEE_RANGE = '100,10000';
const PER_PAGE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Variant A — Tags actuales (L2.11-A / subindustry educacion corporativa)
//
// Origen: SUBINDUSTRY_KEYWORD_MAP['educacion corporativa'].slice(0,5)
// Hipótesis: son los más descriptivos del producto SellUp pero pueden
//            ser demasiado específicos para el índice de Apollo.
// Expectativa: resultados más precisos pero posiblemente menos cantidad.
// ─────────────────────────────────────────────────────────────────────────────

export const VARIANT_A_TAGS: string[] = [
  'corporate training',
  'corporate learning',
  'learning management system',
  'lms',
  'workforce training',
];

export const VARIANT_A: SearchOrganizationsParams & { qa_variant_id: string } = {
  qa_variant_id: 'variant_a_current_tags',
  q_organization_keyword_tags: VARIANT_A_TAGS,
  organization_locations: [COLOMBIA_LOCATION],
  organization_num_employees_ranges: [TARGET_EMPLOYEE_RANGE],
  per_page: PER_PAGE,
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant B — Tags cortos (máxima cobertura en índice Apollo)
//
// Hipótesis: Apollo indexa tokens cortos con mayor frecuencia que frases.
//            "lms" matchea más que "learning management system".
//            "edtech" captura startups de formación no cubiertas por Variant A.
// Expectativa: más resultados crudos, más ruido → el sector gate filtrará más.
//              Si el ratio pass/total del gate mejora → B > A para recall.
// ─────────────────────────────────────────────────────────────────────────────

export const VARIANT_B_TAGS: string[] = [
  'lms',
  'e-learning',
  'edtech',
  'elearning',
  'learning',
];

export const VARIANT_B: SearchOrganizationsParams & { qa_variant_id: string } = {
  qa_variant_id: 'variant_b_short_tags',
  q_organization_keyword_tags: VARIANT_B_TAGS,
  organization_locations: [COLOMBIA_LOCATION],
  organization_num_employees_ranges: [TARGET_EMPLOYEE_RANGE],
  per_page: PER_PAGE,
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant C — Tags orientados al buyer corporativo (empresa que compra formación)
//
// Hipótesis: el ICP de SellUp no es el proveedor de formación (Platzi, CognosOnline)
//            sino la empresa grande que contrata formación para sus empleados.
//            Tags "corporate training", "training platform", "capacitacion" apuntan
//            a ese perfil (HR de banco, telco, manufactura que busca LMS externo).
// Expectativa: resultados más alineados con el buyer → menos falsos positivos
//              de proveedores (edtech) y más potenciales compradores.
// ─────────────────────────────────────────────────────────────────────────────

export const VARIANT_C_TAGS: string[] = [
  'corporate training',
  'training platform',
  'capacitacion empresarial',
  'workforce development',
  'employee training',
];

export const VARIANT_C: SearchOrganizationsParams & { qa_variant_id: string } = {
  qa_variant_id: 'variant_c_corporate_buyer',
  q_organization_keyword_tags: VARIANT_C_TAGS,
  organization_locations: [COLOMBIA_LOCATION],
  organization_num_employees_ranges: [TARGET_EMPLOYEE_RANGE],
  per_page: PER_PAGE,
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports para uso en tests comparativos y en el runner de QA real
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_QA_VARIANTS = [VARIANT_A, VARIANT_B, VARIANT_C] as const;

export type QaVariantId =
  | 'variant_a_current_tags'
  | 'variant_b_short_tags'
  | 'variant_c_corporate_buyer';

/**
 * Descripción legible de cada variant para incluir en logs de diagnóstico.
 */
export const QA_VARIANT_DESCRIPTIONS: Record<QaVariantId, string> = {
  variant_a_current_tags:
    'Tags actuales (L2.11-A): corporate training + lms + workforce training. ' +
    'Específicos pero posiblemente sub-indexados en Apollo.',
  variant_b_short_tags:
    'Tags cortos: lms + e-learning + edtech + learning. ' +
    'Mayor cobertura de índice, más ruido esperado post-gate.',
  variant_c_corporate_buyer:
    'Tags orientados al buyer: corporate training + training platform + employee training. ' +
    'Apunta a empresa compradora de formación, no al proveedor.',
};
