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
 * AGENT1-LOCAL-CUT9-LUSHA-PARTIAL-GAP-ACTIVATION § 1 — ¿puede la capa gratuita
 * aportar un hueco PARCIAL a una corrida Lusha de pago?
 *
 * 🔴 `true` desde CUT-9, y la asimetría con la historia de esta constante importa:
 * durante AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 el valor fue `false` y NO por
 * falta de capacidad. La maquinaria de hueco parcial existía entera y probada
 * —`runPrePaidNoveltyDiscovery` la soporta, `residualGap` se calcula,
 * `resolveLushaTargetGap` lo recibe y `canAcceptLushaUsefulCandidate` lo hace
 * cumplir dentro de cada página pagada—. Lo que faltaba era DÓNDE persistir el
 * aporte sin partir el resultado: la capa gratuita creaba su propio lote y la de
 * pago el suyo, así que con `true` UNA búsqueda del usuario terminaba en DOS lotes,
 * y ese comportamiento estuvo VIVO en Producción hasta la contención.
 *
 * Las tres condiciones que lo bloqueaban están cerradas, y son distintas:
 *
 *   · SABER aceptar un objetivo reducido — cerrada desde el ejecutor multirrama:
 *     `resolveLushaTargetGap` recibe el hueco y `canAcceptLushaUsefulCandidate` lo
 *     hace cumplir DENTRO de cada página ya pagada.
 *   · Tener DÓNDE persistirlo sin partir el resultado — cerrada por
 *     AGENT1-LOCAL-CUT9A: `createCanonicalLushaBatchResolver` da UN lote canónico
 *     por EJECUCIÓN, identificado por `(created_by, client_request_id)`, y las dos
 *     mitades preguntan a la MISMA instancia. La mitad de pago ADOPTA (23505 →
 *     relectura por clave canónica), no crea un segundo lote.
 *   · Poder escribir sobre un lote ADOPTADO sin `stale` falso — cerrada por
 *     CUT9A-FIX-ADOPTED-EPOCH-REFRESH: la época se RELEE justo antes de la
 *     escritura vallada en vez de heredarse memoizada del nacimiento del lote.
 *
 * 🔴 Lo que la activación NO trae, y hay que decirlo: la invariante de § 14
 * —`aceptadasGratis + aceptadasPagadas <= objetivo`— la sigue sosteniendo el HUECO,
 * no el descarte. La ruta de pago recibe `residualGap` como `targetGap`, así que 4
 * gratis + 6 de pago siguen siendo 10, nunca 14.
 *
 * 🔴 Y tampoco trae presupuesto nuevo. `estimateLushaRunCredits` sigue derivando la
 * reserva del PLAN de ramas (2/4/6) y no del hueco: con hueco 1 una rama puede
 * necesitar dos páginas igual. El hueco gobierna cuántas empresas se ACEPTAN, no
 * cuánto se reserva (CUT-9 § 11).
 *
 * 🔴 Esta constante es el ÚNICO sitio donde el valor vivo se decide. Existe para
 * que el ratchet de cableado pueda leer el mismo valor que produce producción en
 * vez de una copia escrita a mano que podría quedarse atrás.
 *
 * 🔴 La rama todo-o-nada del runner compartido NO se borra: sigue siendo el
 * comportamiento de cualquier ruta que pase `false`, y sus pruebas la invocan con
 * el literal en vez de con esta constante.
 */
export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = true;
