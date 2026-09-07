/**
 * wizard-target-authority.ts — UNA sola autoridad del objetivo del wizard.
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 1.
 *
 * ── 🔴 Qué decide este archivo ───────────────────────────────────────────────
 *
 * Cuántas EMPRESAS ÚTILES busca reunir UNA ejecución del wizard, contando todas
 * sus piernas (capa gratuita, Apollo R1, Apollo R2 y —bajo su flag— Lusha R1).
 * Es el número con el que se decide SUFICIENCIA: cuándo dejar de buscar.
 *
 * ── 🔴 Qué NO es ─────────────────────────────────────────────────────────────
 *
 * · NO es un límite de resultados del proveedor. Apollo sigue pidiendo
 *   `per_page = 100` (`APOLLO_CONTRACT_MAX_PER_PAGE`) y hasta
 *   `WIZARD_APOLLO_MAX_PAGES_HARD_CAP` (5) páginas por ronda; Lusha sigue con su
 *   tamaño contractual (`LUSHA_PROSPECTING_PAGE_SIZE`). Este número no aparece
 *   en ningún request.
 * · NO es un límite de EVALUACIÓN. Todo lo que ya se pagó se evalúa localmente
 *   (CORTE 2); alcanzar el objetivo detiene la SIGUIENTE compra, nunca la
 *   lectura de lo comprado.
 * · NO es un techo de presupuesto. El gasto lo gobiernan las páginas de Apollo,
 *   `MAX_ENRICHMENTS_PER_RUN_*` y la reserva atómica del wizard. Ninguno de los
 *   tres lee esta constante.
 *
 * ── 🔴 Por qué existe un archivo entero para un número ───────────────────────
 *
 * Antes había DOS autoridades vivas con valores distintos:
 *
 *   WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES = 10  (wizard-apollo-executor)
 *   TARGET_ELIGIBLE_COMPANIES_DEFAULT           = 10  (apollo-two-round/config)
 *
 * — más un tope absoluto propio (`TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX`) que
 * permitía que una variable de entorno moviera el objetivo de una de las dos
 * rutas sin mover la otra. Dos números que se mantienen iguales "por acuerdo"
 * son dos números que se desincronizan en cuanto uno cambia: la aceptación se
 * calculaba contra uno y la metadata publicaba el otro.
 *
 * La decisión de producto fija UN objetivo: **5 empresas útiles**. Ambas rutas
 * lo DERIVAN de aquí; ninguna vuelve a declarar un literal propio.
 */

/**
 * Empresas útiles que una ejecución del wizard intenta reunir. Autoridad única.
 *
 * "Útil" = la MISMA población que puede terminar como candidato revisable, la
 * que cuenta `stableFinalizableCandidateCount` en el orquestador de dos rondas:
 * fail-closed, sin condición pendiente ni admisión writer-only sin resolver. No
 * es un contador histórico de net-new ni de resultados crudos.
 */
export const WIZARD_TARGET_USEFUL_COMPANIES = 5;
