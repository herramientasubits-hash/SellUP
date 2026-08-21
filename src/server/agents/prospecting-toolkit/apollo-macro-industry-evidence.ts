/**
 * apollo-macro-industry-evidence.ts — ¿La evidencia que el PROVEEDOR entregó
 * demuestra que esta empresa pertenece a la macro industria pedida?
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 10, 12, 19 y 24.
 *
 * ── Qué NO es evidencia, y por qué ────────────────────────────────────────────
 *
 * Tres cosas quedan fuera a propósito, cada una porque convertirla en prueba
 * cerraría el círculo sobre sí mismo:
 *
 *   1. **La macro industria PEDIDA.** Pedir «Salud & Farmacéuticos» es la
 *      pregunta, no la respuesta. Si bastara con pedirla, toda empresa devuelta
 *      quedaría confirmada y el gate no filtraría nada. Esta función no recibe
 *      ninguna señal de intención: recibe el candidato y la DEFINICIÓN de la
 *      macro industria, y sólo lee del candidato.
 *
 *   2. **Los términos de la consulta.** Apollo devuelve una empresa porque
 *      coincidió con la consulta; leer esa coincidencia como confirmación es
 *      afirmar el consecuente. Ningún término de consulta entra aquí: las
 *      cubetas que se usan son las de `evidence`, distintas de las de
 *      `discovery` (ver `macro-industries.ts`).
 *
 *   3. **El nombre y el dominio de la empresa.** `title`, `snippet` y `domain`
 *      están excluidos por la misma razón que en el gate sectorial: el nombre de
 *      una empresa no dice de forma fiable a qué industria pertenece, y usar su
 *      ausencia como señal rechazaría a todo candidato cuyo nombre no se
 *      autodescriba.
 *
 * ── Y tampoco es precisión de subindustria (§ 24) ─────────────────────────────
 *
 * Este módulo no importa, no llama y no imita a `apollo-subindustry-precision`.
 * No hay ninguna rama del tipo «si la macro industria es Salud, evalúa todas las
 * reglas de subindustria de Salud». Son dos planos distintos: la precisión juzga
 * una hija concreta que el usuario pidió; esto juzga la pertenencia al padre.
 *
 * ── Fail-closed (§ 12) ────────────────────────────────────────────────────────
 *
 * Sólo `confirmed` admite. `ambiguous` no admite, `rejected` no admite, y una
 * macro industria que este código no reconoce tampoco admite. La ausencia de
 * evidencia es `ambiguous`, nunca `confirmed`: el proveedor que no dijo nada no
 * ha demostrado nada.
 *
 * Puro: sin I/O, sin env, sin reloj, sin llamadas al proveedor.
 */

import type { WebSearchResult } from './types';
import {
  getMacroIndustryByKey,
  resolveMacroIndustryByDisplayName,
  type MacroIndustryDefinition,
} from '@/modules/macro-industry-catalog/macro-industries';
// AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 § 5 — la DECISIÓN (exclusión → confirmación
// → padre solo → rechazo medido) vive ahora en el núcleo proveedor-neutral del
// catálogo, y la ruta Lusha la reutiliza sin copiar una segunda taxonomía. Aquí
// queda lo único que era de Apollo: de qué campos salen las dos listas de texto.
import {
  MACRO_INDUSTRY_EVIDENCE_VERSION,
  assessDeclaredMacroIndustryEvidence,
  unresolvedMacroIndustryEvidence,
  type MacroIndustryEvidenceAssessment,
  type MacroIndustryEvidenceReason,
  type MacroIndustryEvidenceVerdict,
} from '@/modules/macro-industry-catalog/macro-industry-evidence-core';

// ─── Versión ──────────────────────────────────────────────────────────────────

/**
 * Se re-exporta el identificador del núcleo neutral en lugar de escribir otro:
 * dos constantes con el mismo valor podrían separarse, y la metadata de un
 * candidato dejaría de decir qué regla lo juzgó.
 */
export const APOLLO_MACRO_INDUSTRY_EVIDENCE_VERSION = MACRO_INDUSTRY_EVIDENCE_VERSION;

// ─── Contrato (re-exportado del núcleo neutral) ───────────────────────────────

export type {
  MacroIndustryEvidenceVerdict,
  MacroIndustryEvidenceReason,
  MacroIndustryEvidenceAssessment,
};

// ─── Extracción de evidencia DECLARADA ────────────────────────────────────────

function pushIfString(target: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim() !== '') target.push(value);
}

function pushIfStringArray(target: string[], value: unknown): void {
  if (Array.isArray(value)) for (const item of value) pushIfString(target, item);
}

/**
 * Industrias que el proveedor DECLARA para la empresa.
 *
 * Sólo campos de industria. Ni keywords ni descripciones: la descripción de un
 * hospital real menciona con frecuencia «servicios financieros» (facturación,
 * convenios de crédito) y leer eso como industria declarada lo excluiría de
 * Salud por una frase de su web.
 */
function collectDeclaredIndustries(result: WebSearchResult): string[] {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return [];

  const industries: string[] = [];
  pushIfString(industries, meta['industry']);

  const profile = meta['apollo_profile'] as Record<string, unknown> | undefined;
  if (profile) {
    pushIfString(industries, profile['industry']);
    pushIfStringArray(industries, profile['industries']);
  }
  return industries;
}

/**
 * Todo el texto con carga clasificatoria: industrias + keywords + descripciones.
 *
 * Es donde se buscan los términos confirmatorios, porque en LATAM la prueba más
 * fuerte suele venir en `keywords` en español («clínica», «ingenio azucarero»)
 * mientras `industry` trae la categoría amplia de Apollo en inglés.
 */
function collectClassificationText(result: WebSearchResult): {
  text: string[];
  fields: string[];
} {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return { text: [], fields: [] };

  const parts: string[] = [];
  const fields: string[] = [];

  const takeString = (value: unknown, field: string) => {
    if (typeof value === 'string' && value.trim() !== '') {
      parts.push(value);
      fields.push(field);
    }
  };
  const takeArray = (value: unknown, field: string) => {
    if (Array.isArray(value)) {
      const strings = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
      if (strings.length > 0) {
        parts.push(...strings);
        fields.push(field);
      }
    }
  };

  takeString(meta['industry'], 'industry');
  takeArray(meta['keywords'], 'keywords');
  takeString(meta['short_description'], 'short_description');

  const profile = meta['apollo_profile'] as Record<string, unknown> | undefined;
  if (profile) {
    takeString(profile['industry'], 'apollo_profile.industry');
    takeArray(profile['industries'], 'apollo_profile.industries');
    takeArray(profile['keywords'], 'apollo_profile.keywords');
    takeArray(profile['organization_keywords'], 'apollo_profile.organization_keywords');
    takeString(profile['short_description'], 'apollo_profile.short_description');
    takeString(profile['seo_description'], 'apollo_profile.seo_description');
    takeString(profile['description'], 'apollo_profile.description');
  }

  // Las partes viajan CRUDAS: normalizar aquí y otra vez en el núcleo sería la
  // misma operación hecha dos veces, y sólo una de las dos sería la autoritativa.
  return { text: parts, fields };
}

// ─── Evaluación ───────────────────────────────────────────────────────────────

export type MacroIndustryEvidenceInput = {
  result: WebSearchResult;
  /**
   * La macro industria pedida, por clave canónica o por nombre visible exacto.
   * El pipeline de descubrimiento sólo tiene el nombre canónico del catálogo
   * (`input.industry`), así que se aceptan ambos y se resuelven a la MISMA
   * definición.
   */
  macroIndustryKey?: string | null;
  macroIndustryDisplayName?: string | null;
  /** Inyección para pruebas. Producción lo omite. */
  definitionOverride?: MacroIndustryDefinition | null;
};

/**
 * Evalúa la evidencia macro de UN candidato de Apollo.
 *
 * Extrae las dos listas de texto de la forma propia de Apollo y delega la
 * DECISIÓN en el núcleo neutral del catálogo. El orden de las reglas, los motivos
 * y el resultado son los mismos que antes de la extracción.
 *
 * Puro.
 */
export function assessMacroIndustryEvidence(
  input: MacroIndustryEvidenceInput,
): MacroIndustryEvidenceAssessment {
  const definition =
    input.definitionOverride ??
    getMacroIndustryByKey(input.macroIndustryKey) ??
    resolveMacroIndustryByDisplayName(input.macroIndustryDisplayName);

  if (!definition) return unresolvedMacroIndustryEvidence();

  const { text, fields } = collectClassificationText(input.result);

  return assessDeclaredMacroIndustryEvidence(definition, {
    declaredIndustries: collectDeclaredIndustries(input.result),
    classificationText: text,
    providerEvidenceFields: fields,
  });
}

// ─── Proyección a metadata ────────────────────────────────────────────────────

/** Bloque plano y sin PII para la metadata del candidato. */
export function toMacroIndustryEvidenceMetadata(
  assessment: MacroIndustryEvidenceAssessment,
): Record<string, unknown> {
  return {
    macro_industry_evidence_version: assessment.version,
    macro_industry_key: assessment.macroIndustryKey,
    macro_industry_evidence_verdict: assessment.verdict,
    macro_industry_evidence_reason: assessment.reason,
    macro_industry_matched_confirming_terms: assessment.matchedConfirmingTerms,
    macro_industry_matched_parent_industries: assessment.matchedParentIndustries,
    macro_industry_matched_excluding_industries: assessment.matchedExcludingIndustries,
    macro_industry_provider_evidence_fields: assessment.providerEvidenceFields,
    macro_industry_declared_industry_present: assessment.declaredIndustryPresent,
  };
}
