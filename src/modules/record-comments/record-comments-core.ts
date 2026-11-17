// ============================================================
// Comentarios — reglas puras (sin Supabase ni cookies), probables con node --test.
// ============================================================

import {
  RECORD_COMMENT_BODY_MAX,
  RECORD_COMMENT_FIELD_KEYS,
  RECORD_COMMENT_FIELD_VALUE_MAX,
  RECORD_COMMENT_KINDS,
  RECORD_COMMENT_REASONS,
  RECORD_COMMENT_REASON_LABELS,
  RECORD_COMMENT_RESOLUTION_MAX,
  type CreateRecordCommentInput,
  type RecordComment,
  type RecordCommentFieldKey,
  type RecordCommentKind,
  type RecordCommentReason,
} from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export interface NormalizedCommentInput {
  target: 'account' | 'contact';
  targetId: string;
  fieldKey: RecordCommentFieldKey;
  fieldValue: string | null;
  kind: RecordCommentKind;
  reason: RecordCommentReason | null;
  body: string;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedCommentInput }
  | { ok: false; error: string };

/**
 * Valida lo que llega del navegador. Un motivo rápido (atajo del teléfono)
 * siempre es una alerta sobre el teléfono, y si no se escribió texto se usa el
 * motivo como texto.
 */
export function normalizeCommentInput(input: Partial<CreateRecordCommentInput> | null | undefined): NormalizeResult {
  if (!input || (input.target !== 'account' && input.target !== 'contact')) {
    return { ok: false, error: 'Falta indicar si el comentario es de una empresa o de un contacto.' };
  }
  if (!isUuid(input.targetId)) return { ok: false, error: 'La ficha no es válida.' };
  if (!isOneOf(RECORD_COMMENT_FIELD_KEYS, input.fieldKey)) return { ok: false, error: 'Elige a qué dato se refiere.' };
  if (!isOneOf(RECORD_COMMENT_KINDS, input.kind)) return { ok: false, error: 'Elige si es nota o alerta.' };

  let reason: RecordCommentReason | null = null;
  if (input.reason != null) {
    if (!isOneOf(RECORD_COMMENT_REASONS, input.reason)) return { ok: false, error: 'El motivo no es válido.' };
    reason = input.reason;
  }

  const fieldValue = typeof input.fieldValue === 'string' ? input.fieldValue.trim() : '';
  if (fieldValue.length > RECORD_COMMENT_FIELD_VALUE_MAX) {
    return { ok: false, error: 'El dato asociado es demasiado largo.' };
  }

  let body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body && reason) body = RECORD_COMMENT_REASON_LABELS[reason];
  if (!body) return { ok: false, error: 'Escribe el comentario.' };
  if (body.length > RECORD_COMMENT_BODY_MAX) {
    return { ok: false, error: `El comentario no puede pasar de ${RECORD_COMMENT_BODY_MAX} caracteres.` };
  }

  return {
    ok: true,
    value: {
      target: input.target,
      targetId: input.targetId,
      fieldKey: reason ? 'phone' : input.fieldKey,
      fieldValue: fieldValue || null,
      kind: reason ? 'alert' : input.kind,
      reason,
      body,
    },
  };
}

export type NormalizeResolutionResult = { ok: true; note: string | null } | { ok: false; error: string };

export function normalizeResolutionNote(note: unknown): NormalizeResolutionResult {
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length > RECORD_COMMENT_RESOLUTION_MAX) {
    return { ok: false, error: `La nota de resolución no puede pasar de ${RECORD_COMMENT_RESOLUTION_MAX} caracteres.` };
  }
  return { ok: true, note: text || null };
}

/** ¿Es un error de «la tabla todavía no existe»? (migración sin aplicar). */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = error.message ?? '';
  return /record_comments/.test(message) && /(does not exist|schema cache|Could not find)/i.test(message);
}

export function isOpenAlert(comment: Pick<RecordComment, 'kind' | 'resolvedAt'>): boolean {
  return comment.kind === 'alert' && comment.resolvedAt === null;
}

/** Quita espacios, guiones y paréntesis para comparar números. */
export function phoneKey(value: string | null | undefined): string {
  return (value ?? '').replace(/[^\d+]/g, '');
}

export interface FieldCommentSummary {
  total: number;
  openAlerts: number;
  /** El comentario más reciente de ese dato. */
  latest: RecordComment | null;
}

/**
 * Resumen por dato para las marcas junto a cada campo de la ficha. Para el
 * teléfono, `fieldValue` permite separar comentarios de cada número.
 */
export function summarizeField(
  comments: readonly RecordComment[],
  fieldKey: RecordCommentFieldKey,
  fieldValue?: string | null,
): FieldCommentSummary {
  const wantedPhone = fieldKey === 'phone' && fieldValue ? phoneKey(fieldValue) : null;
  const matching = comments.filter((c) => {
    if (c.fieldKey !== fieldKey) return false;
    if (wantedPhone === null) return true;
    return phoneKey(c.fieldValue) === wantedPhone;
  });
  const sorted = [...matching].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    total: sorted.length,
    openAlerts: sorted.filter(isOpenAlert).length,
    latest: sorted[0] ?? null,
  };
}

/** La alerta abierta más reciente con motivo de teléfono para ese número, si la hay. */
export function openPhoneReport(
  comments: readonly RecordComment[],
  phone: string | null | undefined,
): RecordComment | null {
  const key = phoneKey(phone);
  if (!key) return null;
  return (
    [...comments]
      .filter((c) => c.reason !== null && isOpenAlert(c) && phoneKey(c.fieldValue) === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

/** Orden del hilo: alertas abiertas primero, luego lo más reciente. */
export function sortThread<T extends RecordComment>(comments: readonly T[]): T[] {
  return [...comments].sort((a, b) => {
    const openA = isOpenAlert(a) ? 1 : 0;
    const openB = isOpenAlert(b) ? 1 : 0;
    if (openA !== openB) return openB - openA;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
