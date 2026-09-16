/**
 * lusha-country-gate.ts — X6.4-A.
 *
 * El gate obligatorio de PAÍS que la pierna Lusha no aplicaba, expresado con la
 * autoridad que YA existe y sin una segunda regla propia.
 *
 * ── 🔴 El defecto que cierra ────────────────────────────────────────────────
 *
 * La corrida `bedebe9b…` (CO × retail) persistió «Maestro Perú»
 * (`www.maestro.com.pe`) como prospecto COLOMBIANO. No fue un fallo del gate de
 * intake: fue su ALCANCE. `evaluateProspectIntakeGate` compara el `countryCode`
 * que el PROVEEDOR declaró — y Lusha declaró `CO` para esa empresa, así que no
 * había contradicción que ver. La evidencia real estaba en el dominio, y en la
 * ruta Apollo ese dominio lo juzga `evaluateCountryCompatibility`, que la pierna
 * Lusha nunca invocaba.
 *
 * ── 🔴 Qué NO hace ──────────────────────────────────────────────────────────
 *
 * · No implementa reglas de país: IMPORTA la función que aplica el writer de
 *   Apollo, sin un umbral, una lista de TLD ni una excepción añadida aquí.
 * · No toca `country-compatibility.ts` ni el gate de país de Apollo.
 * · No evalúa OWNERSHIP. Ver la nota de alcance más abajo.
 *
 * ── 🔴 La ausencia de evidencia NO rechaza ──────────────────────────────────
 *
 * `evaluateCountryCompatibility(null, …)` devuelve `compatible: true` con
 * confianza `low` (`no_url_to_evaluate`), y un dominio global sin señal de país
 * sale `compatible: true` (`global_domain_no_country_signal`). Sólo la
 * CONTRADICCIÓN —un ccTLD extranjero, o un path de otro país— rechaza. Un
 * candidato sin evidencia sigue su camino y acaba, como hoy, en `needs_review`.
 *
 * ── 🔴 ALCANCE: el ownership queda FUERA de X6.4 ────────────────────────────
 *
 * Una versión anterior de este corte aplicaba también
 * `evaluateCompanyOwnership` + `isBlockedByCompanyOwnership` a la pierna Lusha.
 * Se retiró al medir su heurístico nombre↔dominio contra datos REALES: sobre las
 * 25 empresas del lote vivo `26f49596` rechazaba 4, las cuatro dueñas legítimas
 * de su dominio —EPM/`une.com.co`, RCN TV/`canalrcn.com`, Caracol
 * Televisión/`caracoltv.com`, Universidad de Nariño/`udenar.edu.co`—, más
 * `D1 S.A.S`/`tiendasd1.com` en la corrida `bedebe9b…`. Un ~15% de falso
 * positivo sobre empresas reales, y dos de esos rechazos caían justo sobre el
 * cohorte que la suite de canonicalización de dominio existe para defender.
 *
 * El gate de ownership NO tiene nada malo que este corte pueda arreglar: el
 * defecto está en el heurístico nombre↔dominio, que es otro corte. Extenderlo a
 * Lusha con esa tasa habría cambiado un falso negativo de país por un puñado de
 * falsos positivos de ownership.
 *
 * Puro: sin IO, sin proveedor, sin base, sin reloj.
 */

import { evaluateCountryCompatibility } from '@/server/agents/prospecting-toolkit/country-compatibility';
// 🔴 El MISMO normalizador que el writer usa para el dominio. Lusha puede
// devolver una URL entera en `domain` (`https://www.mismo.com/`), y compararla
// sin normalizar juzgaría a la empresa por la FORMA del dato.
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';

/**
 * Por qué una empresa de Lusha no puede persistirse. Vocabulario CERRADO y con
 * el motivo VERBATIM de la autoridad que decidió, para que la fila durable
 * pueda decir con qué evidencia se rechazó.
 */
export type LushaCountryRejection = {
  readonly kind: 'country_incompatible';
  /** El `reason` EXACTO de `evaluateCountryCompatibility`. Se transcribe. */
  readonly reason: string;
  readonly evaluatedUrl: string | null;
};

export type LushaCountryGateInput = {
  readonly domain: string | null;
  readonly website: string | null;
  /** El país PEDIDO por la corrida. `null` ⇒ no hay contra qué contrastar. */
  readonly targetCountryCode: string | null;
};

/**
 * `null` ⇒ la regla de país no la rechaza. NO significa «aprobada»: los demás
 * gates de la pierna siguen corriendo después.
 */
export function evaluateLushaCountryGate(
  input: LushaCountryGateInput,
): LushaCountryRejection | null {
  // Sin país pedido no hay contradicción posible: el writer de Apollo descarta
  // con `missing_country_code`, pero ése es un defecto de CONFIGURACIÓN de la
  // corrida y no del candidato. Aquí se deja pasar y lo juzgan los demás gates.
  if (input.targetCountryCode === null || input.targetCountryCode.trim() === '') return null;

  const normalizedDomain = input.domain === null ? null : normalizeDomain(input.domain);
  const evaluatedUrl =
    input.website ?? (normalizedDomain !== null ? `https://${normalizedDomain}` : null);

  const compatibility = evaluateCountryCompatibility(evaluatedUrl, input.targetCountryCode);
  if (compatibility.compatible) return null;

  return { kind: 'country_incompatible', reason: compatibility.reason, evaluatedUrl };
}
