// ============================================================
// Asistente de Slack — una propuesta se ejecuta UNA vez (dueña 13-11).
// Dos clics seguidos en «Confirmar» llegan como dos interacciones a funciones
// distintas (serverless): un candado en memoria no sirve. Sin migración, el
// reclamo durable usa el índice único que ya existe en `user_notifications`
// (recipient_internal_user_id, notification_type, entity_id) — mig. 031: la
// primera inserción gana y queda como registro (ya leído) en la campanita de
// quien confirmó; la segunda choca (23505) y no se ejecuta nada.
// ============================================================

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SLACK_ACTION_CLAIM_TYPE = 'slack_action_confirmed';
export const SLACK_ACTION_CLAIM_ENTITY = 'slack_action';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La llave del reclamo: el `nonce` de la propuesta si viene (botones nuevos);
 * si no, un UUID derivado del contenido completo del botón (mismo botón ⇒ misma llave).
 */
export function actionClaimKey(nonce: string | null | undefined, rawValue: string): string {
  if (nonce && UUID_PATTERN.test(nonce)) return nonce.toLowerCase();
  const h = createHash('sha256').update(rawValue).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type ActionClaim = 'claimed' | 'already_claimed' | 'failed';

/** Reclama la propuesta. `failed` = no se pudo escribir (no se ejecuta: falla cerrado). */
export async function claimSlackAction(
  admin: Pick<SupabaseClient, 'from'>,
  input: { askerId: string; key: string; summary: string },
): Promise<ActionClaim> {
  try {
    const now = new Date().toISOString();
    const { error } = await admin.from('user_notifications').insert({
      recipient_internal_user_id: input.askerId,
      notification_type: SLACK_ACTION_CLAIM_TYPE,
      title: 'Confirmaste una acción desde Slack',
      message: input.summary.slice(0, 500),
      entity_type: SLACK_ACTION_CLAIM_ENTITY,
      entity_id: input.key,
      is_read: true,
      read_at: now,
    });
    if (!error) return 'claimed';
    if (error.code === '23505') return 'already_claimed';
    console.error('[slack-assistant] reclamo de acción', error.code ?? 'sin_codigo', error.message);
    return 'failed';
  } catch (error) {
    console.error('[slack-assistant] reclamo de acción', error instanceof Error ? error.message : 'error');
    return 'failed';
  }
}

/** ¿El mensaje del clic todavía tiene botones? (Si ya no, otro clic lo procesó.) */
export function messageStillHasButtons(message: { blocks?: ReadonlyArray<{ type?: string }> } | null | undefined): boolean {
  if (!message || !Array.isArray(message.blocks)) return true;
  return message.blocks.some((b) => b?.type === 'actions');
}
