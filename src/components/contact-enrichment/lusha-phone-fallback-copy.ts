// Pure copy constants for the Lusha phone reveal fallback button/modal
// (Agente 2A · LUSHA-PHONE-FALLBACK-1S → LUSHA-PHONE-FALLBACK-1). No React, no
// network — safe to import from unit tests. Rendered by
// contact-candidate-detail-sheet.tsx, but only when
// ENABLE_LUSHA_PHONE_REVEAL_FALLBACK is ON (OFF in every environment today), so
// no operator currently sees this copy.
//
// Mirrors the "one pure get<X>Copy() function per concern" convention used by
// contact-enrichment-empty-state-copy.ts.

export const LUSHA_PHONE_FALLBACK_BUTTON_LABEL = 'Revelar teléfono con Lusha';

/**
 * Tope de créditos Lusha mostrado al operador. Soporte de Lusha confirmó que un
 * phone reveal exitoso cobra 5 créditos, así que este es el mínimo que el
 * operador debe aceptar. Se declara aquí como constante de UI para no importar
 * módulos de servidor en el bundle cliente (mismo patrón que
 * PHONE_REVEAL_MAX_CREDITS en contact-candidate-detail-sheet.tsx); un test
 * verifica que coincida con LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS del core,
 * que es la autoridad real y revalida el tope server-side.
 */
export const LUSHA_PHONE_FALLBACK_MAX_CREDITS = 5;

export const LUSHA_PHONE_FALLBACK_PHONE_TYPE_WARNING =
  'Lusha puede devolver un teléfono sin confirmar si es móvil, directo, fijo o genérico. SellUp lo mostrará como tipo desconocido.';

export const LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE =
  `Esta acción puede consumir ${LUSHA_PHONE_FALLBACK_MAX_CREDITS} créditos de Lusha si se encuentra teléfono. ` +
  'El costo real se registrará desde billing.creditsCharged. ' +
  'No se escribirá en HubSpot automáticamente. ' +
  'Es una acción individual, no masiva.';

export const LUSHA_PHONE_FALLBACK_DISABLED_MESSAGE =
  'Lusha Phone Reveal está pendiente de confirmación de soporte/entitlement.';

export interface LushaPhoneFallbackCopy {
  buttonLabel: string;
  phoneTypeWarning: string;
  costConfirmationMessage: string;
  disabledMessage: string;
  /** Credit cap the operator confirms; travels in the action payload. */
  maxCredits: number;
}

export function getLushaPhoneFallbackCopy(): LushaPhoneFallbackCopy {
  return {
    buttonLabel: LUSHA_PHONE_FALLBACK_BUTTON_LABEL,
    phoneTypeWarning: LUSHA_PHONE_FALLBACK_PHONE_TYPE_WARNING,
    costConfirmationMessage: LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE,
    disabledMessage: LUSHA_PHONE_FALLBACK_DISABLED_MESSAGE,
    maxCredits: LUSHA_PHONE_FALLBACK_MAX_CREDITS,
  };
}
