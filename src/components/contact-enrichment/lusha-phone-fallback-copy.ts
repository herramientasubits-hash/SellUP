// Pure copy constants for the FUTURE Lusha phone reveal fallback button/modal
// (Agente 2A · LUSHA-PHONE-FALLBACK-1S). No React, no network — safe to
// import from unit tests. NOT wired to any component in this milestone: no
// button, modal, or toast in the app currently renders this copy.
//
// Mirrors the "one pure get<X>Copy() function per concern" convention used by
// contact-enrichment-empty-state-copy.ts.

export const LUSHA_PHONE_FALLBACK_BUTTON_LABEL = 'Revelar teléfono con Lusha';

export const LUSHA_PHONE_FALLBACK_PHONE_TYPE_WARNING =
  'Lusha no confirma si el teléfono es móvil, directo, fijo o genérico. SellUp lo mostrará como tipo desconocido.';

export const LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE =
  'Esta acción puede consumir créditos de Lusha. El costo real se registrará desde billing.creditsCharged. No se escribirá en HubSpot automáticamente.';

export const LUSHA_PHONE_FALLBACK_DISABLED_MESSAGE =
  'Lusha Phone Reveal está pendiente de confirmación de soporte/entitlement.';

export interface LushaPhoneFallbackCopy {
  buttonLabel: string;
  phoneTypeWarning: string;
  costConfirmationMessage: string;
  disabledMessage: string;
}

export function getLushaPhoneFallbackCopy(): LushaPhoneFallbackCopy {
  return {
    buttonLabel: LUSHA_PHONE_FALLBACK_BUTTON_LABEL,
    phoneTypeWarning: LUSHA_PHONE_FALLBACK_PHONE_TYPE_WARNING,
    costConfirmationMessage: LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE,
    disabledMessage: LUSHA_PHONE_FALLBACK_DISABLED_MESSAGE,
  };
}
