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
// v1 ES LUSHA-ONLY, Y ESO NO ES UN RECORTE DE ALCANCE
// ═══════════════════════════════════════════════════════════════════
//
// «Buscar más números» consulta EXACTAMENTE UN proveedor: Lusha. Apollo NO tiene camino
// aquí, y no por prudencia sino porque no existe la operación:
//
//   * el payload terminal de Apollo trae TODOS los teléfonos que Apollo tiene —en hasta
//     tres ubicaciones— y desde 4O-C `apollo-phone-collection-capture.ts` persiste todos.
//     Apollo no expone ninguna operación de «más teléfonos» ni pagina su respuesta, así
//     que repetirlo cobraría otra vez por el payload que ya está guardado;
//   * `/v3/contacts/enrich` de Lusha con `reveal: ['phones']` devuelve
//     `results[0].phones[]` completo y desde 4O-D `lusha-phone-fallback-phones.ts` lee el
//     array entero. Lo mismo: su respuesta ya está entera.
//
// Lo que esta operación compra, entonces, no es «pedir más al mismo proveedor»: es
// consultar al OTRO proveedor cuya identidad nativa el candidato ya lleva. En la práctica
// el candidato que llega aquí fue revelado por Apollo (Apollo es la primera pata del
// waterfall), así que el proveedor que falta es SIEMPRE Lusha. Un conjunto de proveedores
// de dos elementos describiría una pata de Apollo que ninguna rama puede ejecutar, y un
// techo de crédito para Apollo autorizaría un gasto que nadie puede cobrar.
//
// ═══════════════════════════════════════════════════════════════════
// LAS TRES REGLAS QUE NO SE NEGOCIAN
// ═══════════════════════════════════════════════════════════════════
//
// 1. LUSHA NO SE LLAMA DOS VECES. Si su procedencia ya está en la colección, ya contestó
//    y su respuesta completa está guardada. Si ya se le consultó por adicionales en una
//    corrida `search_more` TERMINAL, está agotada — y lo está para CUALQUIER desenlace,
//    incluido el error. No hay reintento pagado automático.
//
// 2. SÓLO LA IDENTIDAD NATIVA QUE EL CANDIDATO YA LLEVA. Lusha es consultable únicamente
//    si la FILA del candidato declara `source = 'lusha'` + `source_contact_id`, la MISMA
//    condición que `resolveLushaContactId` y `evaluatePhoneRevealWaterfallLushaLeg`. No se
//    busca por nombre + empresa, ni por email, ni por LinkedIn; no se hace enlace difuso;
//    no se cruzan identidades entre proveedores; y NO existe ninguna ruta a la búsqueda
//    general de personas de Lusha. Sin esa identidad, la operación no existe.
//
// 3. FAIL-CLOSED. Cualquier duda devuelve NO elegible. Un dato ausente, un estado
//    ilegible, una supresión no evaluable: todos bloquean. Nunca se degrada a «adelante».
//
// ═══════════════════════════════════════════════════════════════════
// 4. Y EL PRESUPUESTO ES UN HECHO MÁS (AGENT2A-SEARCH-MORE-PHONES-1K)
// ═══════════════════════════════════════════════════════════════════
//
// Hasta 1J este planificador decidía sobre el CANDIDATO —identidad, fuentes, privacidad— y
// no sobre el DINERO. La consecuencia se vio en Producción: un candidato perfectamente
// elegible mostraba el CTA pagado y el primer clic devolvía «No pudimos iniciar la
// búsqueda», porque el runtime SÍ resolvía el pozo de Lusha y no había ninguna regla de
// crédito activa. 0 llamadas y 0 créditos —el servidor hizo lo correcto— pero la afirmación
// de la pantalla era falsa antes de pulsarla.
//
// Desde 1K el veredicto del presupuesto entra como un hecho más, con el MISMO tipo canónico
// que el gate de reserva del runtime consume, y bloquea igual que los demás. El módulo sigue
// siendo PURO: no lee el pozo, lo recibe.
//
// Esto NO desplaza la autoridad. El runtime vuelve a resolver el presupuesto y a reservar
// dentro de la transacción, porque entre el render y el clic pueden pasar minutos y el saldo
// que se vio puede haberse ido. El plan es una PROMESA HONESTA de la UI; la reserva atómica
// sigue siendo la única autoridad.

import { PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS } from './phone-reveal-waterfall-core';
import {
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
  type PhoneRevealCreditBudgetDecision,
  type PhoneRevealCreditBudgetMode,
} from './phone-reveal-credit-budget-core';

// ═══════════════════════════════════════════════════════════════════
// 1. Vocabulario
// ═══════════════════════════════════════════════════════════════════

/**
 * Proveedores a los que «Buscar más números» puede llegar a consultar. Conjunto CERRADO de
 * UN elemento: Lusha.
 *
 * Es deliberadamente MÁS ESTRECHO que `PHONE_REVEAL_CREDIT_PROVIDER_KEYS`, y la diferencia
 * es el contrato de v1. Añadir `apollo` aquí sin una operación de Apollo que produzca
 * números que Apollo no haya dado ya sería declarar consultable a un proveedor cuya
 * respuesta completa está guardada desde 4O-C: autorizaría un gasto por el mismo payload.
 */
export const SEARCH_MORE_PROVIDERS = ['lusha'] as const;

export type SearchMoreProvider = (typeof SEARCH_MORE_PROVIDERS)[number];

/** El único proveedor de v1. Se nombra para que ninguna rama tenga que elegirlo. */
export const SEARCH_MORE_PROVIDER: SearchMoreProvider = 'lusha';

/**
 * Estado del candidato respecto de esta operación. Es lo que distingue «revelar» de
 * «buscar más», y por qué el planificador NO se limita a devolver un booleano: la UI tiene
 * que poder mostrar el CTA correcto, y «no hay teléfono» exige el botón de reveal normal,
 * no una versión deshabilitada de este.
 */
export type SearchMorePhase =
  /** Sin teléfono almacenado. El camino correcto es «Revelar teléfono», no este. */
  | 'no_phone_yet'
  /** Hay teléfono y Lusha queda por consultar. */
  | 'has_phone_provider_available'
  /** Hay teléfono y Lusha NO es consultable. */
  | 'has_phone_no_provider_available'
  /** Ya hay una operación de teléfono viva sobre este candidato. */
  | 'search_more_already_running'
  /** Lusha ya fue consultada por adicionales en una corrida terminal. */
  | 'providers_exhausted'
  /** Bloqueo de privacidad (suprimido o no evaluable). Fail-closed. */
  | 'privacy_blocked'
  /**
   * El pozo de Lusha no puede respaldar los 5 créditos que esta operación reserva
   * (AGENT2A-SEARCH-MORE-PHONES-1K). Es una fase PROPIA y no `has_phone_no_provider_available`
   * porque no dice nada del candidato: la fuente sigue ahí y la identidad también; lo que
   * falta es saldo, configuración, o la lectura misma del presupuesto. Colapsarla en la fase
   * de «no queda proveedor» le diría al operador que este contacto está agotado cuando lo
   * que ocurre es que la plataforma no puede pagar.
   */
  | 'budget_blocked';

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
  /**
   * Lusha ya CONTESTÓ para este candidato: su procedencia está en la colección, así que su
   * respuesta completa ya está guardada y no queda otra fuente que consultar.
   */
  | 'no_additional_provider'
  /** Lusha ya se consultó por adicionales en una corrida `search_more` terminal. */
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
  /**
   * El candidato NO lleva identidad nativa de Lusha (`source = 'lusha'` +
   * `source_contact_id`), así que no hay a quién consultar ni identidad sobre la que la
   * privacidad pudiera evaluarse. Es el mismo bloqueo que #291 puso en el reveal normal.
   */
  | 'missing_person_identity'
  // ── Presupuesto (AGENT2A-SEARCH-MORE-PHONES-1K) ──────────────
  //
  // Los TRES códigos son EXACTAMENTE los que el gate de reserva del runtime
  // (`reserveWaterfallCreditsAndCreateRunOrBlock`) devuelve para esos mismos tres hechos. No
  // se inventa un vocabulario paralelo, y no es cosmética: cuando el runtime bloquea, su
  // motivo viaja como `not_started(reason)` y la UI lo traduce con el MISMO mapa de copy que
  // usa para el plan. Un código distinto a cada lado obligaría a mantener dos traducciones
  // del mismo bloqueo, y la que se olvidara caería en el genérico «No pudimos iniciar la
  // búsqueda» — que es exactamente el síntoma que este hito elimina.
  //
  // Y NO se colapsan entre sí. Los tres deshabilitan igual, pero le dicen al operador cosas
  // distintas: al primero le falta saldo, al segundo le falta que un administrador configure
  // la regla, y del tercero no se sabe nada — afirmar cualquiera de los otros dos sería
  // declarar un hecho que nadie comprobó.
  /** Hay regla de crédito de Lusha, pero no cubre los 5 créditos de la pata. */
  | 'insufficient_credits'
  /** NO hay regla de crédito EN CRÉDITOS para Lusha: no hay disponibilidad que reservar. */
  | 'budget_not_configured'
  /** El presupuesto NO se pudo leer. Fail-closed, y sin afirmar cuál de los otros dos es. */
  | 'credit_balance_unavailable';

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

  /**
   * `source` del candidato. La identidad de Lusha exige EXACTAMENTE `'lusha'`.
   *
   * `apollo_person_id` NO se lee: en v1 no existe pata de Apollo, y leerlo sugeriría que
   * una identidad de Apollo puede habilitar una consulta que ninguna rama ejecuta.
   */
  source: string | null;
  /** `source_contact_id` — el id de contacto de Lusha cuando `source = 'lusha'`. */
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

  /**
   * Veredicto del PRESUPUESTO de Lusha, ya resuelto por quien llama
   * (AGENT2A-SEARCH-MORE-PHONES-1K).
   *
   * Es el tipo CANÓNICO del core de crédito —el mismo valor que produce
   * `evaluatePhoneRevealCreditBudget` y el mismo que el gate del runtime consume— y no un
   * booleano ni un número de créditos disponibles, por dos razones:
   *
   *   * un booleano colapsaría «no alcanza», «no hay regla» y «no se pudo leer» en un solo
   *     hecho, y son tres cosas distintas que el operador tiene que poder distinguir;
   *   * un número obligaría a este módulo a repetir la fórmula
   *     `limite - consumido - reservado` y a compararla contra su propio techo. Esa fórmula
   *     ya vive en UN sitio (el core, espejo del SQL de la migración 104) y duplicarla aquí
   *     es exactamente la divergencia que este hito existe para cerrar: el preflight
   *     autorizaba un CTA que el runtime rechazaba porque el preflight NO miraba el pozo.
   *
   * Sigue siendo PURO: el veredicto llega como dato, igual que `privacyState`.
   *
   * NO admite un valor «todavía no lo sé». `privacyState` sí lo admite porque el cliente
   * puede pintar antes de resolverla y el servidor revalida; el presupuesto lo resuelve
   * SIEMPRE el servidor en la misma lectura que produce el plan, así que un estado
   * permisivo aquí sólo podría servir para autorizar un CTA sin haber mirado el pozo.
   */
  budgetDecision: PhoneRevealCreditBudgetDecision;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Salida
// ═══════════════════════════════════════════════════════════════════

/**
 * Techo de la ÚNICA pata que esta operación puede cobrar: 5 créditos, el tope de una pata
 * de Lusha. Es la MISMA cifra que `legacy_lusha_only`, y viene de la misma constante en vez
 * de repetirse como literal para que no puedan separarse.
 *
 * NUNCA son los 13 del waterfall completo ni los 8 de Apollo: Apollo no corre bajo esta
 * autorización, así que su techo no tiene nada que autorizar aquí.
 */
export const SEARCH_MORE_MAX_CREDITS =
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS;

/**
 * Techo por proveedor. Se conserva la forma de mapa —con una sola clave— porque es lo que
 * leen el servidor y la confirmación, y porque un mapa exhaustivo sobre
 * `SearchMoreProvider` hace que añadir un proveedor rompa la compilación en vez de
 * autorizarlo con un techo por defecto.
 */
export const SEARCH_MORE_PROVIDER_MAX_CREDITS: Readonly<
  Record<SearchMoreProvider, number>
> = {
  lusha: SEARCH_MORE_MAX_CREDITS,
};

/**
 * LA modalidad presupuestaria de esta operación. Una pata, un pozo: el de Lusha, y sólo el
 * de Lusha.
 *
 * Se EXPORTA desde 1K porque tiene que ser la misma en los tres sitios que la usan —el
 * preflight que decide si el CTA existe, el planificador que declara el plan, y la reserva
 * atómica del runtime— y porque de ella salen a la vez el proveedor cuyo pozo se lee y los
 * créditos que se exigen. Escrita tres veces como literal, la primera corrección movería una
 * sola: el preflight miraría un pozo y el runtime reservaría contra otro, que es la clase de
 * divergencia que este hito cierra.
 */
export const SEARCH_MORE_BUDGET_MODE: PhoneRevealCreditBudgetMode = 'search_more_lusha';

/** Modalidad por proveedor. DERIVADA de la de arriba: no puede separarse de ella. */
const SEARCH_MORE_BUDGET_MODE_BY_PROVIDER: Readonly<
  Record<SearchMoreProvider, PhoneRevealCreditBudgetMode>
> = {
  lusha: SEARCH_MORE_BUDGET_MODE,
};

export interface SearchMorePlan {
  eligible: boolean;
  phase: SearchMorePhase;
  reason: SearchMoreIneligibleReason | null;
  /**
   * Proveedores que ESTA corrida consultará: `['lusha']` cuando es elegible, `[]` cuando
   * no. Se mantiene como lista —y no como un booleano— porque es lo que la confirmación
   * necesita para NOMBRAR la fuente, y nombrarla es parte de lo que el operador acepta.
   *
   * No existe una lista de «diferidos»: con un solo proveedor posible, una corrida elegible
   * agota todas las fuentes disponibles, y prometerle al operador que «quedará otra fuente
   * por consultar aparte» sería falso.
   */
  providersToTry: readonly SearchMoreProvider[];
  /**
   * Techo de créditos que el operador debe aceptar. Es el UMBRAL de confirmación, no una
   * predicción del cobro: el costo real sale de lo que reporte el proveedor. Coincide
   * EXACTAMENTE con lo que se reservará.
   */
  maxCreditRequirement: number;
  /** Modalidad presupuestaria con la que se reservará. null cuando no es elegible. */
  budgetMode: PhoneRevealCreditBudgetMode | null;
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
  budgetMode: null,
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
 * La identidad nativa que ESTA fila del candidato declara para el ÚNICO proveedor de v1.
 *
 * Condición ÚNICA y exacta: `source = 'lusha'` + `source_contact_id` no vacío. Es la MISMA
 * que aplica `resolveLushaContactId`, reafirmada aquí sin relajar nada. Lo que NO se mira,
 * y no es una omisión: nombre, email, LinkedIn, empresa, dominio, `apollo_person_id`, ni
 * ningún otro registro. No hay enlace difuso, no hay cruce entre proveedores y no hay vía
 * a la búsqueda general de personas de Lusha.
 *
 * Devuelve una lista (de 0 o 1 elementos) y no un booleano porque es lo que consume el
 * plan, y porque así el día que exista una segunda fuente REAL el tipo ya la admite sin
 * que nadie tenga que recordar convertirlo.
 */
export function resolveSearchMoreNativeProviders(
  input: Pick<SearchMorePlannerInput, 'source' | 'sourceContactId'>,
): readonly SearchMoreProvider[] {
  const isLushaNative =
    cleanText(input.source)?.toLowerCase() === 'lusha' &&
    !!cleanText(input.sourceContactId);

  return isLushaNative ? ['lusha'] : [];
}

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
    // Sin identidad nativa de Lusha no hay a quién llamar Y la privacidad no es ni
    // formulable: el gate de supresión de #295 se resuelve por `(provider,
    // provider_person_id)`, así que sin ese id no hay pregunta que hacerle. Es el mismo
    // bloqueo que #291 puso en el reveal normal.
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

  // REGLA 1, aplicada. Lusha queda fuera por CUALQUIERA de dos motivos, y son distintos:
  //   * ya tiene procedencia almacenada ⇒ ya contestó, y su respuesta completa está
  //     guardada desde 4O-D. Volver a llamarla pagaría por el mismo payload;
  //   * ya se le consultó por adicionales en una corrida `search_more` TERMINAL ⇒ agotada,
  //     y lo está para cualquier desenlace de esa corrida, error incluido (§18).
  const candidates = nativeProviders.filter(
    (provider) => !withProvenance.has(provider) && !alreadySearched.has(provider),
  );

  if (candidates.length === 0) {
    // Se distingue «agotado por haber buscado ya» de «Lusha ya contestó». Los dos
    // deshabilitan el botón, pero el copy honesto es diferente y el operador merece saber
    // cuál de los dos es: el primero ya gastó créditos, el segundo nunca los necesitó.
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

  // PRESUPUESTO, y es el ÚLTIMO gate (AGENT2A-SEARCH-MORE-PHONES-1K). Va después de todo lo
  // que describe al CANDIDATO —identidad, fuentes, privacidad— y antes de declarar el plan
  // elegible, por dos motivos:
  //
  //   * el orden decide qué motivo GANA cuando dos bloquean a la vez, y un candidato
  //     suprimido tiene que decir que está suprimido aunque además falte saldo: el bloqueo de
  //     privacidad es un hecho sobre la persona y el de presupuesto es operativo. Al revés,
  //     un problema de tesorería taparía una restricción de privacidad;
  //   * y porque es lo que el runtime hará de todos modos: sin exposición reservada no hay
  //     corrida. Declarar elegible un plan que la reserva va a rechazar es exactamente el
  //     CTA fantasma que este hito elimina.
  //
  // FAIL-CLOSED: sólo `authorized` continúa. Los otros tres bloquean con su motivo EXACTO, y
  // el `default` —inalcanzable hoy— bloquea con el más incierto de los tres, que es el único
  // que no afirma nada que no se haya comprobado.
  if (input.budgetDecision !== 'authorized') {
    switch (input.budgetDecision) {
      case 'insufficient_credits':
        return NOT_ELIGIBLE('budget_blocked', 'insufficient_credits');
      case 'budget_not_configured':
        return NOT_ELIGIBLE('budget_blocked', 'budget_not_configured');
      case 'balance_unavailable':
        return NOT_ELIGIBLE('budget_blocked', 'credit_balance_unavailable');
      default:
        return NOT_ELIGIBLE('budget_blocked', 'credit_balance_unavailable');
    }
  }

  // `candidates` tiene exactamente un elemento aquí: `nativeProviders` sale de un conjunto
  // de un solo proveedor y este punto sólo se alcanza si no quedó filtrado.
  const providerToTry = candidates[0];

  return {
    eligible: true,
    phase: 'has_phone_provider_available',
    reason: null,
    providersToTry: [providerToTry],
    // El techo de ESA pata, no una suma. Nunca los 13 del waterfall completo ni los 8 de
    // Apollo: Apollo no corre bajo esta autorización.
    maxCreditRequirement: SEARCH_MORE_PROVIDER_MAX_CREDITS[providerToTry],
    budgetMode: SEARCH_MORE_BUDGET_MODE_BY_PROVIDER[providerToTry],
    alreadyExhausted: false,
  };
}
