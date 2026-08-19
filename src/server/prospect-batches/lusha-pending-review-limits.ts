/**
 * lusha-pending-review-limits.ts — los tres topes que gobiernan una corrida
 * «Buscar con IA» de Lusha.
 *
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 6.
 *
 * Estas constantes vivían en `lusha-pending-review.ts` y se EXTRAEN aquí sin
 * cambiar ni su nombre ni su valor. El motivo es un ciclo real, no una
 * preferencia de organización: el ejecutor multi-rama
 * (`lusha-multibranch-execution`) necesita las páginas y el objetivo para derivar
 * sus techos, y `lusha-pending-review` necesita al ejecutor para orquestar. Con
 * las constantes dentro del writer, esa arista sería un ciclo de inicialización de
 * módulos —el tipo de ciclo en el que una `const` se lee como `undefined` y un
 * techo de gasto se evalúa como `NaN`—.
 *
 * `lusha-pending-review` las RE-EXPORTA, así que ningún llamador ni ninguna suite
 * existente cambia de import.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB.
 */

/**
 * Mínimo de candidatos ÚTILES (revisables) que la corrida intenta dejar.
 *
 * Útil = `duplicate_status` resuelto a `no_match` o `possible_duplicate`. Un
 * `exact_duplicate` y un descarte fuerte del guard de candidatos activos NO son
 * útiles. Es el objetivo por defecto del ejecutor (`LUSHA_DEFAULT_TARGET_GAP`).
 */
export const LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES = 5;

/** Tope duro de páginas de Lusha por RAMA. page 0 + page 1 opcional. */
export const LUSHA_PENDING_REVIEW_MAX_PAGES = 2;

/**
 * Tope de créditos esperados por RAMA (1 crédito/página × 2).
 *
 * 🔴 Es por rama, no por corrida. El techo de la corrida lo calcula
 * `resolveLushaMacroPlanMaxProviderCredits` (ramas × esto) y es lo que se
 * reserva. Leer esta constante como «lo máximo que una corrida puede gastar» era
 * exacto mientras el ejecutor paginaba una sola búsqueda; con ramas dejó de
 * serlo.
 */
export const LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS = 2;
