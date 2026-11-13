// ============================================================
// Asistente de Slack — quién es en SellUp la persona de Slack (por su correo).
// Coincidencia EXACTA (sin distinguir mayúsculas): `ilike` con el correo tal
// cual tomaba `_` y `%` como comodines, y el correo no es único en
// `internal_users`. Varias filas: gana la única activa; si hay más de una
// activa no se adivina (se trata como no encontrada y queda en el registro).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Cuántas filas se miran como mucho (un correo repetido es un error de datos). */
const MAX_ROWS = 10;

/** Escapa los comodines de `ilike` para comparar el texto tal cual. */
export function escapeLikeExact(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function normalizeSlackEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** De varias filas con el mismo correo, la que vale (o `null` si no se puede decidir). */
export function pickInternalUserRow<T extends { access_status: string }>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  const active = rows.filter((r) => r.access_status === 'active');
  if (active.length === 1) return active[0];
  console.error('[slack-assistant] correo repetido en internal_users', { filas: rows.length, activas: active.length });
  return null;
}

/**
 * La fila de `internal_users` del correo de Slack. `columns` debe incluir
 * `access_status`. Primero `eq` con el correo en minúsculas; si no aparece
 * (correos guardados con mayúsculas), `ilike` con los comodines escapados.
 */
export async function findInternalUserBySlackEmail<T extends { access_status: string }>(
  admin: Pick<SupabaseClient, 'from'>,
  email: string | null | undefined,
  columns: string,
): Promise<T | null> {
  const normalized = normalizeSlackEmail(email);
  if (!normalized) return null;
  const exact = await admin.from('internal_users').select(columns).eq('email', normalized).limit(MAX_ROWS);
  if (exact.error) throw new Error(exact.error.message);
  let rows = (exact.data ?? []) as unknown as T[];
  if (rows.length === 0) {
    const loose = await admin.from('internal_users').select(columns).ilike('email', escapeLikeExact(normalized)).limit(MAX_ROWS);
    if (loose.error) throw new Error(loose.error.message);
    rows = (loose.data ?? []) as unknown as T[];
  }
  return pickInternalUserRow(rows);
}
