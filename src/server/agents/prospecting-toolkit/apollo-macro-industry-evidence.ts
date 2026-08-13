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
  normalizeMacroIndustryLabel,
  resolveMacroIndustryByDisplayName,
  type MacroIndustryDefinition,
} from '@/modules/macro-industry-catalog/macro-industries';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_MACRO_INDUSTRY_EVIDENCE_VERSION = 'v1.MIE-1';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Veredicto sobre la macro industria PEDIDA.
 *
 * `confirmed` La evidencia declarada por el proveedor prueba pertenencia.
 * `ambiguous` Hay indicios compatibles, o no hay evidencia. No prueba nada.
 * `rejected`  La industria declarada pertenece a otra macro industria.
 */
export type MacroIndustryEvidenceVerdict = 'confirmed' | 'ambiguous' | 'rejected';

/** Por qué salió ese veredicto. Códigos estáticos: sin nombres de empresa. */
export type MacroIndustryEvidenceReason =
  /** Un término confirmatorio apareció en un campo declarado por el proveedor. */
  | 'confirming_term_in_declared_evidence'
  /** La industria declarada está en la lista de exclusión de esta macro industria. */
  | 'excluding_industry_declared'
  /** Sólo apareció la industria PADRE: contiene a la macro industria sin demostrarla. */
  | 'parent_industry_only'
  /** El proveedor declaró una industria y no encaja en esta macro industria. */
  | 'declared_industry_outside_macro'
  /** El proveedor entregó texto clasificatorio pero nada coincidió. */
  | 'declared_evidence_without_match'
  /** El proveedor no entregó ningún campo con carga clasificatoria. */
  | 'no_provider_evidence'
  /** La macro industria pedida no existe en el catálogo. Fail-closed. */
  | 'macro_industry_unresolved';

export type MacroIndustryEvidenceAssessment = {
  version: typeof APOLLO_MACRO_INDUSTRY_EVIDENCE_VERSION;
  verdict: MacroIndustryEvidenceVerdict;
  reason: MacroIndustryEvidenceReason;
  /** Clave canónica evaluada. `null` cuando no se pudo resolver. */
  macroIndustryKey: string | null;
  /** Términos confirmatorios que coincidieron. Vacío salvo en `confirmed`. */
  matchedConfirmingTerms: string[];
  /** Industrias del padre que coincidieron. Diagnóstico; nunca confirman solas. */
  matchedParentIndustries: string[];
  /** Industrias excluyentes que coincidieron. No vacío ⇒ `rejected`. */
  matchedExcludingIndustries: string[];
  /** Campos con carga clasificatoria que el proveedor SÍ entregó. */
  providerEvidenceFields: string[];
  /** ¿El proveedor declaró alguna industria (no sólo keywords/descripciones)? */
  declaredIndustryPresent: boolean;
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
  text: string;
  fields: string[];
} {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return { text: '', fields: [] };

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

  return { text: normalizeMacroIndustryLabel(parts.join(' ')), fields };
}

function matchTerms(haystack: string, terms: readonly string[]): string[] {
  return terms.filter((term) => haystack.includes(normalizeMacroIndustryLabel(term)));
}

function matchIndustryTerms(
  declaredIndustries: readonly string[],
  terms: readonly string[],
): string[] {
  const normalized = declaredIndustries.map((industry) => normalizeMacroIndustryLabel(industry));
  return terms.filter((term) => {
    const needle = normalizeMacroIndustryLabel(term);
    return normalized.some((industry) => industry.includes(needle));
  });
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

function unresolved(): MacroIndustryEvidenceAssessment {
  return {
    version: APOLLO_MACRO_INDUSTRY_EVIDENCE_VERSION,
    verdict: 'ambiguous',
    reason: 'macro_industry_unresolved',
    macroIndustryKey: null,
    matchedConfirmingTerms: [],
    matchedParentIndustries: [],
    matchedExcludingIndustries: [],
    providerEvidenceFields: [],
    declaredIndustryPresent: false,
  };
}

/**
 * Evalúa la evidencia macro de UN candidato.
 *
 * Orden de decisión, y por qué es ese:
 *
 *   1. **Exclusión primero**, por precedencia de substring. `retail` es substring
 *      de `retail banking`; comprobar primero lo confirmatorio dejaría entrar a
 *      la banca minorista en una búsqueda de Retail — el modo de fallo de
 *      v1.16K-AC con otro nombre. La exclusión se mide SÓLO contra industrias
 *      declaradas, no contra descripciones.
 *   2. **Confirmación** sobre todo el texto clasificatorio.
 *   3. **Industria padre sola** ⇒ ambiguo. Contiene a la macro industria pero no
 *      la demuestra: es exactamente el estado que no puede admitir.
 *   4. **Industria declarada que no encaja** ⇒ rechazo medido.
 *   5. **Texto sin coincidencia** o **sin evidencia** ⇒ ambiguo.
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

  if (!definition) return unresolved();

  const declaredIndustries = collectDeclaredIndustries(input.result);
  const { text, fields } = collectClassificationText(input.result);

  const base = {
    version: APOLLO_MACRO_INDUSTRY_EVIDENCE_VERSION,
    macroIndustryKey: definition.key,
    providerEvidenceFields: fields,
    declaredIndustryPresent: declaredIndustries.length > 0,
  } as const;

  const matchedExcludingIndustries = matchIndustryTerms(
    declaredIndustries,
    definition.evidence.excludingIndustries,
  );
  if (matchedExcludingIndustries.length > 0) {
    return {
      ...base,
      verdict: 'rejected',
      reason: 'excluding_industry_declared',
      matchedConfirmingTerms: [],
      matchedParentIndustries: [],
      matchedExcludingIndustries,
    };
  }

  const matchedConfirmingTerms = matchTerms(text, definition.evidence.confirming);
  const matchedParentIndustries = matchIndustryTerms(
    declaredIndustries,
    definition.evidence.parentIndustries,
  );

  if (matchedConfirmingTerms.length > 0) {
    return {
      ...base,
      verdict: 'confirmed',
      reason: 'confirming_term_in_declared_evidence',
      matchedConfirmingTerms,
      matchedParentIndustries,
      matchedExcludingIndustries: [],
    };
  }

  if (matchedParentIndustries.length > 0) {
    return {
      ...base,
      verdict: 'ambiguous',
      reason: 'parent_industry_only',
      matchedConfirmingTerms: [],
      matchedParentIndustries,
      matchedExcludingIndustries: [],
    };
  }

  if (declaredIndustries.length > 0) {
    return {
      ...base,
      verdict: 'rejected',
      reason: 'declared_industry_outside_macro',
      matchedConfirmingTerms: [],
      matchedParentIndustries: [],
      matchedExcludingIndustries: [],
    };
  }

  return {
    ...base,
    verdict: 'ambiguous',
    reason: fields.length > 0 ? 'declared_evidence_without_match' : 'no_provider_evidence',
    matchedConfirmingTerms: [],
    matchedParentIndustries: [],
    matchedExcludingIndustries: [],
  };
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
