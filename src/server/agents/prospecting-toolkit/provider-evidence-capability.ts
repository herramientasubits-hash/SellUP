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
 * Los tres huecos, cada uno con su razón medida:
 *
 *   `subindustry_match`  Lusha confirma la MACRO (`assessLushaMacroPrecision`),
 *                        no la subindustria PEDIDA. El contrato canónico
 *                        prohíbe explícitamente sustituir una por otra
 *                        (invariante E): el veredicto de industria «NUNCA»
 *                        convierte un `subindustryMatch` ambiguo en confirmado.
 *                        Declararlo no disponible es la única lectura honesta.
 *
 *   `linkedin_status`    la fila de candidato de esta ruta no escribe
 *                        `linkedin_url`; el proveedor no lo entrega en el
 *                        payload de prospecting.
 *
 *   `ownership_gate`     la ruta no ejecuta `evaluateCompanyOwnership`. NO es un
 *                        pase encubierto: un gate que no corrió no absuelve, y
 *                        por eso la candidata queda `unknown` y no `complete`.
 *
 * `quality_gate` NO está aquí a propósito: la precisión macro y el dedupe exacto
 * SÍ corren en esta ruta, así que esa pregunta tiene respuesta.
 *
 * `employee_count_status` tampoco: Lusha entrega `employeesExact` cuando lo
 * tiene, así que la condición es evaluable — y cuando el dato falta, la
 * candidata es INCOMPLETE de verdad, no `unknown`.
 */
export const LUSHA_PROSPECTING_EVIDENCE_CAPABILITY: ProviderEvidenceCapability = {
  unavailableConditions: ['subindustry_match', 'linkedin_status', 'ownership_gate'],
};
