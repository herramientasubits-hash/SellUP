// ============================================================
// Asistente de Slack — frases fijas (puro).
// ============================================================

import type { CommercialScope } from '@/modules/access/commercial-scope-logic';

export const SLACK_ASSISTANT_COPY = {
  unknownSlackUser:
    'No pude saber quién eres en Slack. Pide a un administrador de SellUp que revise la conexión con Slack.',
  notInSellUp:
    'No encontré tu correo en SellUp. Pide a un administrador que te agregue desde Configuración › Usuarios.',
  inactive:
    'Tu acceso a SellUp está inactivo. Cuando un administrador lo active desde Usuarios, podré responderte.',
  noModel:
    'No pude responder: Claude no está configurado en SellUp. Un administrador debe revisarlo en Configuración › IA.',
  unexpected:
    'No pude responder en este momento. Vuelve a intentarlo en unos minutos; si sigue pasando, avísale a un administrador de SellUp.',
} as const;

/** Qué ve la persona, dicho para Claude. */
export function scopeLabelFor(scope: Pick<CommercialScope, 'canViewAll' | 'isRestrictedToSelf' | 'allowedUserIds'>): string {
  if (scope.canViewAll) return 'toda la plataforma (es administrador)';
  if (scope.isRestrictedToSelf) return 'sólo sus propias empresas, búsquedas y contactos';
  return `lo suyo y lo de su equipo (${scope.allowedUserIds.length} personas)`;
}
