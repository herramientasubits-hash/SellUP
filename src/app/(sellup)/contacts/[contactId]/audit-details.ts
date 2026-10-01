// Traduce el detalle técnico de un evento de auditoría de contacto a una frase
// que se pueda leer. Lo que no tiene traducción no se enseña: un JSON crudo en
// la pantalla no le dice nada a quien la usa.

import {
  CONTACT_STATUS_LABELS,
  ROLE_LABELS,
  type ContactAuditAction,
  type ContactRole,
  type ContactStatus,
} from '@/modules/contacts/types';

const NO_VALUE = 'sin definir';

function labelFor(action: ContactAuditAction, value: unknown): string {
  if (typeof value !== 'string' || value === '') return NO_VALUE;
  if (action === 'contact_status_changed') {
    return CONTACT_STATUS_LABELS[value as ContactStatus] ?? value;
  }
  if (action === 'contact_role_changed') {
    return ROLE_LABELS[value as ContactRole] ?? value;
  }
  return value;
}

/** La frase que acompaña a un evento del historial, o `null` si no hay nada que decir. */
export function describeContactAuditDetails(
  action: ContactAuditAction,
  details: Record<string, unknown> | null | undefined,
): string | null {
  if (!details) return null;

  if ('from' in details || 'to' in details) {
    return `De «${labelFor(action, details.from)}» a «${labelFor(action, details.to)}»`;
  }
  if (details.is_primary === true) return 'Ahora es el contacto principal de la empresa';
  if (details.is_primary === false) return 'Dejó de ser el contacto principal';
  if ('hubspot_sync' in details) return 'Se envió a HubSpot';
  if (details.source === 'manual') return 'Creado a mano';

  return null;
}
