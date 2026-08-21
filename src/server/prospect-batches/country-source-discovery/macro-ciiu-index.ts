/**
 * macro-ciiu-index.ts — qué códigos CIIU pertenecen a cada macro industria.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 4, 5.
 *
 * ── 🔴 Aquí NO hay una segunda taxonomía ─────────────────────────────────────
 *
 * § 5 prohíbe explícitamente un `co-rues-health-industries.ts` o cualquier
 * segundo vocabulario. Este módulo no escribe ni una asociación a mano: DERIVA el
 * índice pasando cada descripción CIIU de la tabla pública que el repo ya tiene
 * (DANE CIIU Rev.4, `CIIU_SECTOR_DESCRIPTIONS`) por el MISMO evaluador canónico
 * que juzga a Apollo y a Lusha (`assessDeclaredMacroIndustryEvidence`) contra el
 * MISMO catálogo (`MACRO_INDUSTRIES`).
 *
 * Consecuencia buscada: la pregunta que se le hace a la fuente y la prueba que se
 * le exige a la respuesta salen de la misma autoridad. Si mañana el catálogo
 * cambia un término de evidencia, el índice cambia con él en el mismo commit y
 * sin que nadie tenga que acordarse.
 *
 * ── 🔴 Coincidencia EXACTA de código, nunca por prefijo ──────────────────────
 *
 * Se usa `getCiiuSectorDescriptionExact`, no `getCiiuSectorDescription`. La
 * segunda degrada a 3 y luego a 2 dígitos y devuelve la primera entrada que
 * empiece igual, así que un código inexistente heredaría la descripción de un
 * vecino y confirmaría una pertenencia que nadie declaró. Ver su cabecera.
 *
 * ── La cobertura es ESTRECHA, y eso está bien ────────────────────────────────
 *
 * De los 469 códigos con descripción exacta, sólo una minoría confirma alguna
 * macro; dos macros no confirman ninguno. No se rellena el hueco con conjeturas:
 * § 7 prohíbe fabricar cobertura. Una macro sin códigos simplemente no obtiene
 * descubrimiento gratuito, la fuente devuelve cero y el proveedor de pago hace
 * exactamente lo de hoy.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj. El índice se calcula una vez.
 */

import {
  MACRO_INDUSTRIES,
  type MacroIndustryKey,
} from '@/modules/macro-industry-catalog/macro-industries';
import { assessDeclaredMacroIndustryEvidence } from '@/modules/macro-industry-catalog/macro-industry-evidence-core';
import {
  getCiiuSectorDescriptionExact,
  listKnownCiiuCodes,
} from '@/server/source-catalog/connectors/socrata-colombia/normalizers';

/** Nombre del campo de evidencia que la fuente entrega. Sólo diagnóstico. */
export const CIIU_EVIDENCE_FIELD = 'ciiu_description' as const;

function buildMacroCiiuIndex(): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const definition of MACRO_INDUSTRIES) index.set(definition.key, []);

  for (const code of listKnownCiiuCodes()) {
    const description = getCiiuSectorDescriptionExact(code);
    if (description === null) continue;

    for (const definition of MACRO_INDUSTRIES) {
      const assessment = assessDeclaredMacroIndustryEvidence(definition, {
        declaredIndustries: [description],
        classificationText: [description],
        providerEvidenceFields: [CIIU_EVIDENCE_FIELD],
      });
      // Sólo `confirmed`. `ambiguous` no demuestra nada y `rejected` demuestra lo
      // contrario: ninguno de los dos puede formar parte de la pregunta.
      if (assessment.verdict === 'confirmed') {
        index.get(definition.key)?.push(code);
      }
    }
  }

  const frozen = new Map<string, readonly string[]>();
  for (const [key, codes] of index) frozen.set(key, Object.freeze([...codes].sort()));
  return frozen;
}

const MACRO_CIIU_INDEX = buildMacroCiiuIndex();

/**
 * Códigos CIIU que confirman ESTA macro industria.
 *
 * Vacío ⇒ la fuente no puede preguntar nada útil para esa macro. El llamador debe
 * tratarlo como «sin cobertura», nunca como «pregunta sin filtro»: una consulta
 * sin filtro devolvería la población entera y § 4 es explícito en que una muestra
 * genérica NO puede reducir el objetivo.
 */
export function resolveMacroCiiuCodes(macroIndustryKey: string | null | undefined): readonly string[] {
  if (typeof macroIndustryKey !== 'string') return [];
  return MACRO_CIIU_INDEX.get(macroIndustryKey) ?? [];
}

/** ¿Tiene esta macro industria algún código CIIU que la confirme? */
export function macroHasCiiuCoverage(macroIndustryKey: string | null | undefined): boolean {
  return resolveMacroCiiuCodes(macroIndustryKey).length > 0;
}

/** Snapshot del índice completo. Sólo para pruebas y telemetría de cobertura. */
export function listMacroCiiuCoverage(): ReadonlyArray<{
  macroIndustryKey: MacroIndustryKey;
  codeCount: number;
}> {
  return MACRO_INDUSTRIES.map((definition) => ({
    macroIndustryKey: definition.key,
    codeCount: resolveMacroCiiuCodes(definition.key).length,
  }));
}
