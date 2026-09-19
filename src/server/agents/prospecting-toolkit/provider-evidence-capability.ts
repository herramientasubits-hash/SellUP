/**
 * provider-evidence-capability.ts — AGENT1-COMPLETENESS-UNAVAILABLE-X5.1.
 *
 * Qué evidencia del contrato canónico puede producir cada proveedor.
 *
 * Es un REGISTRO DE HECHOS, no una regla. La regla de completitud sigue siendo
 * una sola —`evaluateCandidateTargetEligibility`— y es la misma para todos; lo
 * que cambia de un proveedor a otro es qué preguntas puede contestar. Separar
 * las dos cosas es lo que permite que Apollo y Lusha compartan semántica sin
 * una sola rama `if (provider === …)` dentro de la regla.
 *
 * El defecto que cierra: la pierna Lusha calculaba su `completeValidCandidates`
 * como `Math.min(insertedCount, useful.length)` —un conteo de filas ya recortado
 * por el objetivo— y lo publicaba como si fuera un veredicto de completitud. No
 * es que Lusha midiera mal: es que no medía, y el hueco se rellenó con la única
 * cifra a mano.
 *
 * Declarar una condición `unavailable` dice la verdad sin inventar una
 * confirmación y sin fingir que otra página la resolvería.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

import type { CandidateTargetCondition } from './candidate-completeness-contract';

/**
 * Lo que un proveedor NO puede contestar, por su propio contrato con nosotros.
 *
 * Lista vacía ⇒ el proveedor puede producir las siete condiciones. Es el caso
 * del writer de Apollo, y por eso su comportamiento no cambia.
 */
export type ProviderEvidenceCapability = {
  readonly unavailableConditions: readonly CandidateTargetCondition[];
};

/** Nada declarado: el proveedor puede contestarlo todo. */
export const PROVIDER_PRODUCES_ALL_EVIDENCE: ProviderEvidenceCapability = {
  unavailableConditions: [],
};

/**
 * Lusha · V3 Prospecting.
 *
 * ── 🔴 X6.12 — dos de los tres huecos se CERRARON, y el tercero es condicional ─
 *
 * Hasta X6.12 esta capacidad declaraba tres condiciones no disponibles y era
 * una CONSTANTE, así que ninguna candidata de Lusha podía cumplir las siete y
 * `acceptedForTarget` valía `null` por construcción. Lo que cambia no es la
 * regla de completitud —sigue siendo una sola— sino qué preguntas sabe
 * contestar esta ruta:
 *
 *   `ownership_gate`     ya NO es un hueco: `lusha-ownership-evidence.ts` corre
 *                        la MISMA costura de admisión de X6.10-C sobre el
 *                        nombre, el dominio normalizado y el LinkedIn del
 *                        proveedor. El veredicto existe, se persiste y no
 *                        bloquea (ver la nota de medición de ese módulo).
 *
 *   `linkedin_status`    ya NO es un hueco: la fila escribe `linkedin_url`
 *                        cuando `isLinkedInCompanyUrl` acredita la URL que el
 *                        proveedor entregó, y `not_returned` cuando no la hay.
 *                        Las dos son respuestas.
 *
 *   `subindustry_match`  sigue siendo un hueco **sólo cuando la búsqueda pidió
 *                        una subindustria**. Lusha confirma la MACRO
 *                        (`assessLushaMacroPrecision`), no la subindustria
 *                        pedida, y la invariante E del contrato canónico
 *                        prohíbe sustituir una por otra. Sin subindustria
 *                        pedida la pregunta NO aplica y el contrato ya la
 *                        resuelve como `not_requested` — el mismo camino que
 *                        recorre hoy la ruta Apollo.
 *
 * `quality_gate` nunca estuvo aquí: la precisión macro y el dedupe exacto SÍ
 * corren. `employee_count_status` tampoco: Lusha entrega `employeesExact`
 * cuando lo tiene, y cuando falta la candidata es INCOMPLETE de verdad.
 */
export type LushaEvidenceCapabilityFacts = {
  /**
   * ¿La búsqueda declaró al menos una subindustria? Es un HECHO de la corrida,
   * no del proveedor: por eso la capacidad se resuelve con una función y no se
   * escribe a mano en una constante.
   */
  readonly subindustryRequested: boolean;
};

/**
 * La capacidad de esta ruta, derivada de los hechos de la corrida.
 *
 * 🔴 Sigue sin existir una sola rama que compare el NOMBRE del proveedor: lo que
 * decide es qué evidencia hay. Un adaptador futuro que sepa confirmar la
 * subindustria pedida pasa a tener la lista vacía sin tocar esta función.
 */
export function resolveLushaProspectingEvidenceCapability(
  facts: LushaEvidenceCapabilityFacts,
): ProviderEvidenceCapability {
  return {
    unavailableConditions: facts.subindustryRequested ? ['subindustry_match'] : [],
  };
}

/**
 * La capacidad de una corrida de Lusha que SÍ pidió subindustria. Se conserva
 * como constante con nombre —y no como literal dentro de un `if`— para que las
 * pruebas de mutación puedan apuntarla.
 */
export const LUSHA_PROSPECTING_EVIDENCE_CAPABILITY: ProviderEvidenceCapability =
  resolveLushaProspectingEvidenceCapability({ subindustryRequested: true });
