// Agente 2A — PLANIFICADOR de «Buscar más números»
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// ═══════════════════════════════════════════════════════════════════
// QUÉ DECIDE, Y POR QUÉ ES UN MÓDULO PROPIO
// ═══════════════════════════════════════════════════════════════════
//
// Responde UNA pregunta: ¿puede este candidato pedir números ADICIONALES, a quién se le
// pedirían, y cuánto puede costar como máximo?
//
// Vive separado del JSX y separado del runtime por la misma razón que
// `phone-reveal-identity-eligibility.ts`: el botón y el servidor tienen que decidir con la
// MISMA función. Un planificador embebido en el componente obligaría al servidor a
// reimplementar la regla, y la primera divergencia sería un botón que ofrece una compra
// que el servidor rechaza — o peor, un botón que la ofrece cuando el servidor la ACEPTA
// pero no debería.
//
// PURO: sin I/O, sin env, sin reloj, sin Supabase, sin `console`. Seguro en el bundle del
// cliente y ejecutable offline.
//
// ═══════════════════════════════════════════════════════════════════
// LAS TRES REGLAS QUE NO SE NEGOCIAN
// ═══════════════════════════════════════════════════════════════════
//
// 1. UN PROVEEDOR QUE YA RESPONDIÓ NO SE VUELVE A LLAMAR.
//
//    No es una heurística de ahorro: es una consecuencia del contrato de los dos
//    proveedores. El payload terminal de Apollo trae TODOS los teléfonos que Apollo tiene
//    —en hasta tres ubicaciones— y desde 4O-C `apollo-phone-collection-capture.ts`
//    persiste todos. `/v3/contacts/enrich` de Lusha con `reveal: ['phones']` devuelve
//    `results[0].phones[]` completo y desde 4O-D `lusha-phone-fallback-phones.ts` lee el
//    array entero. Ninguno de los dos expone una operación de «más teléfonos» ni pagina
//    su respuesta.
//
//    Así que repetir un proveedor que ya contestó cobraría otra vez por recibir el payload
//    que ya está guardado. No hay reintento pagado a ciegas.
//
// 2. SÓLO IDENTIDADES NATIVAS QUE EL CANDIDATO YA LLEVA.
//
//    Un proveedor es consultable únicamente si la FILA del candidato ya carga su id
//    nativo. No se busca por nombre + empresa, no se busca por email, no se hace enlace
//    difuso y no se cruzan identidades entre proveedores. En particular NO existe ninguna
//    ruta a la búsqueda general de personas de Lusha: sin `source = 'lusha'` +
//    `source_contact_id`, la pata de Lusha simplemente no existe — la misma regla, sin
//    relajar, que `resolveLushaContactId` y `evaluatePhoneRevealWaterfallLushaLeg`.
//
//    Las dos identidades que este planificador lee viven en la MISMA fila del MISMO
//    candidato, que representa a UNA persona. Eso es exactamente el alcance ya sancionado
//    de `resolveAllPhoneRevealProviderIdentities` (usado por el camino de escritura de la
//    supresión desde #295) y NO convierte esto en la Fase 2.
//
// 3. FAIL-CLOSED. Cualquier duda devuelve NO elegible. Un dato ausente, un estado
//    ilegible, una supresión no evaluable: todos bloquean. Nunca se degrada a «adelante».

import { resolvePhoneRevealProviderIdentity } from './provider-suppression-core';
import {
  PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS,
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
} from './phone-reveal-waterfall-core';

// ═══════════════════════════════════════════════════════════════════
// 1. Vocabulario
// ═══════════════════════════════════════════════════════════════════

/**
 * Proveedores a los que «Buscar más números» puede llegar a consultar. Conjunto CERRADO y
 * deliberadamente igual al de `PHONE_REVEAL_CREDIT_PROVIDER_KEYS`: añadir uno aquí sin
 * añadirle presupuesto sería autorizar un gasto sin pozo contra el que reservarlo.
 */
export const SEARCH_MORE_PROVIDERS = ['apollo', 'lusha'] as const;

export type SearchMoreProvider = (typeof SEARCH_MORE_PROVIDERS)[number];

/**
 * Estado del candidato respecto de esta operación. Es lo que distingue «revelar» de
 * «buscar más», y por qué el planificador NO se limita a devolver un booleano: la UI tiene
 * que poder mostrar el CTA correcto, y «no hay teléfono» exige el botón de reveal normal,
 * no una versión deshabilitada de este.
 */
export type SearchMorePhase =
  /** Sin teléfono almacenado. El camino correcto es «Revelar teléfono», no este. */
  | 'no_phone_yet'
  /** Hay teléfono y queda al menos un proveedor seguro por consultar. */
  | 'has_phone_provider_available'
  /** Hay teléfono y NO queda proveedor seguro. */
  | 'has_phone_no_provider_available'
  /** Ya hay una operación de teléfono viva sobre este candidato. */
  | 'search_more_already_running'
  /** Todos los proveedores con identidad nativa ya fueron consultados por adicionales. */
  | 'providers_exhausted'
  /** Bloqueo de privacidad (suprimido o no evaluable). Fail-closed. */
  | 'privacy_blocked';

/**
 * Por qué NO se puede. Vocabulario cerrado, PII-free y mecánico: viaja a la UI y al
 * diagnóstico. Cada valor tiene un copy propio en `search-more-phones-copy.ts`.
 */
export type SearchMoreIneligibleReason =
  | 'feature_disabled'
  | 'role_not_allowed'
  | 'invalid_candidate'
  | 'candidate_not_editable'
  /** Sin teléfono almacenado: corresponde el reveal normal. */
  | 'no_stored_phone'
  /** Ningún proveedor con identidad nativa queda sin consultar. */
  | 'no_additional_provider'
  /** Todos los proveedores elegibles ya se consultaron por adicionales. */
  | 'providers_exhausted'
  /** Hay una corrida de teléfono NO terminal sobre este candidato. */
  | 'active_run_exists'
  /** Tombstone confirmado. */
  | 'blocked_suppressed'
  | 'do_not_contact'
  /**
   * La privacidad NO se pudo evaluar. Bloquea IGUAL que un tombstone confirmado, pero se
   * registra distinto: el efecto es el mismo, la afirmación no. SellUp no declara un
   * veredicto de privacidad que nunca obtuvo.
   */
  | 'suppression_check_unavailable'
  /** No existe identidad nativa con la que la privacidad pudiera evaluarse. */
  | 'missing_person_identity';

// ═══════════════════════════════════════════════════════════════════
// 2. Entrada
// ═══════════════════════════════════════════════════════════════════

/**
 * Estado de privacidad ya resuelto por quien llama. El planificador NO lo consulta: es
 * puro. El servidor pasa el resultado real; el cliente pasa `unknown` cuando todavía no lo
 * sabe, y `unknown` NO bloquea la elegibilidad de UI (el botón puede mostrarse) pero
 * tampoco la autoriza — la autoridad es siempre el servidor, que revalida.
 */
export type SearchMorePrivacyState =
  | 'clear'
  | 'blocked_suppressed'
  | 'do_not_contact'
  | 'check_unavailable'
  /** Todavía no evaluado. Sólo lo usa el cliente. */
  | 'unknown';

export interface SearchMorePlannerInput {
  /** Permiso de producto ya resuelto. */
  featureEnabled: boolean;
  /** Rol del actor. `admin` es el único autorizado, igual que el resto del subsistema. */
  actorRoleKey: string | null;

  candidateId: string | null;
  /** `contact_enrichment_candidates.status`. */
  candidateStatus: string | null;

  /**
   * Cuántos teléfonos DISTINTOS y NO suprimidos tiene hoy la colección. Es un conteo, no
   * los números: el planificador nunca ve un teléfono.
   */
  storedUnsuppressedPhoneCount: number;

  /** `apollo_person_id` (mig. 098). */
  apolloPersonId: string | null;
  /** `source` del candidato. */
  source: string | null;
  /** `source_contact_id`. */
  sourceContactId: string | null;

  /**
   * Proveedores cuya PROCEDENCIA ya aparece en la colección de este candidato. Se deriva
   * de `contact_enrichment_candidate_phone_sources`, es decir de lo que realmente se
   * escribió, NO de un contador de intentos: un contador también sube en caminos de error,
   * así que no afirma que el proveedor haya contestado.
   */
  providersWithStoredProvenance: readonly string[];

  /**
   * Proveedores ya consultados por ADICIONALES en una corrida `search_more` TERMINAL. Es
   * lo que impide gastar dos veces contra la misma combinación agotada (§15).
   */
  providersAlreadySearchedForMore: readonly string[];

  /** ¿Hay una corrida de teléfono NO terminal? */
  hasActivePhoneRun: boolean;

  privacyState: SearchMorePrivacyState;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Salida
// ═══════════════════════════════════════════════════════════════════

export interface SearchMorePlan {
  eligible: boolean;
  phase: SearchMorePhase;
  reason: SearchMoreIneligibleReason | null;
  /**
   * Proveedores a consultar, EN ORDEN. Vacío cuando no es elegible. Nunca contiene un
   * proveedor que ya tenga procedencia almacenada ni uno ya consultado por adicionales.
   */
  providersToTry: readonly SearchMoreProvider[];
  /**
   * Techo de créditos que el operador debe aceptar. Es el UMBRAL de confirmación, no una
   * predicción del cobro: el costo real sale de lo que reporte el proveedor.
   */
  maxCreditRequirement: number;
  /** true cuando ya no queda ningún proveedor seguro por consultar. */
  alreadyExhausted: boolean;
}

const NOT_ELIGIBLE = (
  phase: SearchMorePhase,
  reason: SearchMoreIneligibleReason,
  alreadyExhausted = false,
): SearchMorePlan => ({
  eligible: false,
  phase,
  reason,
  providersToTry: [],
  maxCreditRequirement: 0,
  alreadyExhausted,
});

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Estados en los que el candidato ya no se edita. Mismo criterio que la ruta legacy
 * (`PHONE_REVEAL_WATERFALL_LEGACY_TERMINAL_CANDIDATE_STATUSES`); se reafirma aquí en vez de
 * importarse porque la lista de la ruta legacy describe cuándo NO reautorizar un reveal, y
 * confundir las dos intenciones haría que un cambio en una moviera la otra sin querer.
 */
const NON_EDITABLE_CANDIDATE_STATUSES: readonly string[] = [
  'approved',
  'rejected',
  'discarded',
  'archived',
];

/**
 * TODAS las identidades nativas que ESTA fila del candidato declara. No es inferencia
 * entre proveedores: las dos están escritas en la MISMA fila, que representa a UNA
 * persona. No se mira nombre, email, LinkedIn, empresa ni dominio, y no se cruza con
 * ningún otro registro.
 *
 * Espejo por REUTILIZACIÓN de las reglas del servidor:
 *   * Apollo  — `resolvePhoneRevealProviderIdentity`, que ya conoce la precedencia
 *               (`apollo_person_id`, y `source_contact_id` sólo si `source = 'apollo'`);
 *   * Lusha   — `source = 'lusha'` + `source_contact_id`, la MISMA condición que
 *               `resolveLushaContactId`. Sin ella no hay pata Lusha, y NO existe ninguna
 *               vía alternativa: la búsqueda general de Lusha no se contempla aquí.
 */
export function resolveSearchMoreNativeProviders(
  input: Pick<SearchMorePlannerInput, 'apolloPersonId' | 'source' | 'sourceContactId'>,
): readonly SearchMoreProvider[] {
  const found: SearchMoreProvider[] = [];

  const primary = resolvePhoneRevealProviderIdentity({
    apolloPersonId: input.apolloPersonId ?? null,
    source: input.source ?? null,
    sourceContactId: input.sourceContactId ?? null,
  });
  if (primary?.provider === 'apollo') found.push('apollo');

  // La identidad de Lusha del MISMO registro, que la precedencia de Apollo habría tapado.
  // Se pide explícitamente en vez de reordenar la precedencia, porque el orden de lectura
  // del servidor tiene que seguir siendo idéntico al histórico.
  if (
    cleanText(input.source)?.toLowerCase() === 'lusha' &&
    cleanText(input.sourceContactId)
  ) {
    if (!found.includes('lusha')) found.push('lusha');
  }

  return found;
}

/**
 * Orden de consulta. Lusha primero cuando los dos están disponibles, porque en la práctica
 * el candidato que llega aquí fue revelado por Apollo (Apollo es la primera pata del
 * waterfall), así que Lusha es casi siempre el que falta. El orden NO es una preferencia de
 * calidad: cualquiera de los dos que quede sin consultar se consulta.
 */
const SEARCH_MORE_PROVIDER_ORDER: readonly SearchMoreProvider[] = ['lusha', 'apollo'];

/**
 * EL planificador. Orden barato→caro, y todo lo que puede evitar una compra se evalúa
 * antes.
 *
 * `phase` y `reason` son independientes a propósito: `phase` es para la UI (qué CTA
 * mostrar) y `reason` para el diagnóstico y el copy (por qué no). Un mismo `phase` puede
 * llegar por dos razones distintas —`has_phone_no_provider_available` por
 * `no_additional_provider` o por `missing_person_identity`— y colapsarlos perdería
 * precisamente el dato que explica el bloqueo.
 */
export function planSearchMorePhones(input: SearchMorePlannerInput): SearchMorePlan {
  if (!input.featureEnabled) {
    return NOT_ELIGIBLE('has_phone_no_provider_available', 'feature_disabled');
  }

  const role = cleanText(input.actorRoleKey);
  if (!role || !PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS.includes(role)) {
    return NOT_ELIGIBLE('has_phone_no_provider_available', 'role_not_allowed');
  }

  if (!cleanText(input.candidateId)) {
    return NOT_ELIGIBLE('has_phone_no_provider_available', 'invalid_candidate');
  }

  const candidateStatus = cleanText(input.candidateStatus);
  if (candidateStatus && NON_EDITABLE_CANDIDATE_STATUSES.includes(candidateStatus)) {
    return NOT_ELIGIBLE('has_phone_no_provider_available', 'candidate_not_editable');
  }

  // SIN TELÉFONO ⇒ este no es el camino. Se devuelve `no_phone_yet` en vez de un bloqueo
  // genérico para que la UI sepa que debe ofrecer «Revelar teléfono» —que sigue intacto—
  // y no una versión deshabilitada de «Buscar más números».
  const storedCount = Number.isInteger(input.storedUnsuppressedPhoneCount)
    ? input.storedUnsuppressedPhoneCount
    : 0;
  if (storedCount < 1) {
    return NOT_ELIGIBLE('no_phone_yet', 'no_stored_phone');
  }

  // Una sola operación de teléfono viva por candidato. Se evalúa ANTES de la privacidad y
  // del presupuesto porque es la comprobación más barata que puede impedir una segunda
  // autorización, y porque el índice único parcial de la migración 102 la va a imponer
  // igualmente en la escritura: rechazar aquí ahorra la corrida y la reserva.
  if (input.hasActivePhoneRun) {
    return NOT_ELIGIBLE('search_more_already_running', 'active_run_exists');
  }

  const nativeProviders = resolveSearchMoreNativeProviders(input);
  if (nativeProviders.length === 0) {
    // Sin identidad nativa la privacidad no es ni formulable, así que tampoco se podría
    // llamar a nadie. Es el mismo bloqueo que #291 puso en el reveal normal.
    return NOT_ELIGIBLE('has_phone_no_provider_available', 'missing_person_identity');
  }

  const withProvenance = new Set(
    input.providersWithStoredProvenance
      .map((p) => cleanText(p)?.toLowerCase())
      .filter((p): p is string => !!p),
  );
  const alreadySearched = new Set(
    input.providersAlreadySearchedForMore
      .map((p) => cleanText(p)?.toLowerCase())
      .filter((p): p is string => !!p),
  );

  // REGLA 1, aplicada. Un proveedor queda fuera por CUALQUIERA de dos motivos, y son
  // distintos:
  //   * ya tiene procedencia almacenada ⇒ ya contestó, y su respuesta completa está
  //     guardada. Volver a llamarlo pagaría por el mismo payload;
  //   * ya se le consultó por adicionales en una corrida `search_more` terminal ⇒ agotado.
  const candidates = SEARCH_MORE_PROVIDER_ORDER.filter(
    (provider) =>
      nativeProviders.includes(provider) &&
      !withProvenance.has(provider) &&
      !alreadySearched.has(provider),
  );

  if (candidates.length === 0) {
    // Se distingue «agotado por haber buscado ya» de «no hay otra fuente». Los dos
    // deshabilitan el botón, pero el copy honesto es diferente y el operador merece saber
    // cuál de los dos es.
    const exhausted = nativeProviders.some((provider) => alreadySearched.has(provider));
    return exhausted
      ? NOT_ELIGIBLE('providers_exhausted', 'providers_exhausted', true)
      : NOT_ELIGIBLE('has_phone_no_provider_available', 'no_additional_provider', true);
  }

  // PRIVACIDAD, fail-closed. Se evalúa DESPUÉS de saber que hay a quién llamar (no tiene
  // sentido consultar la supresión de una operación que no va a ocurrir) y ANTES de
  // declarar el plan elegible. `unknown` es la única que no bloquea: significa «el cliente
  // todavía no lo sabe», y el servidor —que sí lo resuelve— revalida de forma
  // independiente. Nunca se toma como permiso.
  if (input.privacyState === 'blocked_suppressed') {
    return NOT_ELIGIBLE('privacy_blocked', 'blocked_suppressed');
  }
  if (input.privacyState === 'do_not_contact') {
    return NOT_ELIGIBLE('privacy_blocked', 'do_not_contact');
  }
  if (input.privacyState === 'check_unavailable') {
    return NOT_ELIGIBLE('privacy_blocked', 'suppression_check_unavailable');
  }

  return {
    eligible: true,
    phase: 'has_phone_provider_available',
    reason: null,
    providersToTry: candidates,
    // El techo es el de UNA pata de proveedor por cada uno que pueda ejecutarse. No es la
    // suma de los dos salvo que los dos estén realmente disponibles, y nunca son los 13
    // del waterfall completo: Apollo no corre como primera pata aquí.
    maxCreditRequirement: candidates.length * PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
    alreadyExhausted: false,
  };
}
