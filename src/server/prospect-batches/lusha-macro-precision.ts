/**
 * lusha-macro-precision.ts — ¿La industria que Lusha DECLARÓ prueba que esta
 * empresa pertenece a la macro industria pedida, POR LA RAMA que la trajo?
 *
 * AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 §§ 3, 4, 5, 7.
 *
 * ── El defecto de producción que este módulo cierra ───────────────────────────
 *
 * La primera corrida real de Macro-v2 (`health_pharma`, CO, 2026-08-19) persistió
 * nueve empresas para revisión y CINCO eran Manufacturing genérico: cervecera,
 * electrodomésticos, concesionario, astillero, cosmética. Ninguna es salud ni
 * farmacéutica. Dos causas encadenadas, y hay que verlas separadas porque
 * arreglar sólo la primera dejaba el defecto vivo con un aviso encima:
 *
 *   1. `industryMatches` comparaba en los DOS sentidos
 *      (`declarada.includes(palabra) || palabra.includes(declarada)`), así que
 *      `Manufacturing` «coincidía» con la palabra `Pharmaceuticals
 *      Manufacturing` porque la segunda contiene a la primera. Un padre amplio
 *      se confirmaba a sí mismo con el nombre de su hija.
 *   2. Aunque el desencaje se hubiera detectado, era BLANDO: resta 20 sobre 100
 *      y el umbral son 70, de modo que una empresa fuera de la macro seguía
 *      pasando con 80 y CERRANDO el objetivo de la corrida.
 *
 * De ahí que aquí haya una decisión de verdad —`confirmed` / `ambiguous` /
 * `rejected`— y no una resta de puntos.
 *
 * ── 🔴 No hay una segunda taxonomía Lusha ─────────────────────────────────────
 *
 * La evidencia sale del catálogo canónico y de ningún otro sitio:
 * `MACRO_INDUSTRIES[].evidence.{confirming,parentIndustries,excludingIndustries}`,
 * evaluadas por el MISMO núcleo neutral que juzga a Apollo
 * (`macro-industry-evidence-core`). Este módulo no añade ni una palabra clave
 * propia y no conoce ningún nombre de empresa.
 *
 * ── Lo único que Lusha aporta: la RAMA (§ 7) ──────────────────────────────────
 *
 * Una corrida Macro-v2 recupera por RAMAS, y la rama es una prueba en sí misma
 * —pero sólo de lo que la rama pidió—:
 *
 *   · Rama de main desnudo (`main 11 Healthcare` en `health_pharma`, `main 12
 *     Manufacturing` en `industry_manufacturing_chemicals_automotive`): el main
 *     ES la forma aprobada de la macro, así que una empresa que declara ese mismo
 *     main queda CONFIRMADA. Por eso Manufacturing no se rechaza globalmente.
 *   · Rama estrechada por sub (`main 12 + sub 71 Pharmaceuticals Manufacturing`):
 *     la etiqueta de la rama es la de la SUB. Que el proveedor devuelva sólo el
 *     padre genérico (`Manufacturing`) NO demuestra la sub — es exactamente el
 *     estado que la corrida de producción trató como prueba. Queda `ambiguous`:
 *     no cierra hueco y no se persiste.
 *
 * ── 🔴 La comparación es ASIMÉTRICA, y en un solo sentido ─────────────────────
 *
 * `declarada.includes(etiqueta)`. Nunca al revés. El sentido inverso es
 * literalmente el defecto de producción: convierte a todo padre en prueba de
 * todas sus hijas. Una prueba de mutación lo vigila.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB, sin reloj.
 */

import {
  getMacroIndustryByKey,
  normalizeMacroIndustryLabel,
} from '@/modules/macro-industry-catalog/macro-industries';
import {
  MACRO_INDUSTRY_EVIDENCE_VERSION,
  assessDeclaredMacroIndustryEvidence,
  type MacroIndustryEvidenceAssessment,
} from '@/modules/macro-industry-catalog/macro-industry-evidence-core';
import type { LushaIndustryBranch } from './lusha-macro-search-plan';

// ─── Contrato ─────────────────────────────────────────────────────────────────

export const LUSHA_MACRO_PRECISION_VERSION = 'v1.LMP-1' as const;

/**
 * Veredicto de precisión de UNA empresa.
 *
 * `confirmed` La industria declarada prueba la macro POR ESTA RAMA. Admite.
 * `ambiguous` Compatible pero sin prueba (típicamente el padre de una sub). NO admite.
 * `rejected`  La industria declarada pertenece a otra macro. NO admite.
 *
 * 🔴 Sólo `confirmed` admite. `ambiguous` y `rejected` se distinguen para poder
 * leer la telemetría —«el proveedor devolvió el padre» no es lo mismo que «el
 * proveedor devolvió otra industria»—, no porque uno de los dos pase.
 */
export type LushaMacroPrecisionVerdict = 'confirmed' | 'ambiguous' | 'rejected';

export type LushaMacroPrecisionReason =
  /** La empresa declara la industria principal que ESTA rama pidió sin estrechar. */
  | 'branch_main_industry_declared'
  /** La empresa declara la sub-industria que ESTA rama pidió. */
  | 'branch_sub_industry_declared'
  /** Un término confirmatorio del catálogo apareció en la industria declarada. */
  | 'confirming_term_in_declared_industry'
  /** La rama pidió una sub y el proveedor sólo declaró su padre. NO demuestra. */
  | 'sub_industry_branch_parent_only'
  /** Sólo apareció la industria padre de la macro. Contiene sin demostrar. */
  | 'parent_industry_only'
  /** La industria declarada está en la lista de exclusión de la macro. */
  | 'excluding_industry_declared'
  /** El proveedor declaró una industria y no encaja en esta macro. */
  | 'declared_industry_outside_macro'
  /** El proveedor no declaró industria. La ausencia no demuestra nada. */
  | 'no_declared_industry'
  /** La macro pedida no existe en el catálogo. Fail-closed. */
  | 'macro_industry_unresolved';

/** Procedencia SEGURA de la empresa: qué rama la trajo. Sin payload del proveedor. */
export type LushaBranchProvenance = {
  branchIndex: number;
  mainIndustryId: number | null;
  subIndustryId: number | null;
};

export type LushaMacroPrecisionAssessment = {
  version: typeof LUSHA_MACRO_PRECISION_VERSION;
  verdict: LushaMacroPrecisionVerdict;
  reason: LushaMacroPrecisionReason;
  macroIndustryKey: string | null;
  branch: LushaBranchProvenance | null;
  /** Términos canónicos que coincidieron. Diagnóstico sin PII. */
  matchedConfirmingTerms: string[];
  matchedParentIndustries: string[];
  matchedExcludingIndustries: string[];
  /** ¿El proveedor declaró industria? `false` nunca puede confirmar. */
  declaredIndustryPresent: boolean;
  /** Versión del núcleo neutral que juzgó la evidencia canónica. */
  evidenceVersion: typeof MACRO_INDUSTRY_EVIDENCE_VERSION;
};

export type LushaMacroPrecisionInput = {
  /** `MacroIndustryKey` de la corrida. Sólo la ruta Macro-v2 la tiene. */
  macroIndustryKey: string | null | undefined;
  /** La rama que emitió la petición, o `null` en la ruta legacy de un sector. */
  branch: LushaIndustryBranch | null;
  /** Índice de la rama en el plan. Sólo procedencia. */
  branchIndex: number;
  /** La industria que el proveedor DECLARA para la empresa. */
  declaredIndustry: string | null | undefined;
};

// ─── Coincidencia asimétrica ──────────────────────────────────────────────────

/**
 * ¿La industria declarada contiene la etiqueta que ESTA rama pidió?
 *
 * 🔴 Un solo sentido, a propósito. `declarada.includes(etiqueta)` acepta
 * `Pharmaceuticals Manufacturing` contra la etiqueta `Pharmaceuticals
 * Manufacturing` y rechaza `Manufacturing` contra ella. El sentido inverso
 * —`etiqueta.includes(declarada)`— es el defecto que puso cinco fabricantes
 * genéricos en una revisión de salud.
 */
function declaredContainsBranchLabel(
  declaredNormalized: string,
  branchLabel: string,
): boolean {
  const label = normalizeMacroIndustryLabel(branchLabel);
  if (label.length === 0) return false;
  return declaredNormalized.includes(label);
}

// ─── Evaluación ───────────────────────────────────────────────────────────────

function unresolved(branch: LushaBranchProvenance | null): LushaMacroPrecisionAssessment {
  return {
    version: LUSHA_MACRO_PRECISION_VERSION,
    verdict: 'ambiguous',
    reason: 'macro_industry_unresolved',
    macroIndustryKey: null,
    branch,
    matchedConfirmingTerms: [],
    matchedParentIndustries: [],
    matchedExcludingIndustries: [],
    declaredIndustryPresent: false,
    evidenceVersion: MACRO_INDUSTRY_EVIDENCE_VERSION,
  };
}

/** Procedencia segura de una rama. `null` sólo en la ruta legacy. */
export function describeLushaBranchProvenance(
  branch: LushaIndustryBranch | null,
  branchIndex: number,
): LushaBranchProvenance {
  return {
    branchIndex,
    mainIndustryId: branch?.mainIndustryId ?? null,
    subIndustryId: branch?.subIndustryId ?? null,
  };
}

/**
 * Juzga UNA empresa contra la macro industria pedida y la rama que la trajo.
 *
 * Orden de decisión, y por qué:
 *
 *   1. **Macro irresoluble** ⇒ ambiguo (fail-closed): no se puede juzgar contra
 *      un catálogo que no responde, y la ausencia nunca confirma.
 *   2. **Exclusión canónica primero**, por precedencia de substring: `retail` es
 *      substring de `retail banking`. Se mide contra la industria DECLARADA.
 *   3. **La rama** — la etiqueta que esta petición pidió, en un solo sentido.
 *      Es lo que separa `main 12 desnudo` (confirma Manufacturing) de
 *      `main 12 + sub 71` (no lo confirma).
 *   4. **Término confirmatorio canónico** sobre la industria declarada.
 *   5. **Padre solo / otra industria / sin industria** ⇒ no admite, con el motivo
 *      que distingue los tres.
 *
 * Puro.
 */
export function assessLushaMacroPrecision(
  input: LushaMacroPrecisionInput,
): LushaMacroPrecisionAssessment {
  const provenance = describeLushaBranchProvenance(input.branch, input.branchIndex);

  const definition = getMacroIndustryByKey(
    typeof input.macroIndustryKey === 'string' ? input.macroIndustryKey.trim() : null,
  );
  if (!definition) return unresolved(provenance);

  const declared =
    typeof input.declaredIndustry === 'string' && input.declaredIndustry.trim().length > 0
      ? input.declaredIndustry.trim()
      : null;

  // La evidencia canónica se evalúa SÓLO contra la industria declarada: Lusha no
  // devuelve keywords ni descripciones en `companies/prospecting`, así que las dos
  // listas del núcleo neutral son la misma. No se inventa texto que el proveedor
  // no entregó.
  const core: MacroIndustryEvidenceAssessment = assessDeclaredMacroIndustryEvidence(
    definition,
    {
      declaredIndustries: declared ? [declared] : [],
      classificationText: declared ? [declared] : [],
      providerEvidenceFields: declared ? ['industry'] : [],
    },
  );

  const base = {
    version: LUSHA_MACRO_PRECISION_VERSION,
    macroIndustryKey: definition.key,
    branch: provenance,
    matchedConfirmingTerms: core.matchedConfirmingTerms,
    matchedParentIndustries: core.matchedParentIndustries,
    matchedExcludingIndustries: core.matchedExcludingIndustries,
    declaredIndustryPresent: core.declaredIndustryPresent,
    evidenceVersion: MACRO_INDUSTRY_EVIDENCE_VERSION,
  } satisfies Omit<LushaMacroPrecisionAssessment, 'verdict' | 'reason'>;

  // 2. Exclusión canónica: una industria de OTRA macro no la salva ninguna rama.
  if (core.reason === 'excluding_industry_declared') {
    return { ...base, verdict: 'rejected', reason: 'excluding_industry_declared' };
  }

  if (!declared) {
    return { ...base, verdict: 'ambiguous', reason: 'no_declared_industry' };
  }

  const declaredNormalized = normalizeMacroIndustryLabel(declared);

  // 3. La rama. Su etiqueta es la del main cuando la rama no estrecha, y la de la
  //    SUB cuando sí — que es justo lo que hace branch-aware a esta decisión.
  if (input.branch !== null) {
    if (declaredContainsBranchLabel(declaredNormalized, input.branch.label)) {
      return {
        ...base,
        verdict: 'confirmed',
        reason:
          typeof input.branch.subIndustryId === 'number'
            ? 'branch_sub_industry_declared'
            : 'branch_main_industry_declared',
      };
    }
  }

  // 4. Término confirmatorio del catálogo (p. ej. `pharmaceuticals` en una
  //    industria declarada como `Pharmaceuticals Manufacturing`).
  if (core.verdict === 'confirmed') {
    return { ...base, verdict: 'confirmed', reason: 'confirming_term_in_declared_industry' };
  }

  // 5a. La rama pidió una SUB y lo declarado no la contiene. Si además lo
  //     declarado es el padre de esa sub, el motivo lo dice: el proveedor devolvió
  //     la categoría ancha, no la prueba.
  if (input.branch !== null && typeof input.branch.subIndustryId === 'number') {
    return { ...base, verdict: 'ambiguous', reason: 'sub_industry_branch_parent_only' };
  }

  // 5b. Padre de la MACRO solo ⇒ contiene sin demostrar.
  if (core.reason === 'parent_industry_only') {
    return { ...base, verdict: 'ambiguous', reason: 'parent_industry_only' };
  }

  // 5c. Industria declarada que no encaja en ninguna cubeta ⇒ rechazo medido.
  return { ...base, verdict: 'rejected', reason: 'declared_industry_outside_macro' };
}

/** ¿Puede esta empresa contar para el objetivo y persistirse? Sólo `confirmed`. */
export function isLushaMacroPrecisionAdmitted(
  assessment: LushaMacroPrecisionAssessment,
): boolean {
  return assessment.verdict === 'confirmed';
}

// ─── Proyección a metadata ────────────────────────────────────────────────────

/** Bloque plano y sin PII para la metadata del candidato. */
export function toLushaMacroPrecisionMetadata(
  assessment: LushaMacroPrecisionAssessment,
): Record<string, unknown> {
  return {
    macro_precision_version: assessment.version,
    macro_industry_evidence_version: assessment.evidenceVersion,
    macro_industry_key: assessment.macroIndustryKey,
    macro_precision_verdict: assessment.verdict,
    macro_precision_reason: assessment.reason,
    macro_precision_matched_confirming_terms: assessment.matchedConfirmingTerms,
    macro_precision_matched_parent_industries: assessment.matchedParentIndustries,
    macro_precision_matched_excluding_industries: assessment.matchedExcludingIndustries,
    macro_precision_declared_industry_present: assessment.declaredIndustryPresent,
    branch_index: assessment.branch?.branchIndex ?? null,
    main_industry_id: assessment.branch?.mainIndustryId ?? null,
    sub_industry_id: assessment.branch?.subIndustryId ?? null,
  };
}
