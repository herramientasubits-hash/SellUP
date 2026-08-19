// Copy de «Buscar más números» (AGENT2A-SEARCH-MORE-PHONES-1)
//
// Aislado del componente para poder afirmarlo en un test sin renderizar, igual que
// `candidate-stored-phones-copy.ts`, `lusha-phone-fallback-copy.ts` y
// `phone-reveal-waterfall-copy.ts`.
//
// ═══════════════════════════════════════════════════════════════════
// LAS DOS REGLAS QUE GOBIERNAN TODO ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════
//
// 1. AQUÍ SÍ SE BUSCA, Y HAY QUE DECIRLO.
//
//    Es el ESPEJO EXACTO de la regla de `candidate-stored-phones-copy.ts`. Allí ninguna
//    cadena puede sugerir que al pulsar se busca algo, porque no se consulta a nadie: se
//    abre lo ya guardado, y el verbo es VER. Aquí ocurre lo contrario y por eso el verbo
//    es BUSCAR, y el costo se nombra explícitamente antes del clic que gasta.
//
//    Las dos operaciones viven a centímetros una de otra en el mismo panel, así que el
//    riesgo real no es que el copy sea aburrido: es que el operador confunda la gratuita
//    con la pagada. Un test estático verifica que este archivo NO reutilice el verbo VER
//    para su acción, y que el de 4O-G no use verbos de búsqueda.
//
//    Por eso el proveedor se NOMBRA. v1 consulta a Lusha y sólo a Lusha, así que la
//    confirmación puede decir «Lusha» en vez de «otra fuente disponible»: el operador
//    acepta un gasto concreto contra un proveedor concreto, no una abstracción.
//
// 2. NUNCA SE AFIRMA MÁS DE LO QUE SE SABE.
//
//    En particular, la diferencia entre «no encontramos números adicionales» y «este
//    contacto no tiene teléfono» es la diferencia entre un hecho y una calumnia sobre el
//    dato. Lusha puede contestar, cobrar, y devolver sólo números que ya estaban: eso es
//    `no_new_distinct_phone`, y el copy correspondiente habla de números ADICIONALES, no
//    de la existencia del teléfono.
//
//    Por la misma razón no se promete un reintento cuando la carencia es estructural (no
//    queda proveedor), y un fallo del proveedor se dice como fallo — nunca como «no
//    encontramos nada», que convertiría un error técnico en un hecho sobre la persona.
//
// PRIVACIDAD: ninguna cadena de este archivo contiene ni construye un número.

import { PHONE_REVEAL_IDENTITY_BLOCKED_COPY } from '@/modules/contact-enrichment/phone-reveal-identity-eligibility';
import type {
  SearchMoreIneligibleReason,
  SearchMoreProvider,
} from '@/modules/contact-enrichment/search-more-phones-planner';

// ── 1. El CTA ──────────────────────────────────────────────────

/**
 * El botón. Dice BUSCAR, no VER: es la única palabra que separa esta acción pagada del
 * disclosure gratuito que está justo al lado.
 */
export const SEARCH_MORE_CTA_LABEL = 'Buscar más números';

/** Mientras la corrida está viva. El teléfono actual sigue visible detrás. */
export const SEARCH_MORE_RUNNING_LABEL = 'Buscando más números…';

// ── 2. La confirmación ─────────────────────────────────────────

/** Título del paso de confirmación. Nombra la acción, no el resultado. */
export const SEARCH_MORE_CONFIRM_TITLE = 'Buscar números adicionales';

/**
 * El cuerpo. Dice TRES cosas y ninguna de más: que se consultará OTRA fuente, que se
 * buscan números DISTINTOS a los que ya hay, y que puede consumir créditos.
 *
 * No promete encontrar nada. «Intentará» es deliberado: el resultado honesto más probable
 * de esta operación es que no haya números adicionales, y el copy no puede preparar al
 * operador para lo contrario.
 */
export const SEARCH_MORE_CONFIRM_BODY =
  'SellUp consultará Lusha para intentar encontrar números diferentes a los que ya tienes.';

/**
 * La advertencia que hace honesta la confirmación. El desenlace MÁS PROBABLE de esta
 * operación es que Lusha devuelva los mismos números que ya están guardados, y en ese caso
 * se cobra igual: Lusha cobra por contestar, no por sorprender.
 *
 * Va en su propia constante y no dentro del cuerpo para que la UI pueda destacarla y para
 * que un test pueda afirmarla por separado. Es la frase que separa «autorizar una búsqueda»
 * de «comprar un resultado».
 */
export const SEARCH_MORE_CONFIRM_COST_WARNING =
  'Puede consumir créditos aunque Lusha no encuentre un número nuevo.';

export const SEARCH_MORE_CONFIRM_CANCEL_LABEL = 'Cancelar';
export const SEARCH_MORE_CONFIRM_ACCEPT_LABEL = 'Buscar más números';

/**
 * Nombre visible del proveedor. Mapa exhaustivo sobre `SearchMoreProvider`, así que un
 * proveedor nuevo rompe la compilación antes de poder mostrarse sin nombre.
 */
const PROVIDER_DISPLAY_NAMES: Readonly<Record<SearchMoreProvider, string>> = {
  lusha: 'Lusha',
};

/**
 * Qué fuente se va a consultar. Se muestra sólo cuando se puede determinar; si la lista
 * llegara vacía se devuelve null y la UI omite la línea, en vez de escribir «se consultará
 * ninguna fuente».
 */
export function getSearchMoreProviderLine(
  providers: readonly SearchMoreProvider[],
): string | null {
  if (providers.length === 0) return null;
  const names = providers.map((provider) => PROVIDER_DISPLAY_NAMES[provider]);
  return names.length === 1
    ? `Fuente que se consultará: ${names[0]}.`
    : `Fuentes que se consultarán: ${names.join(', ')}.`;
}

/**
 * El techo autorizado. Es el MÁXIMO, y la cadena lo dice: el costo real lo reporta el
 * proveedor y suele ser menor. Escribir «costará N créditos» inventaría un precio.
 */
export function getSearchMoreMaxCreditsLine(maxCredits: number): string | null {
  if (!Number.isInteger(maxCredits) || maxCredits <= 0) return null;
  return maxCredits === 1
    ? 'Máximo autorizado: 1 crédito.'
    : `Máximo autorizado: ${maxCredits} créditos.`;
}

// No existe una línea de «fuentes diferidas». En v1 hay UN proveedor, así que una corrida
// elegible agota todas las fuentes disponibles, y anunciar una fuente pendiente para
// después sería una promesa falsa — exactamente lo que este archivo prohíbe.

// ── 3. El resultado ────────────────────────────────────────────

/**
 * ÉXITO. Se dice CUÁNTOS y se dice ADICIONALES, porque el número visible puede no haber
 * cambiado: un número adicional de rango inferior se guarda sin desplazar al principal.
 */
export function getSearchMoreSuccessCopy(newDistinctCount: number): string {
  return newDistinctCount === 1
    ? 'Encontramos 1 número adicional.'
    : `Encontramos ${newDistinctCount} números adicionales.`;
}

/**
 * SIN NÚMEROS NUEVOS. La cadena habla de números ADICIONALES y de las fuentes
 * DISPONIBLES: cubre por igual «el proveedor no devolvió nada» y «devolvió sólo lo que ya
 * teníamos», que son hechos distintos pero producen el mismo resultado para el operador.
 *
 * Lo que NO dice —y es el punto— es que el contacto no tenga teléfono. El contacto SÍ
 * tiene teléfono: sigue visible arriba.
 */
export const SEARCH_MORE_NO_NEW_PHONES_COPY =
  'No encontramos números adicionales en Lusha.';

/**
 * SIN NÚMEROS **DISTINTOS**. Lusha CONTESTÓ, se cobró, y todos los números que devolvió ya
 * estaban guardados.
 *
 * Es una cadena PROPIA y no un alias de la anterior porque afirma un hecho distinto, y el
 * hecho importa en las dos direcciones: decir «no encontramos números adicionales en Lusha»
 * cuando Lusha sí devolvió números sugeriría que Lusha no tiene nada para esta persona —lo
 * tiene, y es el mismo—, y decir «no tiene teléfono» sería directamente falso. Éste es el
 * único desenlace que sólo «Buscar más números» puede producir.
 */
export const SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY =
  'Lusha no encontró números diferentes a los que ya tienes.';

/**
 * AGOTADO. No invita a reintentar, porque la carencia es estructural: no hay otra fuente
 * con identidad nativa para este contacto, y esperar no le crea una.
 */
export const SEARCH_MORE_EXHAUSTED_COPY =
  'No hay otra fuente disponible para buscar números adicionales.';

/**
 * FALLO DEL PROVEEDOR. Se dice que falló la CONSULTA. Nunca se degrada a «no encontramos
 * números»: un fallo técnico no es un hecho sobre los datos de la persona, y presentarlo
 * como tal cerraría la puerta a un reintento legítimo.
 */
export const SEARCH_MORE_PROVIDER_ERROR_COPY =
  'No pudimos completar la consulta a Lusha. El teléfono que ya tenías sigue disponible.';

/**
 * BLOQUEO DE PRIVACIDAD. Se reutiliza el copy YA existente del reveal
 * (`PHONE_REVEAL_IDENTITY_BLOCKED_COPY`) en lugar de escribir uno nuevo: es el mismo hecho
 * —SellUp no puede verificar las restricciones de privacidad necesarias— y dos redacciones
 * distintas del mismo bloqueo se separarían en cuanto una se corrigiera.
 */
export const SEARCH_MORE_PRIVACY_BLOCKED_COPY = PHONE_REVEAL_IDENTITY_BLOCKED_COPY;

/**
 * Copy del botón DESHABILITADO, por motivo. Devuelve null cuando el motivo no debe
 * producir un botón deshabilitado sino su AUSENCIA —`no_stored_phone`, donde lo correcto es
 * ofrecer «Revelar teléfono»— para que la UI no pueda renderizar un botón muerto por un
 * caso que no es de este flujo.
 *
 * `feature_disabled` también devuelve null: un permiso de producto apagado se resuelve NO
 * RENDERIZANDO, nunca mostrando una función que no existe (la lección de #287).
 */
export function getSearchMoreDisabledCopy(
  reason: SearchMoreIneligibleReason,
): string | null {
  switch (reason) {
    case 'no_stored_phone':
    case 'feature_disabled':
      return null;
    case 'providers_exhausted':
    case 'no_additional_provider':
      return SEARCH_MORE_EXHAUSTED_COPY;
    case 'active_run_exists':
      return 'Ya hay una búsqueda de teléfono en curso para este contacto.';
    case 'role_not_allowed':
      return 'Tu rol no permite buscar números adicionales.';
    case 'candidate_not_editable':
      return 'Este candidato ya se cerró y no admite nuevas búsquedas.';
    case 'blocked_suppressed':
    case 'do_not_contact':
    case 'suppression_check_unavailable':
    case 'missing_person_identity':
      return SEARCH_MORE_PRIVACY_BLOCKED_COPY;
    case 'invalid_candidate':
      return 'No pudimos identificar este candidato.';
    default: {
      // Un motivo nuevo rompe la compilación: decidir qué se le dice al operador cuando una
      // compra se bloquea es una decisión de producto, no un default.
      const exhaustive: never = reason;
      void exhaustive;
      return null;
    }
  }
}
