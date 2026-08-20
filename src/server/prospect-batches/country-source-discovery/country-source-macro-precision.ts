/**
 * country-source-macro-precision.ts — ¿la industria que la FUENTE OFICIAL declaró
 * prueba que esta empresa pertenece a la macro industria pedida?
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 4, 5.
 *
 * ── 🔴 Ni una palabra clave propia ───────────────────────────────────────────
 *
 * La decisión entera es `assessDeclaredMacroIndustryEvidence`, el núcleo neutral
 * extraído en #306 que ya juzga a Apollo y a Lusha. Lo único que este módulo hace
 * es TRADUCIR la forma de una fuente oficial a las dos listas de texto que ese
 * núcleo consume. Exactamente el mismo reparto de responsabilidades que
 * `lusha-macro-precision` y `apollo-macro-industry-evidence`.
 *
 * ── 🔴 Qué entra como evidencia, y qué se queda fuera ────────────────────────
 *
 * ENTRA: la descripción CIIU exacta. Es una industria DECLARADA por un registro
 * oficial sobre esa empresa concreta, que es justo lo que el núcleo espera.
 *
 * NO ENTRA:
 *   · el sector grueso (`MACROSECTOR`) — seis cubetas no demuestran doce macros;
 *     ver `CountrySourceCompany.coarseSector`;
 *   · el nombre de la empresa — cierra el círculo sobre sí mismo (una empresa
 *     llamada «Farmacéutica X» probaría su propia industria);
 *   · el código CIIU desnudo — «2100» no es texto clasificatorio, y compararlo
 *     contra términos del catálogo sería ruido.
 *
 * ── Sólo `confirmed` cierra hueco (§ 5) ──────────────────────────────────────
 *
 * `ambiguous` y `rejected` se distinguen para poder leer la telemetría, no porque
 * alguno de los dos admita. Y ninguno de los dos bloquea el respaldo del
 * proveedor de pago: una fuente que no confirma deja el hueco intacto.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import {
  getMacroIndustryByKey,
} from '@/modules/macro-industry-catalog/macro-industries';
import {
  assessDeclaredMacroIndustryEvidence,
  unresolvedMacroIndustryEvidence,
  type MacroIndustryEvidenceAssessment,
} from '@/modules/macro-industry-catalog/macro-industry-evidence-core';
import { CIIU_EVIDENCE_FIELD } from './macro-ciiu-index';
import type { CountrySourceCompany } from './country-source-types';

export type CountrySourceMacroPrecisionVerdict = 'confirmed' | 'ambiguous' | 'rejected';

export type CountrySourceMacroPrecision = {
  verdict: CountrySourceMacroPrecisionVerdict;
  /** Motivo canónico del núcleo neutral. Códigos estáticos, sin PII. */
  reason: MacroIndustryEvidenceAssessment['reason'];
  assessment: MacroIndustryEvidenceAssessment;
};

/**
 * Evalúa UNA empresa de fuente oficial contra la macro industria pedida.
 *
 * Fail-closed en las dos ausencias posibles: una macro que el catálogo no
 * resuelve y una empresa sin industria declarada terminan en `ambiguous`, que no
 * admite. La ausencia nunca confirma.
 */
export function assessCountrySourceMacroPrecision(input: {
  macroIndustryKey: string;
  company: Pick<CountrySourceCompany, 'declaredIndustry'>;
}): CountrySourceMacroPrecision {
  const definition = getMacroIndustryByKey(input.macroIndustryKey);
  if (definition === null) {
    const assessment = unresolvedMacroIndustryEvidence();
    return { verdict: assessment.verdict, reason: assessment.reason, assessment };
  }

  const declared = input.company.declaredIndustry;
  const declaredIndustries = typeof declared === 'string' && declared.trim() !== ''
    ? [declared.trim()]
    : [];

  const assessment = assessDeclaredMacroIndustryEvidence(definition, {
    declaredIndustries,
    // La MISMA lista: la fuente oficial no publica keywords ni descripciones
    // comerciales, así que todo su texto clasificatorio es su industria declarada.
    classificationText: declaredIndustries,
    providerEvidenceFields: declaredIndustries.length > 0 ? [CIIU_EVIDENCE_FIELD] : [],
  });

  return { verdict: assessment.verdict, reason: assessment.reason, assessment };
}

/** 🔴 La única puerta de admisión. `ambiguous` y `rejected` NO cierran hueco. */
export function isCountrySourceMacroPrecisionAdmitted(
  precision: CountrySourceMacroPrecision,
): boolean {
  return precision.verdict === 'confirmed';
}
