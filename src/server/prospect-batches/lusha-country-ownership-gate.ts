/**
 * lusha-country-ownership-gate.ts — X6.4-A.
 *
 * Los DOS gates obligatorios que la pierna Lusha no aplicaba, expresados con
 * las autoridades que YA existen y sin una segunda regla propia.
 *
 * ── 🔴 El defecto que cierra ────────────────────────────────────────────────
 *
 * La corrida `bedebe9b…` (CO × retail) persistió «Maestro Perú»
 * (`www.maestro.com.pe`) como prospecto COLOMBIANO. No fue un fallo de los
 * gates: fue su AUSENCIA. La pierna Lusha pasa por
 * `evaluateProspectIntakeGate`, cuyo eje de país compara `countryCode` contra
 * el pedido — y Lusha declaró `CO` para esa empresa, así que no había
 * contradicción que ver. La evidencia real estaba en el dominio, y en la ruta
 * Apollo ese dominio lo juzga `evaluateCountryCompatibility`, que la pierna
 * Lusha nunca invocaba. Lo mismo con el ownership: el writer canónico decide
 * con `evaluateCompanyOwnership` + `isBlockedByCompanyOwnership`, y la pierna
 * Lusha escribe por su propio writer, que no los llama.
 *
 * ── 🔴 Qué NO hace ──────────────────────────────────────────────────────────
 *
 * · No implementa reglas de país ni de ownership: las IMPORTA. Las dos
 *   funciones son exactamente las que aplican el writer de Apollo y el gate
 *   pre-writer, sin un `min`, un umbral ni una excepción añadida aquí.
 * · No toca `company-ownership-gate.ts` ni `country-compatibility.ts`.
 * · No relaja ni endurece la ruta Apollo: este módulo sólo lo llama Lusha.
 * · No usa LinkedIn como sustituto del ownership. El gate compara nombre
 *   contra dominio, que es lo que siempre comparó.
 *
 * ── 🔴 La ausencia de evidencia NO rechaza ──────────────────────────────────
 *
 * `evaluateCountryCompatibility(null, …)` devuelve `compatible: true` con
 * confianza `low` (`no_url_to_evaluate`), y un dominio global sin señal de país
 * sale `compatible: true` (`global_domain_no_country_signal`). Sólo la
 * CONTRADICCIÓN —un ccTLD extranjero, o un path de otro país— rechaza. Un
 * candidato sin evidencia sigue su camino y acaba, como hoy, en
 * `needs_review`.
 *
 * El ownership sí exige dominio, pero eso no introduce un rechazo nuevo por
 * ausencia: el gate compartido de intake ya descarta antes con `missing_domain`
 * (`requireDomain: true`), así que aquí no llega ninguna empresa sin dominio.
 *
 * Puro: sin IO, sin proveedor, sin base, sin reloj.
 */

import { evaluateCountryCompatibility } from '@/server/agents/prospecting-toolkit/country-compatibility';
// 🔴 El MISMO normalizador que el writer usa para el dominio. Lusha puede
// devolver una URL entera en `domain` (`https://www.mismo.com/`), y
// `evaluateCompanyOwnership` no la normaliza cuando se la pasan como dominio:
// compararía el nombre contra una URL y rechazaría a la empresa por la forma
// del dato, no por su contenido.
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
  resolveOwnershipEvaluationName,
} from '@/server/agents/prospecting-toolkit/company-ownership-gate';

/**
 * Por qué una empresa de Lusha no puede persistirse. Vocabulario CERRADO y con
 * el motivo VERBATIM de la autoridad que decidió, para que la fila durable
 * pueda decir cuál de las dos reglas la rechazó y con qué evidencia.
 */
export type LushaCountryOwnershipRejection =
  | {
      readonly kind: 'country_incompatible';
      /** El `reason` EXACTO de `evaluateCountryCompatibility`. Se transcribe. */
      readonly reason: string;
      readonly evaluatedUrl: string | null;
      readonly evaluationName: null;
    }
  | {
      readonly kind: 'ownership_mismatch';
      /** El `reason` EXACTO de `evaluateCompanyOwnership`. Se transcribe. */
      readonly reason: string;
      readonly evaluatedUrl: string | null;
      /** El nombre con el que se juzgó, tras la recuperación de frase SEO. */
      readonly evaluationName: string;
    };

export type LushaCountryOwnershipGateInput = {
  /**
   * `null` ⇒ el ownership NO se evalúa (no hay nombre que contrastar con el
   * dominio) y la ausencia NO se convierte en rechazo: el gate compartido de
   * intake ya descarta antes con `missing_name` (`requireName: true`). El eje
   * país sí se evalúa, porque no depende del nombre.
   */
  readonly name: string | null;
  readonly domain: string | null;
  readonly website: string | null;
  /** El país PEDIDO por la corrida. `null` ⇒ no hay contra qué contrastar. */
  readonly targetCountryCode: string | null;
};

/**
 * 🔴 El ORDEN es la política, y es el del writer canónico: país antes que
 * ownership. Una empresa peruana en una búsqueda colombiana se descarta por
 * país aunque su dominio la acredite perfectamente — que el dominio sea suyo no
 * la trae a Colombia.
 *
 * `null` ⇒ ninguna de las dos reglas la rechaza. NO significa «aprobada»: los
 * demás gates de la pierna siguen corriendo después.
 */
export function evaluateLushaCountryOwnershipGate(
  input: LushaCountryOwnershipGateInput,
): LushaCountryOwnershipRejection | null {
  const normalizedDomain = input.domain === null ? null : normalizeDomain(input.domain);
  const evaluatedUrl =
    input.website ?? (normalizedDomain !== null ? `https://${normalizedDomain}` : null);

  // ── 1. País ───────────────────────────────────────────────────────────────
  // Sin país pedido no hay contradicción posible: el writer de Apollo descarta
  // con `missing_country_code`, pero ése es un defecto de CONFIGURACIÓN de la
  // corrida y no del candidato. Aquí se deja pasar y lo juzgan los demás gates.
  if (input.targetCountryCode !== null && input.targetCountryCode.trim() !== '') {
    const compatibility = evaluateCountryCompatibility(evaluatedUrl, input.targetCountryCode);
    if (!compatibility.compatible) {
      return {
        kind: 'country_incompatible',
        reason: compatibility.reason,
        evaluatedUrl,
        evaluationName: null,
      };
    }
  }

  // ── 2. Ownership ──────────────────────────────────────────────────────────
  // Las MISMAS tres funciones que usa la ruta Apollo, en el mismo orden: el
  // nombre se resuelve antes de juzgar (frase SEO ⇒ nombre desde dominio) y el
  // veredicto lo decide `isBlockedByCompanyOwnership`, nunca `allowed` a mano
  // ni `confidence` leída aquí.
  const rawName = input.name?.trim() ?? '';
  if (rawName === '') return null;
  const evaluationName = resolveOwnershipEvaluationName(rawName, input.website, normalizedDomain);
  const ownership = evaluateCompanyOwnership(evaluationName.name, input.website, normalizedDomain);
  if (isBlockedByCompanyOwnership(ownership)) {
    return {
      kind: 'ownership_mismatch',
      reason: ownership.reason,
      evaluatedUrl,
      evaluationName: evaluationName.name,
    };
  }

  return null;
}
