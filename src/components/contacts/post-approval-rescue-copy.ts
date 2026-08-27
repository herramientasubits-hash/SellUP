// Agente 2A — Copy de las tres salidas de rescate del contacto OFICIAL
// (AGENT2A-POST-APPROVAL-RESCUE-PARITY)
//
// Módulo PURO: ni React, ni servidor, ni flags. Existe separado por la razón habitual del
// subsistema —el texto que le promete un gasto a un operador se prueba palabra por palabra— y
// porque las cifras de créditos NO se calculan aquí: llegan resueltas por el preflight del
// servidor, que es la misma función que reservará. Este archivo las formatea; nunca las inventa.

/** Sección que agrupa las salidas. Nombra la situación, no la tecnología. */
export const RESCUE_SECTION_TITLE = 'Opciones para este teléfono';

// ── 1. Revisar ahora (GRATIS) ──────────────────────────────────

export const RESCUE_RECOVERY_LABEL = 'Revisar resultado ahora';
export const RESCUE_RECOVERY_BUSY_LABEL = 'Revisando…';
/**
 * Dice las dos cosas comprobables: consulta lo ya solicitado, y no cuesta. Es la salida del «se
 * queda cargando», así que tiene que quedar claro que NO reinicia nada.
 */
export const RESCUE_RECOVERY_HELPER =
  'Consulta el resultado ya solicitado. No inicia una revelación nueva ni consume créditos.';
export const RESCUE_RECOVERY_STILL_PENDING =
  'El proveedor todavía no ha devuelto el resultado. Puedes cerrar esta ficha y volver más tarde.';
export const RESCUE_RECOVERY_NO_PHONE =
  'La revisión cerró sin teléfono. Si hay continuación disponible, aparecerá abajo.';

// ── 2. Continuar a Lusha ───────────────────────────────────────

export const RESCUE_LUSHA_LABEL = 'Buscar en Lusha';
export const RESCUE_LUSHA_BUSY_LABEL = 'Buscando en Lusha…';

/**
 * Lo que se lee ANTES de autorizar la pata Lusha. `maxCredits === null` significa que el tope no
 * se pudo calcular: NO se escribe una cifra inventada, porque un suelo inventado menor que el real
 * hace que el arranque rechace la autorización por techo, y uno mayor promete un gasto que nadie
 * va a reservar.
 */
export function rescueLushaHelperText(
  maxCredits: number | null,
  requiresIdentitySearch: boolean,
): string {
  const what = requiresIdentitySearch
    ? 'Busca la identidad en Lusha y revela su teléfono'
    : 'Revela el teléfono en Lusha';
  if (maxCredits === null) {
    return `${what}. El tope de créditos se confirma en el servidor al autorizar.`;
  }
  return `${what}. Puede consumir hasta ${maxCredits} créditos de Lusha. No usa créditos de Apollo.`;
}

// ── 3. Buscar más números ──────────────────────────────────────

export const RESCUE_SEARCH_MORE_LABEL = 'Buscar más números';
export const RESCUE_SEARCH_MORE_BUSY_LABEL = 'Buscando…';

export function rescueSearchMoreHelperText(maxCredits: number | null): string {
  if (maxCredits === null) {
    return 'Busca números adicionales en Lusha. El tope de créditos se confirma en el servidor.';
  }
  return `Busca números adicionales en Lusha. Puede consumir hasta ${maxCredits} créditos.`;
}

// ── Confirmación de las dos que GASTAN ─────────────────────────

/**
 * El segundo paso de las dos acciones de pago. El primer clic es gratis y sólo descubre esta
 * confirmación: es el mismo reparto que la ficha del candidato ya usa con su modal, y existe para
 * que ningún clic accidental sobre una lista de botones reserve créditos.
 */
export const RESCUE_CONFIRM_LABEL = 'Confirmar';
export const RESCUE_CANCEL_LABEL = 'Cancelar';

// ── Desenlaces ─────────────────────────────────────────────────

export const RESCUE_PROJECTED_COPY = 'Teléfono guardado en el contacto.';
/** Genérico y sin citar al proveedor: su mensaje puede contener el número. */
export const RESCUE_ERROR_COPY = 'No fue posible completar la operación.';
export const RESCUE_NO_NEW_PHONES_COPY = 'No se encontraron números adicionales.';

/**
 * Traduce el desenlace unificado de las tres tuberías a UNA frase.
 *
 * `phoneProjected` manda sobre todo lo demás: es la única pregunta que le importa al operador
 * —«¿está el número en la ficha?»— y es distinta de si el proveedor contestó. Decir «revelado»
 * sobre un número que todavía no está guardado es exactamente la afirmación que este subsistema
 * no puede permitirse.
 */
export function rescueOutcomeText(outcome: {
  readonly ok: boolean;
  readonly status: string;
  readonly phoneProjected: boolean;
  readonly newDistinctPhoneCount: number;
}): string {
  if (outcome.phoneProjected) return RESCUE_PROJECTED_COPY;
  if (outcome.status === 'still_pending' || outcome.status === 'pending') {
    return RESCUE_RECOVERY_STILL_PENDING;
  }
  if (outcome.ok && outcome.newDistinctPhoneCount === 0) return RESCUE_NO_NEW_PHONES_COPY;
  if (outcome.ok) return RESCUE_RECOVERY_NO_PHONE;
  return RESCUE_ERROR_COPY;
}
