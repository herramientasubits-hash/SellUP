/**
 * Compact Context Builder — Hotfix 16AB.24.5
 *
 * Separa el contexto ensamblado en:
 *   - modelContext:          payload compacto para Claude (reglas model + combined críticas)
 *   - internalPolicyContext: reglas code + gates completos (no se envían al modelo)
 *
 * Realiza consolidación determinística de reglas semánticamente equivalentes.
 * No llama APIs externas. Sin `any`.
 */

import type {
  ContextRule,
  CompactContextRule,
  ModelContextBlock,
  InternalPolicyContext,
  CompactCountryContext,
  CompactIndustryContext,
  CompactEvidencePolicy,
  CompactOutputSchema,
  RulePriority,
} from './types';
import { loadEvidencePolicy } from './context-loader';

// ─── Reglas code-layer: no se expanden en el payload del modelo ───────────────

export const CODE_LAYER_RULE_IDS = new Set<string>([
  'IDENTITY_004',
  'EVIDENCE_005',
  'OUTPUT_002',
  'OUTPUT_003',
]);

// ─── Mapa de consolidación: ruleId canónico → ruleIds absorbidos ──────────────
//
// Criterio: reglas con obligación semántica equivalente que pueden unificarse
// sin perder severidad ni fuentes.
//
// "No inventar datos"          GLOBAL_001 ← GATE_004
// "Evidencia debe ser auditable" EVIDENCE_002 ← GATE_003

export const CONSOLIDATION_MAP: Record<string, string[]> = {
  GLOBAL_001: ['GATE_004'],
  EVIDENCE_002: ['GATE_003'],
};

// ─── Prioridad más alta entre dos ────────────────────────────────────────────

const PRIORITY_ORDER: Record<RulePriority, number> = {
  blocking: 0,
  high: 1,
  medium: 2,
  normal: 3,
};

function highestPriority(a: RulePriority, b: RulePriority): RulePriority {
  return PRIORITY_ORDER[a] <= PRIORITY_ORDER[b] ? a : b;
}

// ─── ContextRule → CompactContextRule ────────────────────────────────────────

function toCompact(rule: ContextRule): CompactContextRule {
  return {
    ruleId: rule.ruleId,
    ruleSummary: rule.ruleSummary,
    executionLayer: rule.executionLayer,
    priority: rule.priority,
    sourceRefs: [{ sourceDocument: rule.sourceDocument, sourceSection: rule.sourceSection }],
  };
}

// ─── Consolidación determinística de reglas ──────────────────────────────────

export function consolidateRules(rules: CompactContextRule[]): CompactContextRule[] {
  const byId = new Map<string, CompactContextRule>();
  for (const r of rules) {
    byId.set(r.ruleId, { ...r, sourceRefs: [...r.sourceRefs] });
  }

  for (const [canonical, toAbsorb] of Object.entries(CONSOLIDATION_MAP)) {
    const canonicalRule = byId.get(canonical);
    if (!canonicalRule) continue;

    for (const absorbId of toAbsorb) {
      const absorbed = byId.get(absorbId);
      if (!absorbed) continue;

      const seenSources = new Set(
        canonicalRule.sourceRefs.map((s) => `${s.sourceDocument}||${s.sourceSection}`),
      );
      for (const ref of absorbed.sourceRefs) {
        const key = `${ref.sourceDocument}||${ref.sourceSection}`;
        if (!seenSources.has(key)) {
          canonicalRule.sourceRefs.push({ ...ref });
          seenSources.add(key);
        }
      }

      canonicalRule.mergedRuleIds = [
        ...(canonicalRule.mergedRuleIds ?? []),
        absorbId,
        ...(absorbed.mergedRuleIds ?? []),
      ];

      canonicalRule.priority = highestPriority(canonicalRule.priority, absorbed.priority);

      byId.delete(absorbId);
    }
  }

  return [...byId.values()];
}

// ─── Resultado de reglas semánticas ──────────────────────────────────────────

export type ModelRulesResult = {
  modelRules: CompactContextRule[];
  codeLayerRules: ContextRule[];
  mergedRules: Array<{ canonical: string; absorbed: string[] }>;
};

export function buildModelSemanticRules(allRules: ContextRule[]): ModelRulesResult {
  const codeLayerRules = allRules.filter((r) => CODE_LAYER_RULE_IDS.has(r.ruleId));

  const modelPayloadRules = allRules
    .filter((r) => !CODE_LAYER_RULE_IDS.has(r.ruleId))
    .map(toCompact);

  const consolidated = consolidateRules(modelPayloadRules);

  const mergedRules = consolidated
    .filter((r) => r.mergedRuleIds && r.mergedRuleIds.length > 0)
    .map((r) => ({ canonical: r.ruleId, absorbed: r.mergedRuleIds! }));

  return { modelRules: consolidated, codeLayerRules, mergedRules };
}

// ─── Contexto de país compacto ────────────────────────────────────────────────

function buildCompactCountryContext(countryProfile: unknown): CompactCountryContext {
  const p = (countryProfile ?? {}) as Record<string, unknown>;
  const geo = (p['geographic_context'] ?? {}) as Record<string, unknown>;

  const sources = (p['country_sources'] as Array<Record<string, unknown>>) ?? [];
  const keySources = sources
    .filter((s) => s['authority'] === 'high')
    .map((s) => s['source_name'] as string);

  return {
    country: (p['country_name'] as string) ?? 'Colombia',
    country_code: (p['country_code'] as string) ?? 'CO',
    key_sources: keySources,
    tech_hubs: (geo['main_tech_hubs'] as string[]) ?? [],
  };
}

// ─── Contexto de industria compacto ──────────────────────────────────────────

function buildCompactIndustryContext(industryProfile: unknown): CompactIndustryContext {
  const p = (industryProfile ?? {}) as Record<string, unknown>;

  return {
    industry: (p['industry_name'] as string) ?? 'Tecnología',
    definition: (p['operative_definition'] as string) ?? '',
    included_subsegments: (p['included_subsegments'] as string[]) ?? [],
    excluded_subsegments: (p['excluded_subsegments'] as string[]) ?? [],
    misclassification_risks: (p['misclassification_risks'] as string[]) ?? [],
    ubits_fit_signals: (p['ubits_fit_signals'] as string[]) ?? [],
    fit_language_rule: (p['fit_language_rule'] as string) ?? '',
  };
}

// ─── Política de evidencia compacta ──────────────────────────────────────────

function buildCompactEvidencePolicy(evidencePolicy: unknown): CompactEvidencePolicy {
  const p = (evidencePolicy ?? {}) as Record<string, unknown>;
  const matrix = (p['state_confidence_matrix'] ?? {}) as Record<string, unknown>;
  const forbidden = (matrix['forbidden'] as string[]) ?? [];
  const origin = (p['evidence_origin_policy'] ?? {}) as Record<string, string[]>;

  return {
    validation_states: (p['validation_states'] as Record<string, string>) ?? {},
    confidence_levels: (p['confidence_levels'] as Record<string, string>) ?? {},
    forbidden_combinations: forbidden,
    evidence_origin: {
      allowed: origin['allowed_for_strong_evidence'] ?? [],
      not_allowed: origin['not_allowed_for_strong_evidence'] ?? [],
    },
    minimum_evidence: (p['minimum_evidence_for_verification'] as Record<string, string>) ?? {},
    size_ranges: (p['size_ranges_normalized'] as string[]) ?? [],
  };
}

// ─── Schema de output compacto ────────────────────────────────────────────────

function buildCompactOutputSchema(): CompactOutputSchema {
  return {
    fields: {
      candidate_name: 'string',
      'identity.status': 'verified|supported|conflicting|not_found',
      'identity.commercial_name': 'nombre público/marca — nunca razón social como campo principal',
      'identity.legal_name': '{value:string|null,status:verified|supported|not_found,evidence_urls:[]}',
      'identity.official_website': 'URL literal completa o null',
      'identity.linkedin_company_url': 'https://www.linkedin.com/company/... o null',
      'colombia_operation.status': 'verified|supported|estimated|conflicting|not_found',
      'colombia_operation.primary_city': 'string|null',
      'colombia_operation.other_cities': 'string[]',
      technology_b2b_fit: '{status,subsegment:string|null,reason:string,evidence_urls:[]}',
      'size.value': '1-10|11-50|51-200|201-500|501-1.000|1.001-5.000|5.001-10.000|10.000+|null',
      'size.status': 'verified|supported|estimated|not_found',
      'size.scope': 'colombia|legal_entity|global_group|unknown|null',
      'company_facts.incorporation_date': 'YYYY-MM-DD o null — nunca YYYY-01-01',
      'company_facts.incorporation_year': 'entero>=1800 o null',
      ubits_fit: '{signals:string[],status:present|not_found}',
      conflicts: 'string[]',
      missing_information: 'string[]',
      audit_status: 'eligible_auditable|eligible_partially_auditable|requires_review|rejected',
      confidence: 'Alta|Media|Baja',
      eligibility: 'eligible_auditable|eligible_partially_auditable|requires_review|rejected',
      primary_evidence_url: 'URL literal completa o null',
      notes: 'razón social cuando difiere; otras ciudades; scope del tamaño; fecha constitución; conflictos',
    },
    key_constraints: [
      'commercial_name es la marca pública. legal_name es la razón social oficial (RUES) — pueden diferir.',
      'primary_city es la ciudad Colombia donde opera la entidad investigada, no del grupo global.',
      'size.scope: colombia=empleados locales, legal_entity=entidad legal, global_group=grupo completo.',
      'incorporation_date: YYYY-MM-DD exacto. Si solo se conoce el año → usar incorporation_year (entero), dejar date=null.',
      'No inventar datos faltantes. Usar not_found o null cuando no hay evidencia suficiente.',
    ],
  };
}

// ─── Bloque de contexto principal para el modelo ─────────────────────────────

export function buildModelContext(
  countryProfile: unknown,
  industryProfile: unknown,
  allRules: ContextRule[],
): ModelContextBlock {
  const evidencePolicy = loadEvidencePolicy();
  const { modelRules } = buildModelSemanticRules(allRules);

  return {
    objective:
      'Verifica empresa candidata para SellUp en modo validation. País: Colombia. Industria: Tecnología B2B. Responde únicamente con el JSON del contrato de verificación.',
    semanticRules: modelRules,
    codeLayerInstruction:
      'La salida será sometida a validaciones determinísticas de schema, URLs, LinkedIn, fechas, duplicidad, evidencia y elegibilidad. No intentes eludir ni reinterpretar esos controles.',
    countryContext: buildCompactCountryContext(countryProfile),
    industryContext: buildCompactIndustryContext(industryProfile),
    evidencePolicy: buildCompactEvidencePolicy(evidencePolicy),
    outputSchema: buildCompactOutputSchema(),
  };
}

// ─── Contexto de política interno (no enviado al modelo) ─────────────────────

export function buildInternalPolicyContext(
  allRules: ContextRule[],
  countryProfile: unknown,
  evidencePolicyRaw: unknown,
): InternalPolicyContext {
  const codeLayerRules = allRules.filter((r) => CODE_LAYER_RULE_IDS.has(r.ruleId));
  const ep = (evidencePolicyRaw ?? {}) as Record<string, unknown>;
  const country = (countryProfile ?? {}) as Record<string, unknown>;

  return {
    codeLayerRules,
    fullCountrySources: country['country_sources'] ?? [],
    fullEligibilityGates: ep['eligibility_gates'] ?? {},
    fullStateMatrix: ep['state_confidence_matrix'] ?? {},
  };
}
