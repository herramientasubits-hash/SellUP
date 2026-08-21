/**
 * lusha-pending-review-limits.ts — los topes y el interruptor de activación que
 * gobiernan una corrida «Buscar con IA» de Lusha.
 *
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 6.
 * AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 § 4 (activación de hueco parcial).
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
 * Los tres topes se EXTRAJERON sin cambiar nombre ni valor; el interruptor de
 * activación de hueco parcial NACE aquí, por el mismo motivo de dueño único.
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

/**
 * AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 §§ 2, 4 — ¿puede la capa gratuita
 * aportar un hueco PARCIAL a una corrida Lusha de pago?
 *
 * 🔴 CONTENCIÓN, no capacidad. La maquinaria de hueco parcial existe entera y
 * sigue probada: `runPrePaidNoveltyDiscovery` la soporta, `residualGap` se
 * calcula, `resolveLushaTargetGap` lo recibe y `canAcceptLushaUsefulCandidate`
 * lo hace cumplir dentro de cada página pagada. Nada de eso se toca aquí.
 *
 * Lo que esta constante apaga es la ACTIVACIÓN VIVA, y el motivo es el mismo por
 * el que la ruta Apollo ya está en `false` (`WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`):
 *
 * Con `true` existe una ruta REAL de producción en la que UNA búsqueda del
 * usuario termina en DOS lotes. Objetivo 10, la fuente gratuita persiste 7 en su
 * PROPIO lote —`persistCountrySourceCandidates` lo crea y corre ANTES de la
 * reserva— y Lusha persiste 3 en el suyo, con el resultado devuelto apuntando al
 * segundo. La invariante de sistema se respeta (7 + 3 <= 10); el resultado ÚNICO
 * que el producto promete, no.
 *
 * 🔴 Y es alcanzable de verdad, no teórica: este comportamiento está VIVO hoy en
 * la superficie Lusha. La persistencia gratuita quedó arreglada por #316 —lote
 * `source = agent_1`, candidato `source_primary = public_source`— y la QA-B real
 * en Producción la vio escribir. Lo que bloquea no es un CHECK de base de datos:
 * es que esta superficie tampoco tiene el ancla durable de idempotencia/lote que
 * el diseño de lote único necesita, así que no hay forma de que el ejecutor de
 * pago ADOPTE el lote de la capa gratuita.
 *
 * Consecuencia con `false` (ver la cabecera del runner compartido):
 *
 *   · lo gratuito cierra el objetivo ENTERO ⇒ el lote gratuito persiste, Lusha no
 *     se ejecuta, 0 reservas y 0 créditos — la propiedad probada en Producción NO
 *     se toca;
 *   · lo gratuito NO cierra el objetivo ⇒ su aporte parcial se DESCARTA antes de
 *     persistir, y la ruta de pago corre con el objetivo COMPLETO, exactamente
 *     como se comportaba antes de que esta superficie llamara a la capa gratuita.
 *
 * El hito que lo activará —y que decidirá orden y propiedad del lote— es
 * `AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1`. Esto es contención hasta entonces.
 *
 * 🔴 Esta constante es el ÚNICO sitio donde el valor vivo se decide. Existe para
 * que el ratchet de cableado pueda leer el mismo valor que produce producción en
 * vez de una copia escrita a mano que podría quedarse atrás.
 */
export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = false;
