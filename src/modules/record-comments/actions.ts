'use server';

// ============================================================
// Comentarios y alertas (migración 168) — acciones del servidor.
//
// La tabla sólo la toca el servidor (llave de servicio). Cada acción comprueba
// ANTES el alcance comercial de la ficha (`canActOnAccount` / `canActOnContact`,
// con «Ver como…» incluido) y pone el autor desde la sesión: nunca se confía en
// un autor o una empresa que mande el navegador.
//
// Nada de esto escribe en HubSpot, llama proveedores ni toca teléfonos.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  canActOnAccount,
  canActOnContact,
  currentScopeUserIds,
  OUT_OF_SCOPE_MESSAGE,
} from '@/modules/access/record-scope.server';
import { requireActiveActor } from '@/modules/contact-enrichment/current-actor.server';
import { loadDirectoryNames } from '@/modules/access/user-directory.server';
import { contactAccountScopeOrClause } from '@/modules/contacts/contact-scope';
import {
  isMissingTableError,
  isUuid,
  normalizeCommentInput,
  normalizeResolutionNote,
} from './record-comments-core';
import {
  RECORD_COMMENT_FIELD_KEYS,
  type CreateRecordCommentInput,
  type RecordCommentFieldKey,
  type RecordCommentInboxItem,
  type RecordCommentKind,
  type RecordCommentMutationResult,
  type RecordCommentReason,
  type RecordCommentsInboxFilters,
  type RecordCommentsInboxResult,
  type RecordCommentsResult,
  type RecordCommentTarget,
} from './types';

const SELECT_COLUMNS =
  'id, account_id, contact_id, field_key, field_value, kind, reason, body, author_id, created_at, resolved_at, resolved_by, resolution_note, account:account_id ( name ), contact:contact_id ( full_name )';

const THREAD_LIMIT = 200;
const INBOX_LIMIT = 300;
const UNAVAILABLE_MESSAGE = 'Los comentarios todavía no están activos en este entorno.';

interface CommentRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  field_key: RecordCommentFieldKey;
  field_value: string | null;
  kind: RecordCommentKind;
  reason: RecordCommentReason | null;
  body: string;
  author_id: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  account: { name: string | null } | null;
  contact: { full_name: string | null } | null;
}

async function toItems(rows: readonly CommentRow[]): Promise<RecordCommentInboxItem[]> {
  // La RLS de internal_users sólo deja ver la fila propia: los nombres salen del
  // directorio, ya comprobado el alcance de cada comentario.
  const names = await loadDirectoryNames(rows.flatMap((r) => [r.author_id, r.resolved_by]));
  const person = (id: string | null) => (id ? { id, name: names.get(id) ?? 'Sin nombre' } : null);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    contactId: r.contact_id,
    fieldKey: r.field_key,
    fieldValue: r.field_value,
    kind: r.kind,
    reason: r.reason,
    body: r.body,
    author: person(r.author_id),
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedBy: person(r.resolved_by),
    resolutionNote: r.resolution_note,
    accountName: r.account?.name ?? 'Empresa sin nombre',
    contactName: r.contact?.full_name ?? null,
  }));
}

async function canActOnTarget(target: RecordCommentTarget, id: string): Promise<boolean> {
  return target === 'contact' ? canActOnContact(id) : canActOnAccount(id);
}

// ── Hilo de una ficha ──────────────────────────────────────────────────────

/**
 * Comentarios de una ficha. En una empresa trae también los de sus contactos,
 * para verlo todo junto; en un contacto, sólo los suyos.
 */
export async function getRecordComments(
  target: RecordCommentTarget,
  targetId: string,
): Promise<RecordCommentsResult> {
  await requireActiveActor();
  if ((target !== 'account' && target !== 'contact') || !isUuid(targetId)) {
    return { available: true, comments: [] };
  }
  if (!(await canActOnTarget(target, targetId))) return { available: true, comments: [] };

  const { data, error } = await createSupabaseAdminClient()
    .from('record_comments')
    .select(SELECT_COLUMNS)
    .eq(target === 'contact' ? 'contact_id' : 'account_id', targetId)
    .order('created_at', { ascending: false })
    .limit(THREAD_LIMIT);

  if (error) {
    if (isMissingTableError(error)) return { available: false };
    throw new Error(`getRecordComments: ${error.message}`);
  }
  return { available: true, comments: await toItems((data ?? []) as unknown as CommentRow[]) };
}

// ── Crear ──────────────────────────────────────────────────────────────────

export async function createRecordComment(
  input: CreateRecordCommentInput,
): Promise<RecordCommentMutationResult> {
  const actor = await requireActiveActor();
  const normalized = normalizeCommentInput(input);
  if (!normalized.ok) return { success: false, error: normalized.error };
  const value = normalized.value;

  if (!(await canActOnTarget(value.target, value.targetId))) {
    return { success: false, error: OUT_OF_SCOPE_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  // La empresa de un contacto la fija también el disparador de la 168; aquí se
  // lee para poder insertar (account_id es obligatorio).
  let accountId = value.targetId;
  let contactId: string | null = null;
  if (value.target === 'contact') {
    const { data: contact, error } = await admin
      .from('contacts')
      .select('account_id')
      .eq('id', value.targetId)
      .maybeSingle();
    if (error) return { success: false, error: 'No se pudo leer el contacto.' };
    if (!contact?.account_id) return { success: false, error: 'El contacto ya no existe.' };
    accountId = contact.account_id as string;
    contactId = value.targetId;
  }

  const { data, error } = await admin
    .from('record_comments')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      field_key: value.fieldKey,
      field_value: value.fieldValue,
      kind: value.kind,
      reason: value.reason,
      body: value.body,
      author_id: actor.internalUserId,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (isMissingTableError(error)) return { success: false, error: UNAVAILABLE_MESSAGE };
    return { success: false, error: 'No se pudo guardar el comentario. Inténtalo de nuevo.' };
  }
  const [comment] = await toItems([data as unknown as CommentRow]);
  return { success: true, comment };
}

// ── Resolver una alerta ────────────────────────────────────────────────────

export async function resolveRecordComment(
  commentId: string,
  resolutionNote?: string | null,
): Promise<RecordCommentMutationResult> {
  const actor = await requireActiveActor();
  if (!isUuid(commentId)) return { success: false, error: 'El comentario no es válido.' };
  const note = normalizeResolutionNote(resolutionNote);
  if (!note.ok) return { success: false, error: note.error };

  const admin = createSupabaseAdminClient();
  const { data: existing, error: readError } = await admin
    .from('record_comments')
    .select('id, account_id, kind, resolved_at')
    .eq('id', commentId)
    .maybeSingle();
  if (readError) {
    if (isMissingTableError(readError)) return { success: false, error: UNAVAILABLE_MESSAGE };
    return { success: false, error: 'No se pudo leer el comentario.' };
  }
  if (!existing) return { success: false, error: 'El comentario ya no existe.' };
  if (!(await canActOnAccount(existing.account_id as string))) {
    return { success: false, error: OUT_OF_SCOPE_MESSAGE };
  }
  if (existing.kind !== 'alert') return { success: false, error: 'Sólo las alertas se marcan como resueltas.' };
  if (existing.resolved_at) return { success: false, error: 'Esta alerta ya estaba resuelta.' };

  // `.is('resolved_at', null)`: si dos personas la resuelven a la vez, gana la primera.
  const { data, error } = await admin
    .from('record_comments')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: actor.internalUserId,
      resolution_note: note.note,
    })
    .eq('id', commentId)
    .is('resolved_at', null)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) return { success: false, error: 'No se pudo marcar como resuelta. Inténtalo de nuevo.' };
  if (!data) return { success: false, error: 'Esta alerta ya estaba resuelta.' };
  const [comment] = await toItems([data as unknown as CommentRow]);
  return { success: true, comment };
}

// ── Bandeja central ────────────────────────────────────────────────────────

function sanitizeFilters(filters: Partial<RecordCommentsInboxFilters> | null | undefined): RecordCommentsInboxFilters {
  const status = filters?.status;
  const people = filters?.people;
  const fieldKey = filters?.fieldKey;
  return {
    status: status === 'resolved' || status === 'notes' || status === 'all' ? status : 'open',
    people: people === 'my_accounts' || people === 'authored' ? people : 'everyone',
    fieldKey:
      typeof fieldKey === 'string' && (RECORD_COMMENT_FIELD_KEYS as readonly string[]).includes(fieldKey)
        ? (fieldKey as RecordCommentFieldKey)
        : 'any',
  };
}

/**
 * Todo lo comentado en las fichas que quien pide puede ver (su alcance
 * comercial), con filtros. Cada fila lleva a su ficha.
 */
export async function getRecordCommentsInbox(
  rawFilters?: Partial<RecordCommentsInboxFilters> | null,
): Promise<RecordCommentsInboxResult> {
  const actor = await requireActiveActor();
  const filters = sanitizeFilters(rawFilters);
  const scopeIds = await currentScopeUserIds();
  if (scopeIds !== null && scopeIds.length === 0) {
    return { available: true, items: [], openAlerts: 0, truncated: false };
  }

  const admin = createSupabaseAdminClient();
  // `!inner` para poder filtrar por el responsable de la empresa.
  const embed = 'account:account_id!inner ( name, owner_id, created_by ), contact:contact_id ( full_name )';
  const base = 'id, account_id, contact_id, field_key, field_value, kind, reason, body, author_id, created_at, resolved_at, resolved_by, resolution_note';

  let query = admin.from('record_comments').select(`${base}, ${embed}`);
  if (scopeIds) query = query.or(contactAccountScopeOrClause(scopeIds), { referencedTable: 'account' });
  if (filters.status === 'open') query = query.eq('kind', 'alert').is('resolved_at', null);
  if (filters.status === 'resolved') query = query.eq('kind', 'alert').not('resolved_at', 'is', null);
  if (filters.status === 'notes') query = query.eq('kind', 'note');
  if (filters.people === 'authored') query = query.eq('author_id', actor.internalUserId);
  if (filters.people === 'my_accounts') query = query.eq('account.owner_id', actor.internalUserId);
  if (filters.fieldKey !== 'any') query = query.eq('field_key', filters.fieldKey);

  let countQuery = admin
    .from('record_comments')
    .select('id, account:account_id!inner ( owner_id, created_by )', { count: 'exact', head: true })
    .eq('kind', 'alert')
    .is('resolved_at', null);
  if (scopeIds) countQuery = countQuery.or(contactAccountScopeOrClause(scopeIds), { referencedTable: 'account' });

  const [{ data, error }, { count, error: countError }] = await Promise.all([
    query.order('created_at', { ascending: false }).limit(INBOX_LIMIT + 1),
    countQuery,
  ]);

  if (error || countError) {
    if (isMissingTableError(error) || isMissingTableError(countError)) return { available: false };
    throw new Error(`getRecordCommentsInbox: ${(error ?? countError)?.message}`);
  }

  const rows = (data ?? []) as unknown as CommentRow[];
  const truncated = rows.length > INBOX_LIMIT;
  return {
    available: true,
    items: await toItems(truncated ? rows.slice(0, INBOX_LIMIT) : rows),
    openAlerts: count ?? 0,
    truncated,
  };
}
