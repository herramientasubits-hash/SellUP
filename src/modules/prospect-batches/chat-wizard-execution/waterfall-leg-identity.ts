/**
 * waterfall-leg-identity.ts — identidad determinista de la pierna Lusha.
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 4.
 *
 * ── 🔴 El problema ──────────────────────────────────────────────────────────
 *
 * La pierna Lusha del waterfall necesita un `clientRequestId` propio y NO puede
 * reutilizar el de Apollo. Ese identificador es, a la vez:
 *
 *   · la clave de idempotencia de la reserva de créditos
 *     (`try_reserve_wizard_credits(p_user_id, p_client_request_id, …)`), y
 *   · la mitad de la identidad canónica del lote
 *     (`prospect_batches (created_by, client_request_id)`).
 *
 * Pasarle a Lusha el de Apollo tendría dos consecuencias, las dos malas:
 * `already_reserved` sobre una reserva que Apollo ya liquidó —es decir, Lusha
 * corriendo a cuenta del presupuesto de Apollo— y las dos piernas peleándose la
 * misma fila canónica de lote.
 *
 * ── 🔴 Por qué determinista y no aleatorio ──────────────────────────────────
 *
 * Un UUID aleatorio rompería justo lo que estas dos claves existen para dar: un
 * reintento del mismo waterfall crearía una SEGUNDA reserva y un SEGUNDO lote.
 * La identidad se DERIVA, entonces, del identificador de Apollo:
 *
 *   mismo waterfall + misma corrida  ⇒ mismo id de Lusha (reintento seguro)
 *   corrida nueva del wizard         ⇒ id de Lusha nuevo
 *
 * ── 🔴 Forma: UUID de verdad, no un hash con guiones ────────────────────────
 *
 * `GenerateInputSchema` valida `clientRequestId` con `z.string().uuid()`, así
 * que el resultado tiene que ser un UUID sintácticamente válido: los nibbles de
 * versión y variante RFC-4122 se fijan explícitamente.
 *
 * 🔴 Es un UUID DERIVADO con SHA-256, no un UUID v5 canónico (que exige SHA-1).
 * Se marca versión 5 porque es la clase a la que pertenece —nombre + espacio de
 * nombres, reproducible— y porque el validador exige una versión reconocible;
 * no se afirma compatibilidad byte a byte con la v5 de RFC-4122. Nada en el
 * sistema deriva el nombre de vuelta desde el UUID, así que la diferencia es de
 * etiqueta y no de contrato.
 */

import { createHash } from 'node:crypto';

/**
 * Espacio de nombres de la pierna. Va DENTRO del hash, así que dos piernas
 * distintas de la misma corrida nunca colapsan en el mismo identificador.
 */
export const LUSHA_WATERFALL_LEG_NAMESPACE = 'agent1:apollo-lusha-waterfall:lusha-leg';

/** Formatea 32 hex como UUID con versión 5 y variante RFC-4122. */
function formatDerivedUuid(hex32: string): string {
  const bytes = hex32.slice(0, 32).split('');
  // Nibble de versión (posición 12) y de variante (posición 16).
  bytes[12] = '5';
  const variantNibble = parseInt(bytes[16] ?? '0', 16);
  bytes[16] = ((variantNibble & 0x3) | 0x8).toString(16);
  const hex = bytes.join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Identificador determinista de la pierna Lusha de UN waterfall.
 *
 * @param apolloClientRequestId - el `clientRequestId` de la corrida del wizard,
 *   que ya identifica una única pulsación de "Generar".
 */
export function deriveLushaWaterfallClientRequestId(apolloClientRequestId: string): string {
  const normalized = apolloClientRequestId.trim().toLowerCase();
  if (normalized === '') {
    // Fail-closed: sin identidad de origen no hay identidad derivada que pueda
    // sostener idempotencia. Devolver un UUID cualquiera aquí sería fabricar
    // una reserva nueva en cada reintento.
    throw new Error('waterfall_leg_identity_requires_client_request_id');
  }
  const hex = createHash('sha256')
    .update(JSON.stringify([LUSHA_WATERFALL_LEG_NAMESPACE, normalized]))
    .digest('hex');
  return formatDerivedUuid(hex);
}
