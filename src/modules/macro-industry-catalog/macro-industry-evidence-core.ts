/**
 * macro-industry-evidence-core.ts — el núcleo PROVEEDOR-NEUTRAL de «¿la evidencia
 * declarada demuestra pertenencia a esta macro industria?».
 *
 * AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 § 5.
 *
 * ── Por qué este módulo existe ────────────────────────────────────────────────
 *
 * La lógica vivía entera dentro de `apollo-macro-industry-evidence.ts`, mezclada
 * con la forma de los campos de Apollo (`apollo_profile.industry`, `keywords`,
 * `short_description`…). La decisión —exclusión primero, luego confirmación,
 * luego padre solo— NUNCA fue de Apollo: es del CATÁLOGO. Lo único de Apollo era
 * de qué campos se sacan las dos listas de texto.
 *
 * Al separar las dos mitades, la ruta Lusha puede reutilizar exactamente la misma
 * decisión sin copiar una segunda taxonomía —que es la prohibición explícita del
 * hito— y sin arrastrar el `WebSearchResult` de Apollo hasta
 * `src/server/prospect-batches`.
 *
 * 🔴 La extracción es 1:1. Este módulo no cambia ni un veredicto: el orden de las
 * cinco reglas, los motivos y los campos del resultado son los que Apollo ya
 * producía, y `apollo-macro-industry-evidence` los re-exporta para que ningún
 * llamador ni ninguna suite existente cambie de import.
 *
 * ── Lo que sigue quedando fuera, por las mismas razones ───────────────────────
 *
 * La macro industria PEDIDA, los términos de la CONSULTA, y el nombre/dominio de
 * la empresa. Ver la cabecera de `apollo-macro-industry-evidence.ts`: las tres
 * cierran el círculo sobre sí mismas y ninguna entra aquí.
 *
 * Puro: sin I/O, sin env, sin reloj, sin proveedor.
 */

import {
  normalizeMacroIndustryLabel,
  type MacroIndustryDefinition,
} from './macro-industries';

// ─── Versión ──────────────────────────────────────────────────────────────────

/**
 * Versión del contrato de evidencia. Se conserva el identificador histórico
 * (`v1.MIE-1`) a propósito: el veredicto no cambia, así que subirlo haría creer a
 * quien lea la metadata de un candidato que la regla se movió.
 */
export const MACRO_INDUSTRY_EVIDENCE_VERSION = 'v1.MIE-1';

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
  version: typeof MACRO_INDUSTRY_EVIDENCE_VERSION;
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

/**
 * La evidencia DECLARADA por un proveedor cualquiera, ya extraída de su forma
 * propia.
 *
 * Dos listas y no una porque las reglas las tratan distinto: la exclusión se mide
 * SÓLO contra industrias declaradas (la descripción de un hospital menciona
 * «servicios financieros» y lo expulsaría de Salud por una frase de su web),
 * mientras la confirmación se mide contra todo el texto con carga clasificatoria.
 */
export type DeclaredMacroIndustryEvidence = {
  /** Campos de INDUSTRIA declarados. Nunca keywords ni descripciones. */
  declaredIndustries: readonly string[];
  /** Todo el texto clasificatorio: industrias + keywords + descripciones. */
  classificationText: readonly string[];
  /** Nombres de los campos que el proveedor sí entregó. Sólo diagnóstico. */
  providerEvidenceFields: readonly string[];
};

// ─── Coincidencia de términos ─────────────────────────────────────────────────

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

// ─── Resultado fail-closed ────────────────────────────────────────────────────

/** Macro industria irresoluble ⇒ ambiguo. La ausencia nunca confirma. */
export function unresolvedMacroIndustryEvidence(): MacroIndustryEvidenceAssessment {
  return {
    version: MACRO_INDUSTRY_EVIDENCE_VERSION,
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

// ─── Evaluación ───────────────────────────────────────────────────────────────

/**
 * Evalúa la evidencia declarada contra UNA definición del catálogo macro.
 *
 * Orden de decisión, y por qué es ese:
 *
 *   1. **Exclusión primero**, por precedencia de substring. `retail` es substring
 *      de `retail banking`; comprobar primero lo confirmatorio dejaría entrar a
 *      la banca minorista en una búsqueda de Retail. La exclusión se mide SÓLO
 *      contra industrias declaradas.
 *   2. **Confirmación** sobre todo el texto clasificatorio.
 *   3. **Industria padre sola** ⇒ ambiguo. Contiene a la macro industria pero no
 *      la demuestra.
 *   4. **Industria declarada que no encaja** ⇒ rechazo medido.
 *   5. **Texto sin coincidencia** o **sin evidencia** ⇒ ambiguo.
 *
 * Puro.
 */
export function assessDeclaredMacroIndustryEvidence(
  definition: MacroIndustryDefinition,
  evidence: DeclaredMacroIndustryEvidence,
): MacroIndustryEvidenceAssessment {
  const declaredIndustries = evidence.declaredIndustries;
  const text = normalizeMacroIndustryLabel(evidence.classificationText.join(' '));

  const base: Pick<
    MacroIndustryEvidenceAssessment,
    'version' | 'macroIndustryKey' | 'providerEvidenceFields' | 'declaredIndustryPresent'
  > = {
    version: MACRO_INDUSTRY_EVIDENCE_VERSION,
    macroIndustryKey: definition.key,
    providerEvidenceFields: [...evidence.providerEvidenceFields],
    declaredIndustryPresent: declaredIndustries.length > 0,
  };

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
    reason:
      evidence.providerEvidenceFields.length > 0
        ? 'declared_evidence_without_match'
        : 'no_provider_evidence',
    matchedConfirmingTerms: [],
    matchedParentIndustries: [],
    matchedExcludingIndustries: [],
  };
}
