/**
 * apollo-strong-identity-duplicate-match.ts — AGENT1-APOLLO-NET-NEW-PAGINATION § 3.
 *
 * El defecto que cierra: `readDuplicateVerdict` (production-runner.server.ts)
 * trataba CUALQUIER match de `checkSellUpDuplicates`/`checkHubSpotDuplicates`
 * como bloqueo duro pre-pago — incluido `possible_duplicate` (contenido de
 * nombre) y el match de `existing_in_sellup`/`existing_in_hubspot` por
 * NOMBRE normalizado (+ país), que sigue sin dominio ni identidad fiscal.
 *
 * NOMBRE POR SÍ SOLO NO ES UNA IDENTIDAD HISTÓRICA DECISIVA. Dos empresas
 * pueden compartir nombre normalizado (matriz/filial, homónimas de países
 * distintos) sin ser la misma empresa; `evaluatePrepaidHistoricalDuplicate`
 * ya sostiene esa regla para la autoridad fuerte de este corte
 * (dominio/identidad fiscal). Este módulo alinea la señal HEREDADA de los
 * checkers legacy —compartidos con Lusha vía `duplicate-checker.ts`— con esa
 * misma regla, SIN tocar los checkers compartidos: sólo decide qué cuenta
 * como bloqueo duro para el candidato de APOLLO, filtrando por la CONFIANZA
 * exacta que cada checker ya documenta como derivada de dominio o
 * identificador fiscal exacto.
 *
 * Ejes fuertes reconocidos (confidence, tal como cada checker los emite):
 *   sellup:   95 (dominio exacto), 92 (tax_identifier exacto)
 *   hubspot:  92 (dominio exacto)
 *
 * Excluidos deliberadamente — ninguno decide un bloqueo duro:
 *   sellup:   88 (normalized_name + country exacto — SIGUE siendo nombre)
 *             65 (contenido de nombre)
 *   hubspot:  82 (nombre normalizado exacto — SIGUE siendo nombre)
 *             65 (contenido de nombre), 50 (hit débil sin match claro)
 *
 * Puro: sin I/O, sin red, sin Supabase. No modifica los checkers compartidos
 * ni su contrato — sólo lee su salida (`DuplicateMatch[]`) con un criterio más
 * estricto, ESCOPADO a la decisión de Apollo.
 */

import type { DuplicateMatch } from '../types';

/** Confianzas que cada checker documenta como derivadas de dominio/fiscal exacto. */
const STRONG_IDENTITY_CONFIDENCE_BY_SOURCE: Readonly<Record<DuplicateMatch['source'], readonly number[]>> = {
  sellup: [95, 92],
  hubspot: [92],
};

/**
 * ¿Este match individual prueba una identidad FUERTE (dominio o identificador
 * fiscal exacto), o es —por sí sola o disfrazada de `existing_in_*`— una señal
 * de NOMBRE?
 *
 * No se lee `reason` (texto libre, no es contrato): la confianza es el único
 * valor estable que cada checker ya documenta por eje de match.
 */
export function isStrongIdentityDuplicateMatch(match: DuplicateMatch): boolean {
  const strongConfidences = STRONG_IDENTITY_CONFIDENCE_BY_SOURCE[match.source];
  return strongConfidences.includes(match.confidence);
}

/**
 * ¿Alguno de los matches de esta fuente prueba una identidad FUERTE?
 *
 * Bloqueo duro pre-pago para Apollo: sólo dominio o identificador fiscal
 * exacto. Un `possible_duplicate` por contenido de nombre, o un
 * `existing_in_sellup`/`existing_in_hubspot` que resultó ser sólo nombre
 * normalizado + país, NUNCA basta por sí solo.
 */
export function hasStrongIdentityDuplicateMatch(
  matches: readonly DuplicateMatch[],
  source: DuplicateMatch['source'],
): boolean {
  return matches.some((match) => match.source === source && isStrongIdentityDuplicateMatch(match));
}
