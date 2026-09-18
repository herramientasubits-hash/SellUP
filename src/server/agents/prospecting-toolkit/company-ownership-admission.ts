/**
 * Company Ownership Admission — AGENT1-STRUCTURAL-OWNERSHIP-ACTIVATION-X6.10-C
 *
 * ── Qué activa este corte ────────────────────────────────────────────────────
 *
 * X6.10-A definió el contrato de evidencia estructural. X6.10-B lo cableó para
 * TRANSPORTAR y OBSERVAR, con una aserción central: la evidencia llegaba y no
 * cambiaba el veredicto de nadie. Este corte es el que le da poder, y sólo en
 * una dirección: RECUPERAR candidatas que el gate TEXTUAL rechaza.
 *
 * ── 🔴 La costura es UNA ─────────────────────────────────────────────────────
 *
 * Antes de este corte había tres sitios que preguntaban `isBlockedByCompany-
 * Ownership(verdict)` para decidir: `readContractConditions` y `applyFinalGates`
 * en el orquestador, y el bucle de gates del writer. Si la evidencia estructural
 * se consultara en cada uno por separado, volveríamos a tener tres semánticas
 * —que es exactamente el defecto que CUT-1 y X3 persiguieron—.
 *
 * Los tres llaman AQUÍ. `isBlockedByCompanyOwnership` sigue existiendo y sigue
 * significando lo mismo: es el veredicto TEXTUAL. Lo que cambia es quién decide
 * la admisión, y ahora hay un solo sitio donde está escrito.
 *
 * ── Qué evidencia es SUFICIENTE ──────────────────────────────────────────────
 *
 * Una y sólo una: `outcome === 'confirmed'` con
 * `decidingSource === 'provider_domain_alias_set'`. Es decir, la regla E1 de
 * X6.10-A: el dominio pertenece al conjunto que el proveedor declara para ESA
 * organización, existe en el conjunto otro alias distinto, y a ese otro el gate
 * textual SÍ lo acredita para este nombre.
 *
 * ── Qué evidencia NO es suficiente ───────────────────────────────────────────
 *
 *   · `insufficient_evidence` — no es una negación, es la ausencia de respuesta.
 *     El veredicto textual se conserva intacto. Convertirlo en pase es el único
 *     modo de que esta capa se vuelva una vía de falsos positivos.
 *   · LinkedIn, en cualquier forma. `linkedInCorroboration` se registra y no se
 *     consulta para decidir; y `decidingSource === 'provider_linkedin_company_
 *     slug'` NO admite, aunque el contrato de X6.10-A ya impide que LinkedIn
 *     llegue a ser fuente decisoria. Son dos cerrojos sobre la misma puerta, a
 *     propósito: el de A vive en el productor y éste en el consumidor.
 *   · Un conjunto de alias de un solo elemento. Lo descarta A, no esto.
 *
 * ── Qué NO hace, y es igual de importante ────────────────────────────────────
 *
 *   · NO eleva un veredicto textual que ya admitía. Una candidata que el gate
 *     acepta se acepta EXACTAMENTE igual que antes de este corte, y su
 *     procedencia se declara `textual_gate`.
 *   · NO degrada. `outcome === 'rejected'` —la contradicción que E1 sabe
 *     detectar— se registra y NO bloquea a nadie. Quitar candidatas que hoy
 *     pasan es un cambio de signo contrario al de este corte, con su propia
 *     autorización y su propia medición.
 *   · NO reimplementa ninguna regla de X6.9 ni de X6.10-A. Recibe los dos
 *     veredictos ya producidos y los combina.
 *
 * Puro y determinístico: sin red, sin base, sin reloj, sin proveedor.
 */

import type {
  CompanyOwnershipConfidence,
  CompanyOwnershipResult,
} from './company-ownership-gate';
import { isBlockedByCompanyOwnership } from './company-ownership-gate';
import type {
  StructuralOwnershipOutcome,
  StructuralOwnershipResult,
  StructuralOwnershipSource,
} from './structural-domain-ownership';

/**
 * La ÚNICA fuente estructural autorizada a admitir en X6.10-C.
 *
 * Constante con nombre y no un literal dentro del `if`: el mutation testing
 * necesita poder apuntar a ella, y un lector necesita poder encontrarla.
 */
export const ADMITTING_STRUCTURAL_SOURCE: StructuralOwnershipSource =
  'provider_domain_alias_set';

/** De dónde salió la admisión. `null` cuando la candidata queda bloqueada. */
export type OwnershipAdmissionSource = 'textual_gate' | 'structural_alias_evidence';

export type OwnershipAdmissionDecision = {
  /** La decisión. Es la que mata o deja pasar, en las tres capas. */
  readonly blocked: boolean;
  /** Quién la admitió. `null` ⇔ `blocked === true`. */
  readonly admittedBy: OwnershipAdmissionSource | null;
  /**
   * 🔴 La trazabilidad que este corte debe dejar: `true` SÓLO cuando el gate
   * textual la rechazaba y la evidencia estructural la salvó. Es el contador
   * que mide qué aporta X6.10-C, y el que distingue una aceptación de siempre
   * de una recuperación nueva.
   */
  readonly recoveredByStructuralEvidence: boolean;
  /** El veredicto TEXTUAL, sin reinterpretar. */
  readonly textualConfidence: CompanyOwnershipConfidence;
  /** `true` si el gate textual, por sí solo, la habría bloqueado. */
  readonly textualBlocked: boolean;
  /** El desenlace ESTRUCTURAL, sin reinterpretar. */
  readonly structuralOutcome: StructuralOwnershipOutcome;
  /** La señal estructural que admitió, o `null`. */
  readonly structuralSignal: string | null;
  /** Explicación legible. Nunca se deriva de `blocked`: se construye aparte. */
  readonly reason: string;
};

/**
 * Combina el veredicto textual con la evidencia estructural en UNA decisión.
 *
 * @param verdict     El resultado EXACTO de `evaluateCompanyOwnership`.
 * @param structural  El resultado EXACTO de `evaluateStructuralDomainOwnership`.
 */
export function resolveCompanyOwnershipAdmission(
  verdict: CompanyOwnershipResult,
  structural: StructuralOwnershipResult,
): OwnershipAdmissionDecision {
  const textualBlocked = isBlockedByCompanyOwnership(verdict);

  // 1. El gate textual la admite. La evidencia estructural no tiene nada que
  //    añadir aquí: no eleva, y su `rejected` no degrada.
  if (!textualBlocked) {
    return {
      blocked: false,
      admittedBy: 'textual_gate',
      recoveredByStructuralEvidence: false,
      textualConfidence: verdict.confidence,
      textualBlocked: false,
      structuralOutcome: structural.outcome,
      structuralSignal: null,
      reason: `admitida por el gate textual (${verdict.confidence})`,
    };
  }

  // 2. El gate textual la rechaza. La ÚNICA evidencia que la salva es E1.
  const admittedByAliasSet =
    structural.outcome === 'confirmed' &&
    structural.decidingSource === ADMITTING_STRUCTURAL_SOURCE;

  if (admittedByAliasSet) {
    return {
      blocked: false,
      admittedBy: 'structural_alias_evidence',
      recoveredByStructuralEvidence: true,
      textualConfidence: verdict.confidence,
      textualBlocked: true,
      structuralOutcome: structural.outcome,
      structuralSignal: structural.signal,
      reason: `recuperada por evidencia estructural: ${structural.detail}`,
    };
  }

  // 3. Todo lo demás sigue bloqueado, y el motivo dice CUÁL de las dos capas
  //    faltó — sin esa distinción, una fila no deja saber si la estructural no
  //    corrió, no acreditó, o acreditó por una fuente no autorizada.
  return {
    blocked: true,
    admittedBy: null,
    recoveredByStructuralEvidence: false,
    textualConfidence: verdict.confidence,
    textualBlocked: true,
    structuralOutcome: structural.outcome,
    structuralSignal: null,
    reason: `bloqueada: gate textual ${verdict.confidence} y evidencia estructural ${structural.outcome}`,
  };
}
